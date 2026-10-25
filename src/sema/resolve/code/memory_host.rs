use super::*;
use crate::program::HostModuleId;

const MAX_FOLLOWED_LINKS: usize = 16;

struct Claim {
    specifier: Vec<u8>,
    importer: Option<Vec<u8>>,
    resolution: HostResolution,
}

#[derive(Default)]
pub(crate) struct MemoryHost {
    files: FxHashMap<Vec<u8>, Vec<u8>>,
    directories: FxHashSet<Vec<u8>>,
    links: Vec<(Vec<u8>, Vec<u8>)>,
    runtime_modules: Vec<(Vec<u8>, HostResolution)>,
    claims: Vec<Claim>,
    required: Vec<(Vec<u8>, Vec<u8>)>,
    node_paths: Vec<Vec<u8>>,
    reads: bun_threading::Guarded<FxHashMap<Vec<u8>, usize>>,
}

impl MemoryHost {
    pub(crate) fn new(files: &[(&str, &str)]) -> MemoryHost {
        let mut host = MemoryHost::default();
        for &(path, text) in files {
            host.add_parent_directories(path.as_bytes());
            host.files.insert(path.into(), text.into());
        }
        host
    }

    pub(crate) fn link(mut self, link: &str, target: &str) -> MemoryHost {
        self.add_parent_directories(link.as_bytes());
        self.links.push((link.into(), target.into()));
        self
    }

    /// `imported` is what "module" names in a package, `required` what "main" names.
    pub(crate) fn required_in_place_of(mut self, imported: &str, required: &str) -> MemoryHost {
        self.required.push((imported.into(), required.into()));
        self
    }

    pub(crate) fn node_path(mut self, directory: &str) -> MemoryHost {
        self.node_paths.push(directory.into());
        self
    }

    pub(crate) fn module(self, specifier: &str, id: u32) -> MemoryHost {
        self.runtime_module(specifier, HostResolution::Module(HostModuleId(id)))
    }

    pub(crate) fn runtime_module(
        mut self,
        specifier: &str,
        resolution: HostResolution,
    ) -> MemoryHost {
        self.runtime_modules.push((specifier.into(), resolution));
        self
    }

    pub(crate) fn claim(mut self, specifier: &str, resolution: HostResolution) -> MemoryHost {
        self.claims.push(Claim {
            specifier: specifier.into(),
            importer: None,
            resolution,
        });
        self
    }

    pub(crate) fn claim_from(
        mut self,
        importer: &str,
        specifier: &str,
        resolution: HostResolution,
    ) -> MemoryHost {
        self.claims.push(Claim {
            specifier: specifier.into(),
            importer: Some(importer.into()),
            resolution,
        });
        self
    }

    pub(crate) fn reads(&self, path: &str) -> usize {
        let path = self.follow_links(path.as_bytes());
        self.reads.lock().get(&path).copied().unwrap_or(0)
    }

    fn add_parent_directories(&mut self, path: &[u8]) {
        let parents = ancestors(dirname::<Posix>(path));
        self.directories.extend(parents.map(<[u8]>::to_vec));
    }

    fn find_longest_link(&self, path: &[u8]) -> Option<&(Vec<u8>, Vec<u8>)> {
        let is_prefix = |link: &[u8]| matches!(path.strip_prefix(link), Some([] | [b'/', ..]));
        let prefixes = self.links.iter().filter(|(link, _)| is_prefix(link));
        prefixes.max_by_key(|(link, _)| link.len())
    }

    fn follow_links(&self, path: &[u8]) -> Vec<u8> {
        let mut path = path.to_vec();
        for _ in 0..MAX_FOLLOWED_LINKS {
            let Some((link, target)) = self.find_longest_link(&path) else {
                break;
            };
            path = [&target[..], &path[link.len()..]].concat();
        }
        path
    }
}

impl MemoryHost {
    // What "imports" of the nearest `package.json` names by an exact key is taken for a module of the host.
    fn find_through_imports(&self, search: &FileSearch<'_>) -> Option<FoundCode> {
        let manifest = ancestors(search.directory).find_map(|directory| {
            let path = self.follow_links(&inside(directory, b"package.json"));
            parse_json(self.files.get(&path)?)
        })?;
        let target = get_first(get_first(&manifest, b"imports")?, search.specifier)?.as_str()?;
        Some(FoundCode::External(target.to_vec()))
    }
}

