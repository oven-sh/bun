use super::*;
use crate::fold::slice_in;
use crate::module_format::DeclaredModuleType;
use bun_collections::index_sort;
use bun_core::StackCheck;

#[derive(Copy, Clone, Debug)]
pub(super) enum ExportsEntry<'h> {
    Invalid,
    Null,
    Target(&'h [u8]),
    Array(&'h [ExportsEntry<'h>]),
    Map(&'h ExportsMap<'h>),
}

#[derive(Debug)]
pub(super) struct ExportsMap<'h> {
    pub entries: &'h [(&'h [u8], ExportsEntry<'h>)],
    pub expansion_keys: &'h [(&'h [u8], ExportsEntry<'h>)],
}

#[derive(Debug)]
pub(in crate::resolve) struct CodeManifest<'h> {
    pub(super) directory: &'h [u8],
    pub(super) name: &'h [u8],
    version: &'h [u8],
    pub(super) module_type: DeclaredModuleType,
    pub(super) exports: Option<ExportsEntry<'h>>,
    names_aot_condition: bool,
    side_effects: DeclaredSideEffects<'h>,
}

impl<'h> ExportsEntry<'h> {
    pub(super) fn targets(&self) -> Vec<&'h [u8]> {
        let mut targets = Vec::new();
        let mut pending = vec![*self];
        while let Some(entry) = pending.pop() {
            match entry {
                ExportsEntry::Invalid | ExportsEntry::Null => {}
                ExportsEntry::Target(target) => targets.push(target),
                ExportsEntry::Array(items) => pending.extend(items.iter().rev().copied()),
                ExportsEntry::Map(map) => {
                    pending.extend(map.entries.iter().rev().map(|entry| entry.1));
                }
            }
        }
        targets
    }
}

impl<'h> CodeManifest<'h> {
    fn package(&self) -> Option<EnclosingPackage<'h>> {
        let has_identity = !self.name.is_empty() && !self.version.is_empty();
        has_identity.then_some(EnclosingPackage {
            directory: self.directory,
            name: self.name,
            version: self.version,
        })
    }
}

impl<'h> Resolver<'h> {
    pub(super) fn code_manifest(&self, directory: &[u8]) -> Option<&'h CodeManifest<'h>> {
        let directory = strings::without_trailing_slash(directory);
        let manifests = &self.code_state().manifests;
        if let Some(&known) = manifests.get_ref(directory) {
            return known;
        }
        if let Some(normalized) = normalized_for_lookup(directory) {
            return self.code_manifest(&normalized);
        }
        let directory = self.keep(directory);
        *manifests.insert_ref(directory, self.read_code_manifest(directory))
    }

    pub(super) fn nearest_code_manifest(&self, directory: &[u8]) -> Option<&'h CodeManifest<'h>> {
        ancestors(directory).find_map(|ancestor| self.code_manifest(ancestor))
    }

    pub(super) fn module_type_manifest(&self, directory: &[u8]) -> Option<&'h CodeManifest<'h>> {
        let directory = strings::without_trailing_slash(directory);
        if directory.len() == root_length(directory) || !self.is_dir(directory) {
            return None;
        }
        let named_manifest = |ancestor| {
            let manifest = self.code_manifest(ancestor);
            manifest.filter(|manifest| !manifest.name.is_empty())
        };
        self.code_manifest(directory)
            .or_else(|| ancestors(directory).skip(1).find_map(named_manifest))
    }

