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
    pub(super) path: &'h [u8],
    pub(super) name: &'h [u8],
    version: &'h [u8],
    pub(super) module_type: DeclaredModuleType,
    main_fields: &'h [(&'h [u8], &'h [u8])],
    pub(super) exports: Option<ExportsEntry<'h>>,
    pub(super) imports: Option<ExportsEntry<'h>>,
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
    pub(super) fn main_field(&self, field: &[u8]) -> Option<&[u8]> {
        let entry = self.main_fields.iter().find(|entry| entry.0 == field)?;
        Some(entry.1)
    }

    pub(super) fn has_main_fields(&self) -> bool {
        !self.main_fields.is_empty()
    }

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

    pub fn is_same_package(&self, importer: &[u8], path: &[u8]) -> bool {
        if !importer.starts_with(b"/") {
            return false;
        }
        let nearest = |file: &[u8]| self.nearest_code_manifest(dirname::<Posix>(file));
        let Some(manifest) = nearest(importer) else {
            return false;
        };
        let relative = path.strip_prefix(manifest.directory);
        relative.is_some_and(|it| it.starts_with(b"/") && !files::is_in_node_modules(it))
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
        let path = slice_in(&path, arena);
        let main_fields = &self.code_options().main_fields;
        let manifest = read_manifest(arena, directory, path, &json, main_fields)?;
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
    path: &'h [u8],
    json: &Json,
    main_fields: &[Vec<u8>],
) -> Option<CodeManifest<'h>> {
    json.as_object()?;
    let module_type = match non_empty_string_property(json, b"type") {
        Some(b"commonjs") => DeclaredModuleType::CommonJs,
        Some(b"module") => DeclaredModuleType::Esm,
        Some(_) | None => DeclaredModuleType::Unknown,
    };
    let main_field_values: Vec<(&'h [u8], &'h [u8])> = main_fields
        .iter()
        .filter_map(|field| {
            let value = non_empty_string_property(json, field)?;
            Some((slice_in(field, arena), slice_in(value, arena)))
        })
        .collect();
    let subpath_table = |key: &[u8]| {
        let root = build_exports_entry(arena, get_first(json, key)?);
        match root {
            ExportsEntry::Null => None,
            _ => Some(root),
        }
    };
    let name = non_empty_string_property(json, b"name").unwrap_or_default();
    let version = non_empty_string_property(json, b"version").unwrap_or_default();
    Some(CodeManifest {
        directory,
        path,
        name: slice_in(name, arena),
        version: slice_in(version, arena),
        module_type,
        main_fields: slice_in(&main_field_values, arena),
        exports: subpath_table(b"exports"),
        imports: subpath_table(b"imports"),
        side_effects: read_side_effects(arena, directory, json),
    })
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