fn entry_name<'a>(directory: &[u8], path: &'a [u8]) -> Option<&'a [u8]> {
    let rest = path.strip_prefix(directory)?;
    let name = match directory {
        b"/" => rest,
        _ => rest.strip_prefix(b"/")?,
    };
    (!name.is_empty() && !strings::contains_char(name, b'/')).then_some(name)
}

impl Host for MemoryHost {
    fn read(&self, path: &[u8]) -> Option<Cow<'static, [u8]>> {
        let path = self.follow_links(path);
        let text = self.files.get(&path).cloned();
        *self.reads.lock().entry(path).or_default() += 1;
        text.map(Cow::Owned)
    }

    fn is_file(&self, path: &[u8]) -> bool {
        self.files.contains_key(&self.follow_links(path))
    }

    fn is_dir(&self, path: &[u8]) -> bool {
        self.directories.contains(&self.follow_links(path))
    }

    fn realpath(&self, path: &[u8]) -> Vec<u8> {
        self.follow_links(path)
    }

    fn list_dir(&self, path: &[u8]) -> Vec<Vec<u8>> {
        let directory = self.follow_links(path);
        let links = self.links.iter().map(|(link, _)| link);
        let paths = self.files.keys().chain(&self.directories).chain(links);
        let names = paths.filter_map(|entry| entry_name(&directory, entry));
        let mut names: Vec<Vec<u8>> = names.map(<[u8]>::to_vec).collect();
        names.shared_sort();
        names.dedup();
        names
    }

    fn script_kind(&self, _path: &[u8]) -> Option<ScriptKind> {
        None
    }

    fn extra_file_extensions(&self) -> &[(Vec<u8>, ScriptKind)] {
        &[]
    }

    fn scripts_of_page(&self, _page: &[u8]) -> Vec<Vec<u8>> {
        Vec::new()
    }

    fn parse<'s>(
        &self,
        _arena: &'s Arena,
        _path: &[u8],
        _text: &[u8],
        _atoms: &crate::atom::Interner<'s>,
        _options: ParseOptions,
    ) -> crate::hir::File<'s> {
        unreachable!("the resolver parses no source file")
    }

    fn parse_package_json(&self, _arena: &Arena, text: &[u8]) -> Option<Json> {
        parse_json(text)
    }

    fn parallel(&self, count: usize, work: &(dyn Fn(usize) + Sync)) {
        for index in 0..count {
            work(index);
        }
    }
}

impl CodeHost for MemoryHost {
    fn parse_runtime_package_json(&self, _arena: &Arena, text: &[u8]) -> Option<Json> {
        parse_json(text)
    }

    fn parse_runtime_tsconfig(&self, _arena: &Arena, text: &[u8]) -> Option<Json> {
        parse_json(text)
    }

    fn resolve_code(&self, request: &CodeRequest<'_>) -> HostResolution {
        let runtime_module = self.resolve_runtime_module(request.specifier);
        if runtime_module != HostResolution::Unclaimed {
            return runtime_module;
        }
        let is_match = |claim: &&Claim| {
            let importer = claim.importer.as_deref();
            claim.specifier == request.specifier && importer.is_none_or(|it| it == request.importer)
        };
        match self.claims.iter().find(is_match) {
            Some(claim) => claim.resolution.clone(),
            None => HostResolution::Unclaimed,
        }
    }