    pub fn enclosing_package(&self, path: &[u8]) -> Option<EnclosingPackage<'h>> {
        if !path.starts_with(b"/") {
            return None;
        }
        ancestors(dirname::<Posix>(path))
            .find_map(|ancestor| self.code_manifest(ancestor)?.package())
    }

    /// Whether the `exports` or `imports` of the package that holds `path` name the "aot" condition.
    pub fn is_in_aot_package(&self, path: &[u8]) -> bool {
        self.aot_package_directory(path).is_some()
    }

    pub(super) fn aot_package_directory(&self, path: &[u8]) -> Option<&'h [u8]> {
        if !path.starts_with(b"/") {
            return None;
        }
        let manifest = ancestors(dirname::<Posix>(path))
            .take_while(|&ancestor| strings::basename_posix(ancestor) != b"node_modules")
            .find_map(|ancestor| {
                self.code_manifest(ancestor)
                    .filter(|it| it.exports.is_some() || it.names_aot_condition)
            })?;
        (manifest.names_aot_condition).then_some(manifest.directory)
    }

    pub fn is_same_package(&self, importer: &[u8], path: &[u8]) -> bool {
        if !importer.starts_with(b"/") {
            return false;
        }
        let nearest = |file: &[u8]| self.nearest_code_manifest(dirname::<Posix>(file));
        let Some(manifest) = nearest(importer) else {
            return false;
        };
        let relative = path.strip_prefix(manifest.directory);
        relative.is_some_and(|it| it.starts_with(b"/") && !search::is_in_node_modules(it))
            && nearest(path).is_some_and(|other| std::ptr::eq(manifest, other))
    }

    /// As the bundler has it: the nearest `package.json` with a name speaks for the file.
    pub fn declared_side_effects(&self, path: &[u8]) -> DeclaredSideEffects<'h> {
        if !path.starts_with(b"/") {
            return DeclaredSideEffects::Unspecified;
        }
        let named_manifest = |ancestor| {
            let manifest = self.code_manifest(ancestor);
            manifest.filter(|manifest| !manifest.name.is_empty())
        };
        match ancestors(dirname::<Posix>(path)).find_map(named_manifest) {
            Some(manifest) => manifest.side_effects,
            None => DeclaredSideEffects::Unspecified,
        }
    }

    fn read_code_manifest(&self, directory: &'h [u8]) -> Option<&'h CodeManifest<'h>> {
        let path = inside(directory, b"package.json");
        if !self.is_file(&path) {
            return None;
        }
        let session: &'h Session = self.session;
        let arena = session.arena();
        let text = self.read_manifest_text(&path)?;
        let json = self.code_host().parse_runtime_package_json(arena, &text)?;
        let manifest = read_manifest(arena, directory, &json)?;
        let manifest: &'h CodeManifest<'h> = arena.alloc(manifest);
        Some(manifest)
    }
}

pub(super) fn build_exports_entry<'h>(arena: &'h Arena, json: &Json) -> ExportsEntry<'h> {
    build_entry(arena, json, StackCheck::init())
}

fn build_entry<'h>(arena: &'h Arena, json: &Json, stack: StackCheck) -> ExportsEntry<'h> {
    if !stack.is_safe_to_recurse() {
        return ExportsEntry::Invalid;
    }
    match json {
        Json::Null => ExportsEntry::Null,
        Json::Bool(_) | Json::Number(_) => ExportsEntry::Invalid,
        Json::String(target) => ExportsEntry::Target(slice_in(target, arena)),
        Json::Array(items) => {
            let entries = items.iter().map(|item| build_entry(arena, item, stack));
            ExportsEntry::Array(arena.alloc_slice_fill_iter(entries))
        }
        Json::Object(properties) => build_map(arena, properties, stack),
    }
}

fn build_map<'h>(
    arena: &'h Arena,
    properties: &[(Vec<u8>, Json)],
    stack: StackCheck,
) -> ExportsEntry<'h> {
    let is_subpath = |property: &(Vec<u8>, Json)| property.0.starts_with(b".");
    if let [first, rest @ ..] = properties
        && rest.iter().any(|it| is_subpath(it) != is_subpath(first))
    {
        return ExportsEntry::Invalid;
    }
    let entries = properties
        .iter()
        .map(|(key, value)| (slice_in(key, arena), build_entry(arena, value, stack)));
    let entries: &'h [(&'h [u8], ExportsEntry<'h>)] = arena.alloc_slice_fill_iter(entries);
    let mut expansion_keys: Vec<(&'h [u8], ExportsEntry<'h>)> = entries
        .iter()
        .filter(|(key, _)| key.ends_with(b"/") || strings::contains_char(key, b'*'))
        .copied()
        .collect();
    // The comparison is not a total order, so the result depends on the algorithm: `bun_resolver` sorts with this one.
    index_sort::sort_slice_by(&mut expansion_keys, |a, b| {
        strings::glob_length_compare(a.0, b.0)
    });
    ExportsEntry::Map(arena.alloc(ExportsMap {
        entries,
        expansion_keys: slice_in(&expansion_keys, arena),
    }))
}

fn read_manifest<'h>(
    arena: &'h Arena,
    directory: &'h [u8],
    json: &Json,
) -> Option<CodeManifest<'h>> {
    json.as_object()?;
    let module_type = match non_empty_string_property(json, b"type") {
        Some(b"commonjs") => DeclaredModuleType::CommonJs,
        Some(b"module") => DeclaredModuleType::Esm,
        Some(_) | None => DeclaredModuleType::Unknown,
    };
    let subpath_table = |key: &[u8]| {
        get_first(json, key)
            .map(|table| build_exports_entry(arena, table))
            .filter(|root| !matches!(root, ExportsEntry::Null))
    };
    let exports = subpath_table(b"exports");
    let name = non_empty_string_property(json, b"name").unwrap_or_default();
    let version = non_empty_string_property(json, b"version").unwrap_or_default();
    Some(CodeManifest {
        directory,
        name: slice_in(name, arena),
        version: slice_in(version, arena),
        module_type,
        names_aot_condition: [exports, subpath_table(b"imports")]
            .iter()
            .flatten()
            .any(|table| names_condition(table, AOT_CONDITION)),
        exports,
        side_effects: read_side_effects(arena, directory, json),
    })
}