    fn find_code_file(&self, search: &FileSearch<'_>) -> FoundCode {
        let in_node_paths = || {
            let files = self.node_paths.iter().map(|directory| {
                let specifier = &join(directory, search.specifier);
                find_file_plainly(
                    self,
                    &FileSearch {
                        specifier,
                        ..*search
                    },
                )
            });
            files
                .into_iter()
                .find(|it| matches!(it, FoundCode::File { .. }))
        };
        let found = self.find_through_imports(search);
        let found = found.unwrap_or_else(|| find_file_plainly(self, search));
        let is_settled = matches!(found, FoundCode::File { .. })
            || matches!(search.specifier.first(), Some(b'/' | b'.'));
        let found = match is_settled {
            true => found,
            false => in_node_paths().unwrap_or(found),
        };
        match found {
            FoundCode::File { path, .. } if search.prefers_module_field => {
                let mut pairs = self.required.iter();
                let required = pairs.find(|pair| pair.0 == path).map(|pair| pair.1.clone());
                FoundCode::File { path, required }
            }
            found => found,
        }
    }

    fn resolve_runtime_module(&self, specifier: &[u8]) -> HostResolution {
        let mut modules = self.runtime_modules.iter();
        match modules.find(|(claimed, _)| claimed == specifier) {
            Some((_, resolution)) => resolution.clone(),
            None => HostResolution::Unclaimed,
        }
    }

    fn find_runtime_modules(&self, prefix: &[u8], suffix: &[u8]) -> Vec<HostResolution> {
        let is_match = |specifier: &[u8]| {
            let rest = specifier.strip_prefix(prefix);
            rest.is_some_and(|rest| rest.ends_with(suffix))
        };
        let specifiers = self.runtime_modules.iter().map(|(specifier, _)| specifier);
        let matches = specifiers.filter(|specifier| is_match(specifier));
        matches
            .map(|specifier| self.resolve_runtime_module(specifier))
            .collect()
    }
}

pub(crate) fn resolve_in(
    host: &MemoryHost,
    options: &CodeOptions,
    importer: &str,
    specifier: &str,
    kind: CodeImportKind,
) -> String {
    let importer: &[u8] = match kind {
        CodeImportKind::EntryPoint => b"",
        CodeImportKind::Import | CodeImportKind::Require => importer.as_bytes(),
    };
    let session = Session::new();
    let type_options = Options::default();
    let resolver = Resolver::for_compile(&session, host, &type_options, options);
    format_resolution(resolver.resolve_code(&CodeRequest {
        specifier: specifier.as_bytes(),
        importer,
        directory: dirname::<Posix>(importer),
        kind,
        form: CodeImportForm::Static,
    }))
}

pub(crate) fn format_resolution(answer: CodeResolution<'_>) -> String {
    match answer {
        CodeResolution::File(file) => bstr::BStr::new(file.path).to_string(),
        CodeResolution::External { specifier, .. } => {
            format!("External({})", bstr::BStr::new(specifier))
        }
        CodeResolution::HostModule(_) | CodeResolution::Erased | CodeResolution::NotFound(_) => {
            format!("{answer:?}")
        }
    }
}

pub(crate) fn resolve_computed_in(
    host: &MemoryHost,
    importer: &str,
    prefix: &str,
    suffix: &str,
    kind: CodeImportKind,
) -> String {
    let options = CodeOptions::bun_run(dirname::<Posix>(importer.as_bytes()));
    let pattern = ComputedPattern {
        importer,
        prefix,
        suffix,
        kind,
    };
    resolve_computed_with(host, &options, pattern)
}

#[derive(Copy, Clone)]
pub(crate) struct ComputedPattern<'a> {
    pub(crate) importer: &'a str,
    pub(crate) prefix: &'a str,
    pub(crate) suffix: &'a str,
    pub(crate) kind: CodeImportKind,
}

pub(crate) fn resolve_computed_with(
    host: &MemoryHost,
    options: &CodeOptions,
    pattern: ComputedPattern<'_>,
) -> String {
    let importer = pattern.importer.as_bytes();
    let session = Session::new();
    let type_options = Options::default();
    let resolver = Resolver::for_compile(&session, host, &type_options, options);
    let answer = resolver.resolve_computed_code(&ComputedCodeRequest {
        prefix: pattern.prefix.as_bytes(),
        suffix: pattern.suffix.as_bytes(),
        importer,
        directory: dirname::<Posix>(importer),
        kind: pattern.kind,
        form: CodeImportForm::Static,
    });
    let (unknown, candidates) = match answer {
        ComputedResolution::Candidates { candidates, .. } => (None, candidates),
        ComputedResolution::All {
            cause,
            host_modules,
        } => (Some(format!("All({cause:?})")), host_modules),
    };
    let candidates = candidates.iter().map(format_candidate);
    let texts: Vec<String> = unknown.into_iter().chain(candidates).collect();
    texts.join(", ")
}