fn names_condition(entry: &ExportsEntry<'_>, condition: &[u8]) -> bool {
    if !StackCheck::init().is_safe_to_recurse() {
        return false;
    }
    match *entry {
        ExportsEntry::Invalid | ExportsEntry::Null | ExportsEntry::Target(_) => false,
        ExportsEntry::Array(items) => items.iter().any(|item| names_condition(item, condition)),
        ExportsEntry::Map(map) => map
            .entries
            .iter()
            .any(|(key, value)| *key == condition || names_condition(value, condition)),
    }
}

fn read_side_effects<'h>(
    arena: &'h Arena,
    directory: &'h [u8],
    json: &Json,
) -> DeclaredSideEffects<'h> {
    match get_first(json, b"sideEffects") {
        Some(Json::Bool(false)) => DeclaredSideEffects::None,
        Some(Json::Array(items)) => {
            let entries: Vec<&'h [u8]> = (items.iter().filter_map(Json::as_str))
                .map(|entry| slice_in(entry, arena))
                .collect();
            match entries.is_empty() {
                true => DeclaredSideEffects::None,
                false => DeclaredSideEffects::Listed {
                    directory,
                    entries: slice_in(&entries, arena),
                },
            }
        }
        Some(_) | None => DeclaredSideEffects::Unspecified,
    }
}

fn non_empty_string_property<'j>(json: &'j Json, key: &[u8]) -> Option<&'j [u8]> {
    let text = get_first(json, key)?.as_str()?;
    (!text.is_empty()).then_some(text)
}

#[cfg(test)]
mod tests {
    use super::memory_host::{MemoryHost, parse_json};
    use super::*;

    const DIRECTORY: &[u8] = b"/p/x";
    const ROOT: &str = "/p/package.json";
    const NONE: &str = "none";

    fn json(text: &str) -> Json {
        parse_json(text.as_bytes()).expect("the test text is valid JSON")
    }

    fn parse_manifest<'a>(arena: &'a Arena, text: &str) -> Option<CodeManifest<'a>> {
        read_manifest(arena, DIRECTORY, &json(text))
    }

    fn render(entry: ExportsEntry<'_>) -> String {
        match entry {
            ExportsEntry::Invalid => "invalid".to_owned(),
            ExportsEntry::Null => "null".to_owned(),
            ExportsEntry::Target(target) => target.as_bstr().to_string(),
            ExportsEntry::Array(items) => {
                let items: Vec<String> = items.iter().copied().map(render).collect();
                format!("[{}]", items.join(", "))
            }
            ExportsEntry::Map(map) => format!("{{{}}}", render_entries(map.entries)),
        }
    }

    fn render_entries(entries: &[(&[u8], ExportsEntry<'_>)]) -> String {
        let mut rendered = Vec::with_capacity(entries.len());
        for &(key, value) in entries {
            rendered.push(format!("{}: {}", key.as_bstr(), render(value)));
        }
        rendered.join(", ")
    }

    fn assert_trees(trees: &[(&str, &str)]) {
        let arena = Arena::new();
        for &(text, expected) in trees {
            let tree = build_exports_entry(&arena, &json(text));
            assert_eq!(render(tree), expected, "{text}");
        }
    }

    fn render_exports(text: &str) -> Option<String> {
        let arena = Arena::new();
        parse_manifest(&arena, text).unwrap().exports.map(render)
    }

    fn with_resolver<T>(host: &MemoryHost, run: impl FnOnce(&Resolver<'_>) -> T) -> T {
        let session = Session::new();
        let options = Options::default();
        let code = CodeOptions::bun_run(b"/p");
        run(&Resolver::for_compile(&session, host, &options, &code))
    }

    fn find_manifests(host: &MemoryHost, directory: &str) -> [String; 3] {
        let directory = directory.as_bytes();
        with_resolver(host, |resolver| {
            let found = [
                resolver.code_manifest(directory),
                resolver.nearest_code_manifest(directory),
                resolver.module_type_manifest(directory),
            ];
            found.map(|manifest| match manifest {
                Some(manifest) => inside(manifest.directory, b"package.json")
                    .as_bstr()
                    .to_string(),
                None => NONE.to_owned(),
            })
        })
    }

    fn find_package(host: &MemoryHost, path: &str) -> String {
        with_resolver(host, |resolver| {
            let Some(package) = resolver.enclosing_package(path.as_bytes()) else {
                return NONE.to_owned();
            };
            let [name, version, directory] =
                [package.name, package.version, package.directory].map(bstr::BStr::new);
            format!("{name}@{version} in {directory}")
        })
    }

    fn nested_json(depth: usize) -> Json {
        let target = Json::String(b"./a.js".to_vec());
        (0..depth).fold(target, |inner, level| match level % 2 {
            0 => Json::Array(vec![inner]),
            _ => Json::Object(vec![(b"default".to_vec(), inner)]),
        })
    }

    fn first_child(entry: ExportsEntry<'_>) -> Option<ExportsEntry<'_>> {
        match entry {
            ExportsEntry::Array(items) => items.first().copied(),
            ExportsEntry::Map(map) => map.entries.first().map(|entry| entry.1),
            ExportsEntry::Invalid | ExportsEntry::Null | ExportsEntry::Target(_) => None,
        }
    }

    fn innermost_entry(mut entry: ExportsEntry<'_>) -> (usize, ExportsEntry<'_>) {
        let mut depth = 0;
        while let Some(child) = first_child(entry) {
            entry = child;
            depth += 1;
        }
        (depth, entry)
    }

    #[test]
    fn name_and_module_type_come_from_strings() {
        let arena = Arena::new();
        let esm = parse_manifest(&arena, r#"{"name": "pkg", "type": "module"}"#).unwrap();
        assert_eq!(esm.name, b"pkg");
        assert_eq!(esm.module_type, DeclaredModuleType::Esm);
        assert_eq!(esm.directory, DIRECTORY);

        let commonjs = parse_manifest(&arena, r#"{"type": "commonjs"}"#).unwrap();
        assert_eq!(commonjs.name, b"");
        assert_eq!(commonjs.module_type, DeclaredModuleType::CommonJs);
    }

    #[test]
    fn version_comes_from_non_empty_string() {
        let arena = Arena::new();
        let versions: [(&str, &[u8]); 5] = [
            (r#"{"version": "1.2.3-beta.1"}"#, b"1.2.3-beta.1"),
            (r#"{"version": ""}"#, b""),
            (r#"{"version": 1}"#, b""),
            (r#"{"version": null}"#, b""),
            (r#"{"name": "pkg"}"#, b""),
        ];
        for (text, expected) in versions {
            let manifest = parse_manifest(&arena, text).unwrap();
            assert_eq!(manifest.version, expected, "{text}");
        }
    }

    #[test]
    fn unusable_name_and_type_are_ignored() {
        let arena = Arena::new();
        let texts = [
            r#"{"name": 1, "type": "esm"}"#,
            r#"{"name": "", "type": true}"#,
            r#"{"name": null, "type": ""}"#,
            r#"{"name": ["pkg"], "type": "Module"}"#,
        ];
        for text in texts {
            let manifest = parse_manifest(&arena, text).unwrap();
            assert_eq!(manifest.name, b"", "{text}");
            assert_eq!(manifest.module_type, DeclaredModuleType::Unknown, "{text}");
        }
    }

    #[test]
    #[cfg_attr(miri, ignore)]
    fn repeated_key_uses_first_entry() {
        let arena = Arena::new();
        let text = r#"{"name": "first", "type": "module", "name": "second", "type": "commonjs"}"#;
        let manifest = parse_manifest(&arena, text).unwrap();
        assert_eq!(manifest.name, b"first");
        assert_eq!(manifest.module_type, DeclaredModuleType::Esm);

        let unusable_first = parse_manifest(&arena, r#"{"name": 1, "name": "second"}"#).unwrap();
        assert_eq!(unusable_first.name, b"");

        let versions = parse_manifest(&arena, r#"{"version": "1.0.0", "version": "2.0.0"}"#);
        assert_eq!(versions.unwrap().version, b"1.0.0");

        let exports = render_exports(r#"{"exports": "./a.js", "exports": "./b.js"}"#);
        assert_eq!(exports.as_deref(), Some("./a.js"));
    }

    #[test]
    fn non_object_root_is_rejected() {
        let arena = Arena::new();
        for text in ["[]", "null", "true", "1", r#""pkg""#] {
            assert!(parse_manifest(&arena, text).is_none(), "{text}");
        }
        let empty = parse_manifest(&arena, "{}").unwrap();
        assert_eq!(empty.name, b"");
        assert_eq!(empty.module_type, DeclaredModuleType::Unknown);
        assert!(empty.exports.is_none());
    }

    #[test]
    #[cfg_attr(miri, ignore)]
    fn exports_tree_mirrors_json() {
        assert_trees(&[
            (r#""./a.js""#, "./a.js"),
            (r#""""#, ""),
            (r#"["./a.js", "./b.js"]"#, "[./a.js, ./b.js]"),
            ("[]", "[]"),
            ("{}", "{}"),
            (
                r#"{"import": "./a.mjs", "default": "./a.js"}"#,
                "{import: ./a.mjs, default: ./a.js}",
            ),
            (
                r#"{".": "./a.js", "./sub": {"require": ["./sub.cjs"]}, "./hidden": null}"#,
                "{.: ./a.js, ./sub: {require: [./sub.cjs]}, ./hidden: null}",
            ),
            (
                r#"{"import": {"browser": "./a.js"}, "import": "./b.js"}"#,
                "{import: {browser: ./a.js}, import: ./b.js}",
            ),
        ]);
    }

    #[test]
    #[cfg_attr(miri, ignore)]
    fn null_exports_count_as_absent() {
        let manifests = [
            (r#"{"exports": null}"#, None),
            (r#"{"name": "pkg"}"#, None),
            (r#"{"exports": [null]}"#, Some("[null]")),
            (r#"{"exports": "./a.js"}"#, Some("./a.js")),
        ];
        for (text, expected) in manifests {
            assert_eq!(render_exports(text).as_deref(), expected, "{text}");
        }
    }

    #[test]
    #[cfg_attr(miri, ignore)]
    fn invalid_exports_root_is_present() {
        let texts = [
            r#"{"exports": false}"#,
            r#"{"exports": 1}"#,
            r#"{"exports": {".": "./a", "import": "./b"}}"#,
        ];
        for text in texts {
            assert_eq!(render_exports(text).as_deref(), Some("invalid"), "{text}");
        }
    }

    #[test]
    #[cfg_attr(miri, ignore)]
    fn mixed_subpath_and_condition_keys_are_invalid() {
        assert_trees(&[
            (r#"{".": "./a", "import": "./b"}"#, "invalid"),
            (r#"{"import": "./a", "node": "./b", "./c": "."}"#, "invalid"),
            (r#"{"./a": "./a", "./b": "./b", "node": "."}"#, "invalid"),
            (r#"{"": "./a", ".": "./b"}"#, "invalid"),
            (r#"{"": "./a", "import": "./b"}"#, "{: ./a, import: ./b}"),
            (r#"{".": "./a", "./b": "./b"}"#, "{.: ./a, ./b: ./b}"),
            (
                r#"{".": {"import": "./a", "./b": "./b"}, "./c": "./c"}"#,
                "{.: invalid, ./c: ./c}",
            ),
        ]);
    }

    #[test]
    #[cfg_attr(miri, ignore)]
    fn invalid_array_element_leaves_others_intact() {
        assert_trees(&[
            (r#"["./a.js", 1, "./b.js"]"#, "[./a.js, invalid, ./b.js]"),
            (r#"[true, null, {"a": 0}]"#, "[invalid, null, {a: invalid}]"),
        ]);
    }

    #[test]
    #[cfg_attr(miri, ignore)]
    fn expansion_keys_sort_by_specificity() {
        let arena = Arena::new();
        let text = r#"{"./a/*": "1", "./*": "2", "./a": "3", "./a/b/": "4", "./a/*.js": "5"}"#;
        let ExportsEntry::Map(map) = build_exports_entry(&arena, &json(text)) else {
            panic!("an object builds a map");
        };
        let sorted = "./a/b/: 4, ./a/*.js: 5, ./a/*: 1, ./*: 2";
        assert_eq!(render_entries(map.expansion_keys), sorted);
        let in_source_order = "./a/*: 1, ./*: 2, ./a: 3, ./a/b/: 4, ./a/*.js: 5";
        assert_eq!(render_entries(map.entries), in_source_order);

        let text = r#"{".": "1", "./a": "2"}"#;
        let ExportsEntry::Map(exact) = build_exports_entry(&arena, &json(text)) else {
            panic!("an object builds a map");
        };
        assert!(exact.expansion_keys.is_empty());
    }

    #[test]
    #[cfg_attr(miri, ignore)]
    fn targets_list_every_leaf_in_source_order() {
        let arena = Arena::new();
        let trees = [
            (r#""./a.js""#, "./a.js"),
            ("null", ""),
            ("false", ""),
            ("[]", ""),
            ("{}", ""),
            (
                r#"{"node": {"import": "./1", "require": ["./2", {"a": "./3"}]}, "b": "./4"}"#,
                "./1 ./2 ./3 ./4",
            ),
            (
                r#"["./1", null, 1, {"a": null, "b": true, "c": "./2"}, "./3"]"#,
                "./1 ./2 ./3",
            ),
            (r#"["./1", {".": "./x", "a": "./y"}, "./2"]"#, "./1 ./2"),
            (r#"{"a": "./1", "a": "./2", "b": "./1"}"#, "./1 ./2 ./1"),
        ];
        for (text, expected) in trees {
            let targets = build_exports_entry(&arena, &json(text)).targets();
            let rendered = targets.join(&b" "[..]).as_bstr().to_string();
            assert_eq!(rendered, expected, "{text}");
        }
    }

    #[test]
    #[cfg_attr(miri, ignore)]
    fn deep_nesting_becomes_invalid() {
        const STACK_SIZE: usize = 4 << 20;
        let build_trees = || {
            bun_sema_standalone::native::set_stack_size(STACK_SIZE / 2);
            let arena = Arena::new();
            let shallow = build_exports_entry(&arena, &nested_json(64));
            let (depth, innermost) = innermost_entry(shallow);
            assert_eq!((depth, render(innermost).as_str()), (64, "./a.js"));

            let deep = build_exports_entry(&arena, &nested_json(100_000));
            let (depth, innermost) = innermost_entry(deep);
            assert!((64..100_000).contains(&depth), "{depth}");
            assert!(matches!(innermost, ExportsEntry::Invalid));
        };
        let thread = std::thread::Builder::new().stack_size(STACK_SIZE);
        thread.spawn(build_trees).unwrap().join().unwrap();
    }

    #[test]
    #[cfg_attr(miri, ignore)]
    fn unusable_manifest_is_skipped() {
        let host = MemoryHost::new(&[
            (ROOT, r#"{"name": "root"}"#),
            ("/p/rejected/package.json", "{,}"),
            ("/p/array/package.json", "[]"),
            ("/p/directory/package.json/file.js", ""),
            ("/p/absent/file.js", ""),
            ("/p/usable/package.json", "{}"),
        ]);
        for directory in ["/p/rejected", "/p/array", "/p/directory", "/p/absent"] {
            let found = find_manifests(&host, directory);
            assert_eq!(found, [NONE, ROOT, ROOT], "{directory}");
        }
        let usable = "/p/usable/package.json";
        assert_eq!(find_manifests(&host, "/p/usable"), [usable; 3]);
        assert_eq!(find_manifests(&host, "/p"), [ROOT; 3]);
    }

    #[test]
    #[cfg_attr(miri, ignore)]
    fn missing_directory_has_no_module_type() {
        let host = MemoryHost::new(&[
            (ROOT, r#"{"name": "root", "type": "commonjs"}"#),
            ("/p/present/file.js", ""),
        ]);
        assert_eq!(find_manifests(&host, "/p/present"), [NONE, ROOT, ROOT]);
        for directory in ["/p/missing", "/p/missing/below", "/p/present/file.js"] {
            let found = find_manifests(&host, directory);
            assert_eq!(found, [NONE, ROOT, NONE], "{directory}");
        }
    }

    #[test]
    #[cfg_attr(miri, ignore)]
    fn directory_spellings_share_one_manifest() {
        let host = MemoryHost::new(&[
            ("/p/x/package.json", r#"{"name": "x"}"#),
            ("/p/y/package.json", r#"{"name": "y"}"#),
        ]);
        with_resolver(&host, |resolver| {
            let manifest = resolver.code_manifest(DIRECTORY).unwrap();
            assert_eq!(manifest.name, b"x");
            assert_eq!(manifest.directory, DIRECTORY);
            for spelling in ["/p/x", "/p/x/", "/p/y/../x", "/p//x"] {
                let found = resolver.code_manifest(spelling.as_bytes()).unwrap();
                assert!(std::ptr::eq(manifest, found), "{spelling}");
            }
            let other = resolver.code_manifest(b"/p/y").unwrap();
            assert!(!std::ptr::eq(manifest, other));
        });
        assert_eq!(host.reads("/p/x/package.json"), 1);
    }

    #[test]
    #[cfg_attr(miri, ignore)]
    fn root_directory_can_have_manifest() {
        let files = [("/package.json", r#"{"name": "top"}"#), ("/a/b/c.js", "")];
        let host = MemoryHost::new(&files);
        with_resolver(&host, |resolver| {
            let manifest = resolver.code_manifest(b"/").unwrap();
            assert_eq!(manifest.directory, b"/");
        });

        let host = MemoryHost::new(&files[1..]);
        assert_eq!(find_manifests(&host, "/"), [NONE; 3]);
        assert_eq!(find_manifests(&host, "/a/b"), [NONE; 3]);
    }

    #[test]
    #[cfg_attr(miri, ignore)]
    fn root_directory_has_no_module_type() {
        let manifest = r#"{"name": "top", "type": "module"}"#;
        let host = MemoryHost::new(&[
            ("/package.json", manifest),
            ("/a/b/file.js", ""),
            ("/C:/package.json", manifest),
            ("/C:/a/b/file.js", ""),
        ]);
        let roots = [
            ("/", "/a/b", "/package.json"),
            ("/C:", "/C:/a/b", "/C:/package.json"),
        ];
        for (root, below, path) in roots {
            assert_eq!(find_manifests(&host, root), [path, path, NONE], "{root}");
            assert_eq!(find_manifests(&host, below), [NONE, path, path], "{below}");
        }
    }

    #[test]
    #[cfg_attr(miri, ignore)]
    fn module_type_skips_unnamed_manifest_above() {
        let host = MemoryHost::new(&[
            (ROOT, r#"{"name": "root", "type": "commonjs"}"#),
            ("/p/a/package.json", r#"{"type": "module"}"#),
            ("/p/a/b/c/file.js", ""),
            ("/q/package.json", r#"{"type": "module"}"#),
            ("/q/a/file.js", ""),
        ]);
        let unnamed = "/p/a/package.json";
        assert_eq!(find_manifests(&host, "/p/a"), [unnamed; 3]);
        assert_eq!(find_manifests(&host, "/p/a/b"), [NONE, unnamed, ROOT]);
        assert_eq!(find_manifests(&host, "/p/a/b/c"), [NONE, unnamed, ROOT]);
        assert_eq!(find_manifests(&host, "/p"), [ROOT; 3]);

        let unnamed = "/q/package.json";
        assert_eq!(find_manifests(&host, "/q"), [unnamed; 3]);
        assert_eq!(find_manifests(&host, "/q/a"), [NONE, unnamed, NONE]);
    }

    #[test]
    #[cfg_attr(miri, ignore)]
    fn node_modules_does_not_stop_walks() {
        let installed = "/p/node_modules/pkg/package.json";
        let host = MemoryHost::new(&[
            (ROOT, r#"{"name": "root"}"#),
            ("/p/node_modules/bare/lib/a.js", ""),
            (installed, r#"{"name": "pkg"}"#),
            ("/p/node_modules/pkg/lib/a.js", ""),
        ]);
        let found = find_manifests(&host, "/p/node_modules/bare/lib");
        assert_eq!(found, [NONE, ROOT, ROOT]);
        let found = find_manifests(&host, "/p/node_modules/pkg/lib");
        assert_eq!(found, [NONE, installed, installed]);
    }

    #[test]
    #[cfg_attr(miri, ignore)]
    fn enclosing_package_needs_name_and_version() {
        let installed = "/p/node_modules/s/package.json";
        let host = MemoryHost::new(&[
            (installed, r#"{"name": "s", "version": "1.0.0"}"#),
            (
                "/p/node_modules/s/dist/package.json",
                r#"{"type": "module"}"#,
            ),
            (
                "/p/node_modules/s/unnamed/package.json",
                r#"{"name": "", "version": "0"}"#,
            ),
            (
                "/p/node_modules/s/unversioned/package.json",
                r#"{"name": "inner"}"#,
            ),
            ("/p/node_modules/s/rejected/package.json", "{,}"),
            (
                "/p/node_modules/s/inner/package.json",
                r#"{"name": "inner", "version": "2.0.0"}"#,
            ),
            ("/p/package.json", r#"{"name": "app"}"#),
        ]);
        let outer = "s@1.0.0 in /p/node_modules/s";
        for directory in [
            "",
            "dist/",
            "unnamed/",
            "unversioned/",
            "rejected/",
            "missing/deep/",
        ] {
            let file = format!("/p/node_modules/s/{directory}index.js");
            assert_eq!(find_package(&host, &file), outer, "{file}");
        }
        let inner = find_package(&host, "/p/node_modules/s/inner/lib/index.js");
        assert_eq!(inner, "inner@2.0.0 in /p/node_modules/s/inner");
        assert_eq!(find_package(&host, "/p/node_modules/other/index.js"), NONE);
        assert_eq!(find_package(&host, "/p/main.ts"), NONE);
    }

    #[test]
    #[cfg_attr(miri, ignore)]
    fn same_package_stops_at_nested_manifest_and_node_modules() {
        let host = MemoryHost::new(&[
            ("/w/apps/web/package.json", r#"{"name": "web"}"#),
            ("/w/apps/web/nested/package.json", r#"{"name": "nested"}"#),
            ("/w/apps/web/node_modules/bare/index.js", ""),
            ("/w/packages/shared/package.json", r#"{"name": "shared"}"#),
            ("/w/node_modules/app/package.json", r#"{"name": "app"}"#),
        ]);
        with_resolver(&host, |resolver| {
            let is_same = |importer: &str, path: &str| {
                resolver.is_same_package(importer.as_bytes(), path.as_bytes())
            };
            let main = "/w/apps/web/src/main.js";
            let installed = "/w/node_modules/app/main.js";
            assert!(is_same(main, "/w/apps/web/lib/f.ts"));
            assert!(is_same(main, "/w/apps/web/src/deep/f.ts"));
            assert!(is_same(installed, "/w/node_modules/app/lib/f.ts"));
            assert!(!is_same(main, "/w/apps/web/nested/f.ts"));
            assert!(!is_same(main, "/w/apps/web/node_modules/bare/index.js"));
            assert!(!is_same(main, "/w/packages/shared/index.ts"));
            assert!(!is_same(main, "/w/apps/website/f.ts"));
            assert!(!is_same(main, "/bun/os.ts"));
            assert!(!is_same("/w/loose.js", "/w/other.ts"));
            assert!(!is_same("virtual:main.js", "/w/apps/web/lib/f.ts"));
        });
    }

    fn find_side_effects(host: &MemoryHost, path: &str) -> String {
        with_resolver(host, |resolver| {
            match resolver.declared_side_effects(path.as_bytes()) {
                DeclaredSideEffects::Unspecified => "unspecified".to_owned(),
                DeclaredSideEffects::None => NONE.to_owned(),
                DeclaredSideEffects::Listed { directory, entries } => {
                    let entries: Vec<&bstr::BStr> = entries.iter().map(|it| it.as_bstr()).collect();
                    format!("{entries:?} in {}", directory.as_bstr())
                }
            }
        })
    }

    #[test]
    #[cfg_attr(miri, ignore)]
    fn side_effects_field_is_false_or_list() {
        for (field, expected) in [
            (r#""sideEffects": false"#, NONE),
            (r#""sideEffects": []"#, NONE),
            (r#""sideEffects": [1, null]"#, NONE),
            (
                r#""sideEffects": ["./a.js", 1, "lib/*.js"]"#,
                r#"["./a.js", "lib/*.js"] in /p/x"#,
            ),
            (r#""sideEffects": true"#, "unspecified"),
            (r#""sideEffects": "./a.js""#, "unspecified"),
            (r#""sideEffects": null"#, "unspecified"),
            (r#""version": "1.0.0""#, "unspecified"),
        ] {
            let text = format!(r#"{{"name": "x", {field}}}"#);
            let host = MemoryHost::new(&[("/p/x/package.json", text.as_str())]);
            assert_eq!(
                find_side_effects(&host, "/p/x/lib/a.js"),
                expected,
                "{field}"
            );
        }
    }

    #[test]
    #[cfg_attr(miri, ignore)]
    fn nearest_named_manifest_declares_side_effects() {
        let host = MemoryHost::new(&[
            ("/p/package.json", r#"{"name": "app"}"#),
            (
                "/p/node_modules/s/package.json",
                r#"{"name": "s", "sideEffects": false}"#,
            ),
            (
                "/p/node_modules/s/esm/package.json",
                r#"{"type": "module"}"#,
            ),
            (
                "/p/node_modules/s/unnamed/package.json",
                r#"{"name": "", "sideEffects": ["./a.js"]}"#,
            ),
            (
                "/p/node_modules/s/inner/package.json",
                r#"{"name": "inner"}"#,
            ),
            ("/p/node_modules/s/rejected/package.json", "{,}"),
            (
                "/p/node_modules/nameless/package.json",
                r#"{"sideEffects": false}"#,
            ),
        ]);
        for directory in ["", "esm/", "unnamed/", "rejected/", "missing/deep/"] {
            let file = format!("/p/node_modules/s/{directory}a.js");
            assert_eq!(find_side_effects(&host, &file), NONE, "{file}");
        }
        for file in [
            "/p/node_modules/s/inner/a.js",
            "/p/node_modules/nameless/a.js",
            "/p/main.js",
            "/outside.js",
            "virtual:a.js",
        ] {
            assert_eq!(find_side_effects(&host, file), "unspecified", "{file}");
        }
    }

    #[test]
    #[cfg_attr(miri, ignore)]
    fn enclosing_package_shares_parsed_manifest() {
        let installed = "/p/node_modules/s/package.json";
        let host = MemoryHost::new(&[(installed, r#"{"name": "s", "version": "1.0.0"}"#)]);
        with_resolver(&host, |resolver| {
            let manifest = resolver.code_manifest(b"/p/node_modules/s").unwrap();
            for file in ["index.js", "lib/a.js", "lib/b.js"] {
                let path = inside(manifest.directory, file.as_bytes());
                let package = resolver.enclosing_package(&path).unwrap();
                assert!(std::ptr::eq(package.name, manifest.name), "{file}");
                assert!(std::ptr::eq(package.version, manifest.version), "{file}");
                assert!(
                    std::ptr::eq(package.directory, manifest.directory),
                    "{file}"
                );
            }
        });
        assert_eq!(host.reads(installed), 1);
    }

    #[test]
    #[cfg_attr(miri, ignore)]
    fn relative_path_has_no_enclosing_package() {
        let host = MemoryHost::new(&[
            ("/package.json", r#"{"name": "top", "version": "1.0.0"}"#),
            ("/a/b.js", ""),
        ]);
        for path in ["/b.js", "/a/b.js"] {
            assert_eq!(find_package(&host, path), "top@1.0.0 in /", "{path}");
        }
        for path in ["b.js", "a/b.js", "virtual:b.js", ""] {
            assert_eq!(find_package(&host, path), NONE, "{path}");
        }
    }
}