fn format_candidate(candidate: &ComputedCandidate<'_>) -> String {
    match candidate {
        ComputedCandidate::File(file) => bstr::BStr::new(file.path).to_string(),
        ComputedCandidate::HostModule(module) => format!("host:{}", module.0),
    }
}

pub(crate) fn parse_json(text: &[u8]) -> Option<Json> {
    let mut parser = JsonParser { text, position: 0 };
    let value = parser.parse_value()?;
    parser.skip_whitespace();
    (parser.position == text.len()).then_some(value)
}

struct JsonParser<'a> {
    text: &'a [u8],
    position: usize,
}

impl JsonParser<'_> {
    fn peek(&self) -> Option<u8> {
        self.text.get(self.position).copied()
    }

    fn skip_whitespace(&mut self) {
        while matches!(self.peek(), Some(b' ' | b'\t' | b'\n' | b'\r')) {
            self.position += 1;
        }
    }

    fn consume(&mut self, token: &[u8]) -> bool {
        self.skip_whitespace();
        let is_next = self.text[self.position..].starts_with(token);
        if is_next {
            self.position += token.len();
        }
        is_next
    }

    fn expect(&mut self, token: &[u8]) -> Option<()> {
        self.consume(token).then_some(())
    }

    fn expect_digits(&mut self) -> Option<usize> {
        let start = self.position;
        while self.peek().is_some_and(|byte| byte.is_ascii_digit()) {
            self.position += 1;
        }
        (self.position > start).then_some(self.position - start)
    }

    fn parse_value(&mut self) -> Option<Json> {
        self.skip_whitespace();
        match self.peek()? {
            b'{' => self.parse_object(),
            b'[' => self.parse_array(),
            b'"' => self.parse_string().map(Json::String),
            b't' => self.consume(b"true").then_some(Json::Bool(true)),
            b'f' => self.consume(b"false").then_some(Json::Bool(false)),
            b'n' => self.consume(b"null").then_some(Json::Null),
            _ => self.parse_number(),
        }
    }

    fn parse_object(&mut self) -> Option<Json> {
        self.position += 1;
        let mut entries = Vec::new();
        if self.consume(b"}") {
            return Some(Json::Object(entries));
        }
        loop {
            let key = self.parse_string()?;
            self.expect(b":")?;
            entries.push((key, self.parse_value()?));
            if self.consume(b"}") {
                return Some(Json::Object(entries));
            }
            self.expect(b",")?;
        }
    }

    fn parse_array(&mut self) -> Option<Json> {
        self.position += 1;
        let mut items = Vec::new();
        if self.consume(b"]") {
            return Some(Json::Array(items));
        }
        loop {
            items.push(self.parse_value()?);
            if self.consume(b"]") {
                return Some(Json::Array(items));
            }
            self.expect(b",")?;
        }
    }

    fn parse_string(&mut self) -> Option<Vec<u8>> {
        self.expect(b"\"")?;
        let mut value = Vec::new();
        loop {
            let byte = self.peek()?;
            self.position += 1;
            match byte {
                b'"' => return Some(value),
                b'\\' => {
                    let escape = self.peek()?;
                    self.position += 1;
                    value.push(match escape {
                        b'"' | b'\\' | b'/' => escape,
                        b'n' => b'\n',
                        b't' => b'\t',
                        _ => return None,
                    });
                }
                0..=0x1F => return None,
                _ => value.push(byte),
            }
        }
    }

    fn parse_number(&mut self) -> Option<Json> {
        let start = self.position;
        self.position += usize::from(self.peek() == Some(b'-'));
        let has_leading_zero = self.peek() == Some(b'0');
        if self.expect_digits()? > 1 && has_leading_zero {
            return None;
        }
        if self.peek() == Some(b'.') {
            self.position += 1;
            self.expect_digits()?;
        }
        if matches!(self.peek(), Some(b'e' | b'E')) {
            self.position += 1;
            self.position += usize::from(matches!(self.peek(), Some(b'+' | b'-')));
            self.expect_digits()?;
        }
        let literal = std::str::from_utf8(&self.text[start..self.position]).ok()?;
        literal.parse().ok().map(Json::Number)
    }
}

mod tests {
    use super::CodeImportKind::{EntryPoint, Import, Require};
    use super::*;

    fn external(specifier: &str) -> HostResolution {
        HostResolution::External {
            specifier: specifier.into(),
            kind: ExternalKind::UncompiledCode,
        }
    }

    #[test]
    fn parent_directories_exist() {
        let host = MemoryHost::new(&[("/p/a/b/c.ts", ""), ("/p/d.ts", "")]);
        for directory in ["/", "/p", "/p/a", "/p/a/b"] {
            assert!(host.is_dir(directory.as_bytes()), "{directory}");
            assert!(!host.is_file(directory.as_bytes()), "{directory}");
        }
        assert!(host.is_file(b"/p/a/b/c.ts"));
        assert!(!host.is_dir(b"/p/a/b/c.ts"));
        assert!(!host.is_dir(b"/q"));

        let names: [&[u8]; 2] = [b"a", b"d.ts"];
        assert_eq!(host.list_dir(b"/p"), names);
        assert_eq!(host.list_dir(b"/"), [b"p"]);
        assert!(host.list_dir(b"/q").is_empty());
    }

    #[test]
    fn links_are_followed() {
        let host = MemoryHost::new(&[("/real/pkg/index.js", "a"), ("/real/file.js", "b")])
            .link("/p/node_modules/pkg", "/real/pkg")
            .link("/p/file.js", "/real/file.js")
            .link("/p/alias", "/p/node_modules/pkg")
            .link("/p/first", "/p/second")
            .link("/p/second", "/p/first");

        let linked_files = [
            ("/p/node_modules/pkg/index.js", "/real/pkg/index.js", "a"),
            ("/p/file.js", "/real/file.js", "b"),
            ("/p/alias/index.js", "/real/pkg/index.js", "a"),
        ];
        for (path, real, text) in linked_files {
            assert!(host.is_file(path.as_bytes()), "{path}");
            assert!(!host.is_dir(path.as_bytes()), "{path}");
            assert_eq!(host.realpath(path.as_bytes()), real.as_bytes(), "{path}");
            let read = host.read(path.as_bytes());
            assert_eq!(read.as_deref(), Some(text.as_bytes()), "{path}");
        }
        for directory in ["/p/node_modules/pkg", "/p/alias"] {
            assert!(host.is_dir(directory.as_bytes()), "{directory}");
            let names = host.list_dir(directory.as_bytes());
            assert_eq!(names, [b"index.js"], "{directory}");
        }
        let names: [&[u8]; 5] = [b"alias", b"file.js", b"first", b"node_modules", b"second"];
        assert_eq!(host.list_dir(b"/p"), names);

        for path in ["/p/first", "/p/second", "/p/first/index.js"] {
            assert!(!host.is_file(path.as_bytes()), "{path}");
            assert!(!host.is_dir(path.as_bytes()), "{path}");
        }
        assert_eq!(host.realpath(b"/p/file.jsx"), b"/p/file.jsx");
        assert_eq!(host.realpath(b"/p/alias/missing"), b"/real/pkg/missing");
    }

    #[test]
    fn reads_are_counted_after_links() {
        let files = [("/real/file.js", "b")];
        let host = MemoryHost::new(&files).link("/p/file.js", "/real/file.js");
        assert!(host.read(b"/p/file.js").is_some());
        assert!(host.read(b"/real/file.js").is_some());
        assert!(host.read(b"/p/missing.js").is_none());
        assert_eq!(host.reads("/real/file.js"), 2);
        assert_eq!(host.reads("/p/file.js"), 2);
        assert_eq!(host.reads("/p/missing.js"), 1);
        assert_eq!(host.reads("/p/unread.js"), 0);
    }

    #[test]
    fn only_registered_modules_are_claimed() {
        let host = MemoryHost::new(&[]).module("node:fs", 7);
        let claim = |specifier: &[u8]| {
            host.resolve_code(&CodeRequest {
                specifier,
                importer: b"/p/a.ts",
                directory: b"/p",
                kind: Import,
                form: CodeImportForm::Static,
            })
        };
        assert_eq!(claim(b"node:fs"), HostResolution::Module(HostModuleId(7)));
        assert_eq!(claim(b"fs"), HostResolution::Unclaimed);
    }

    #[test]
    fn runtime_modules_answer_both_methods() {
        let host = MemoryHost::new(&[])
            .module("node:fs", 7)
            .runtime_module("node:omitted", external("node:omitted"))
            .claim("plugin", HostResolution::Path(b"/p/plugin.ts".to_vec()))
            .claim("react", external("react"))
            .claim("node:fs", HostResolution::Erased);
        let claim = |specifier: &[u8]| {
            let request = CodeRequest {
                specifier,
                importer: b"/p/a.ts",
                directory: b"/p",
                kind: Import,
                form: CodeImportForm::Static,
            };
            (
                host.resolve_code(&request),
                host.resolve_runtime_module(specifier),
            )
        };
        let module = HostResolution::Module(HostModuleId(7));
        assert_eq!(claim(b"node:fs"), (module.clone(), module));
        let omitted = external("node:omitted");
        assert_eq!(claim(b"node:omitted"), (omitted.clone(), omitted));

        let unclaimed = HostResolution::Unclaimed;
        let plugin = HostResolution::Path(b"/p/plugin.ts".to_vec());
        assert_eq!(claim(b"plugin"), (plugin, unclaimed.clone()));
        assert_eq!(claim(b"react"), (external("react"), unclaimed.clone()));
        assert_eq!(claim(b"fs"), (unclaimed.clone(), unclaimed));
    }

    #[test]
    fn runtime_modules_match_prefix_and_suffix() {
        let host = MemoryHost::new(&[])
            .module("fs", 1)
            .module("node:fs", 1)
            .module("node:fs/promises", 2)
            .runtime_module("node:omitted", external("node:omitted"))
            .claim("node:plugin", HostResolution::Erased);
        let module = |id| HostResolution::Module(HostModuleId(id));
        let find = |prefix: &[u8], suffix: &[u8]| host.find_runtime_modules(prefix, suffix);
        assert_eq!(find(b"node:fs", b""), [module(1), module(2)]);
        assert_eq!(find(b"", b"fs"), [module(1), module(1)]);
        assert_eq!(find(b"node:", b"ted"), [external("node:omitted")]);
        assert_eq!(find(b"node:", b"fs"), [module(1)]);
        assert_eq!(find(b"", b"").len(), 4);
        assert!(find(b"node:f", b"fs").is_empty());
        assert!(find(b"node:fs", b"node:fs").is_empty());
        assert!(find(b"bun:", b"").is_empty());

        let repeated = MemoryHost::new(&[]).module("fs", 1).module("fs", 2);
        assert_eq!(
            repeated.find_runtime_modules(b"f", b""),
            [module(1), module(1)]
        );
    }

    #[test]
    fn claims_match_specifier_and_importer() {
        let host = MemoryHost::new(&[])
            .claim("anywhere", external("anywhere"))
            .claim_from("/p/a.ts", "local", HostResolution::Erased);
        let claim = |specifier: &[u8], importer: &[u8]| {
            host.resolve_code(&CodeRequest {
                specifier,
                importer,
                directory: b"/p",
                kind: Import,
                form: CodeImportForm::Static,
            })
        };
        let importers: [&[u8]; 3] = [b"/p/a.ts", b"/p/b.ts", b""];
        for importer in importers {
            assert_eq!(claim(b"anywhere", importer), external("anywhere"));
        }
        assert_eq!(claim(b"local", b"/p/a.ts"), HostResolution::Erased);
        assert_eq!(claim(b"local", b"/p/b.ts"), HostResolution::Unclaimed);
        assert_eq!(claim(b"local", b""), HostResolution::Unclaimed);
    }

    #[test]
    #[cfg_attr(miri, ignore)]
    fn resolve_in_formats_answers() {
        let files = [("/p/a.ts", ""), ("/p/b.ts", "")];
        let host = MemoryHost::new(&files).module("node:fs", 3);
        let options = CodeOptions::bun_run(b"/p");
        let resolve = |specifier, kind| resolve_in(&host, &options, "/p/a.ts", specifier, kind);
        assert_eq!(resolve("./b", Import), "/p/b.ts");
        assert_eq!(resolve("node:fs", Require), "HostModule(HostModuleId(3))");
        let url = "https://example.com/a.js";
        assert_eq!(resolve(url, Import), format!("External({url})"));
        assert_eq!(resolve("missing", Import), "NotFound(PackageNotFound)");

        let entry_point = resolve_in(&host, &options, "/q/a.ts", "b.ts", EntryPoint);
        assert_eq!(entry_point, "/p/b.ts");
    }

    #[test]
    #[cfg_attr(miri, ignore)]
    fn resolve_computed_in_formats_answers() {
        let files = [
            ("/p/main.ts", ""),
            ("/p/locales/en.json", "{}"),
            ("/p/locales/fr.json", "{}"),
            ("/p/locales/notes.txt", ""),
        ];
        let host = MemoryHost::new(&files)
            .module("node:fs", 3)
            .module("node:path", 5);
        let resolve =
            |prefix, suffix, kind| resolve_computed_in(&host, "/p/main.ts", prefix, suffix, kind);
        let locales = resolve("./locales/", ".json", Import);
        assert_eq!(locales, "/p/locales/en.json, /p/locales/fr.json");
        assert_eq!(resolve("node:", "", Require), "host:3, host:5");
        assert_eq!(resolve("./missing/", "", Import), "");
        assert_eq!(resolve("", ".js", Require), "All(NoConstantPrefix)");
        assert_eq!(resolve("", "fs", Require), "All(NoConstantPrefix), host:3");
    }

    #[test]
    fn parse_json_reads_every_value_kind() {
        let string = |text: &str| Json::String(text.into());
        assert_eq!(parse_json(b"null"), Some(Json::Null));
        assert_eq!(parse_json(b"true"), Some(Json::Bool(true)));
        assert_eq!(parse_json(b"false"), Some(Json::Bool(false)));
        assert_eq!(parse_json(b"0"), Some(Json::Number(0.0)));
        assert_eq!(parse_json(b"-12.5e+1"), Some(Json::Number(-125.0)));

        let escaped = parse_json(br#""a\"\\\/\n\tb""#);
        assert_eq!(escaped, Some(string("a\"\\/\n\tb")));

        let empty = Json::Array(Vec::new());
        let array = Json::Array(vec![Json::Number(1.0), string("x"), empty]);
        assert_eq!(parse_json(br#"[1, "x", []]"#), Some(array));

        let object = Json::Object(vec![
            (b"a".to_vec(), Json::Object(Vec::new())),
            (b"b".to_vec(), Json::Array(vec![Json::Null])),
        ]);
        let spaced = b" { \"a\" : { } ,\r\n\t\"b\" : [ null ] } ";
        assert_eq!(parse_json(spaced), Some(object));
    }

    #[test]
    fn parse_json_preserves_repeated_keys() {
        let entries = vec![
            (b"a".to_vec(), Json::Number(1.0)),
            (b"a".to_vec(), Json::Number(2.0)),
        ];
        let parsed = parse_json(br#"{"a": 1, "a": 2}"#);
        assert_eq!(parsed, Some(Json::Object(entries)));
    }

    #[test]
    fn parse_json_rejects_invalid_text() {
        let invalid: [&[u8]; 16] = [
            b"{} // comment",
            b"/* comment */ {}",
            b"[1,]",
            b"{\"a\": 1,}",
            b"1 2",
            b"{} {}",
            b"",
            b"{a: 1}",
            b"'a'",
            b"\"a",
            b"\"\\u0041\"",
            b"\"a\nb\"",
            b"nul",
            b"01",
            b"+1",
            b"1.",
        ];
        for text in invalid {
            assert_eq!(parse_json(text), None, "{}", bstr::BStr::new(text));
        }
    }
}
