use super::search::is_in_node_modules;
use super::*;
use crate::atom::{Atom, Interner};
use crate::hir::JsxPragmas;
use bun_core::identifier::is_identifier;
use std::sync::OnceLock;

// `bun run` holds an `extends` chain in an array of this size and rejects a longer one, which also ends a cycle.
const MAX_EXTENDED_CONFIGS: usize = 64;
const CONFIG_FILE_NAMES: [&[u8]; 2] = [b"tsconfig.json", b"jsconfig.json"];

#[derive(Copy, Clone, PartialEq, Eq, Hash, Debug)]
pub enum JsxRuntime {
    Automatic,
    Classic,
}

#[derive(Clone, PartialEq, Eq, Hash, Debug)]
pub struct JsxSettings {
    pub runtime: JsxRuntime,
    pub is_development: bool,
    pub factory: Vec<Vec<u8>>,
    pub fragment: Vec<Vec<u8>>,
    pub import_source: Vec<u8>,
}

impl Default for JsxSettings {
    fn default() -> JsxSettings {
        JsxSettings {
            runtime: JsxRuntime::Automatic,
            is_development: true,
            factory: vec![b"React".to_vec(), b"createElement".to_vec()],
            fragment: vec![b"React".to_vec(), b"Fragment".to_vec()],
            import_source: b"react".to_vec(),
        }
    }
}

impl JsxSettings {
    pub fn runtime_specifier(&self) -> Vec<u8> {
        let subpath: &[u8] = match self.is_development {
            true => b"/jsx-dev-runtime",
            false => b"/jsx-runtime",
        };
        [self.import_source.as_slice(), subpath].concat()
    }

    pub fn with_pragmas(&self, pragmas: &JsxPragmas, atoms: &Interner<'_>) -> Option<JsxSettings> {
        if *pragmas == JsxPragmas::default() {
            return None;
        }
        let text = |atom: Atom| atom.is_some().then(|| atoms.bytes(atom));
        let runtime = pragmas.classic.map(|is_classic| match is_classic {
            true => JsxRuntime::Classic,
            false => JsxRuntime::Automatic,
        });
        let fields = JsxFields {
            runtime,
            is_development: None,
            factory: text(pragmas.factory).and_then(split_members),
            fragment: text(pragmas.fragment_factory).and_then(split_members),
            import_source: text(pragmas.import_source).map(<[u8]>::to_vec),
        };
        Some(fields.apply_to(self))
    }
}

#[derive(Clone, PartialEq, Eq, Hash, Debug)]
pub struct TranspileSettings {
    pub jsx: JsxSettings,
    pub experimental_decorators: bool,
    pub emits_decorator_metadata: bool,
    pub use_define_for_class_fields: Option<bool>,
}

pub(in crate::resolve) struct CodeConfig<'h> {
    pub base_url: Option<&'h [u8]>,
    /// The keys of `paths`.
    paths: &'h [&'h [u8]],
    pub settings: &'h TranspileSettings,
}

impl<'h> CodeConfig<'h> {
    pub(in crate::resolve) fn can_match_prefix(&self, prefix: &[u8]) -> bool {
        self.paths.iter().any(|&key| {
            let Some(star) = strings::index_of_char_usize(key, b'*') else {
                return key.starts_with(prefix);
            };
            let key_prefix = &key[..star];
            key_prefix.starts_with(prefix) || prefix.starts_with(key_prefix)
        })
    }
}

pub(in crate::resolve) struct ConfigCaches<'h> {
    by_directory: Memo<&'h [u8], Option<&'h CodeConfig<'h>>>,
    override_config: OnceLock<Option<&'h CodeConfig<'h>>>,
    default_settings: OnceLock<&'h TranspileSettings>,
    aot_package_settings: Memo<&'h [u8], &'h TranspileSettings>,
    is_development: OnceLock<bool>,
}

impl<'h> ConfigCaches<'h> {
    pub(in crate::resolve) fn new(are_small: bool) -> ConfigCaches<'h> {
        ConfigCaches {
            by_directory: Memo::new(are_small),
            override_config: OnceLock::new(),
            default_settings: OnceLock::new(),
            aot_package_settings: Memo::new(are_small),
            is_development: OnceLock::new(),
        }
    }
}

#[derive(Default)]
struct JsxFields {
    runtime: Option<JsxRuntime>,
    is_development: Option<bool>,
    factory: Option<Vec<Vec<u8>>>,
    fragment: Option<Vec<Vec<u8>>>,
    import_source: Option<Vec<u8>>,
}

impl JsxFields {
    fn parse(options: &Json) -> JsxFields {
        let identifiers = |key: &[u8]| {
            let members = split_members(string_entry(options, key)?)?;
            let are_identifiers = members.iter().all(|it| is_identifier(it));
            are_identifiers.then_some(members)
        };
        let emit = string_entry(options, b"jsx").and_then(parse_jsx_emit);
        JsxFields {
            runtime: emit.map(|emit| emit.0),
            is_development: emit.and_then(|emit| emit.1),
            factory: identifiers(b"jsxFactory"),
            fragment: identifiers(b"jsxFragmentFactory"),
            import_source: string_entry(options, b"jsxImportSource").map(<[u8]>::to_vec),
        }
    }

    fn inherit(&mut self, parent: JsxFields) {
        self.runtime = self.runtime.or(parent.runtime);
        self.is_development = self.is_development.or(parent.is_development);
        self.factory = self.factory.take().or(parent.factory);
        self.fragment = self.fragment.take().or(parent.fragment);
        self.import_source = self.import_source.take().or(parent.import_source);
    }

    fn apply_to(&self, base: &JsxSettings) -> JsxSettings {
        let factory = self.factory.as_ref().unwrap_or(&base.factory);
        let fragment = self.fragment.as_ref().unwrap_or(&base.fragment);
        let import_source = self.import_source.as_ref().unwrap_or(&base.import_source);
        JsxSettings {
            runtime: self.runtime.unwrap_or(base.runtime),
            is_development: self.is_development.unwrap_or(base.is_development),
            factory: factory.clone(),
            fragment: fragment.clone(),
            import_source: import_source.clone(),
        }
    }
}

#[derive(Default)]
struct ParsedConfig {
    extends: Option<Vec<u8>>,
    base_url: Option<Vec<u8>>,
    paths: Option<Paths>,
    jsx: JsxFields,
    emits_decorator_metadata: bool,
    experimental_decorators: bool,
    use_define_for_class_fields: Option<bool>,
    has_compiler_options: bool,
}

impl ParsedConfig {
    fn parse(path: &[u8], json: &Json) -> ParsedConfig {
        let config_dir = dirname::<Posix>(path);
        let extends = string_entry(json, b"extends")
            .filter(|text| !text.is_empty() && !is_in_node_modules(config_dir))
            .map(|text| join(config_dir, text));
        let Some(options) = get_first(json, b"compilerOptions") else {
            return ParsedConfig {
                extends,
                ..ParsedConfig::default()
            };
        };
        let written_base_url = string_entry(options, b"baseUrl");
        // An empty `baseUrl` sets no base, but still allows substitutions that are not relative.
        let has_base_url = written_base_url.is_some();
        let base_url = written_base_url
            .map(|text| replace_config_dir(text, config_dir))
            .filter(|text| !text.is_empty())
            .map(|text| join(config_dir, &text));
        let paths = get_first(options, b"paths").and_then(Json::as_object);
        ParsedConfig {
            extends,
            paths: paths.map(|entries| parse_paths(entries, config_dir, has_base_url)),
            base_url,
            jsx: JsxFields::parse(options),
            emits_decorator_metadata: bool_entry(options, b"emitDecoratorMetadata") == Some(true),
            experimental_decorators: bool_entry(options, b"experimentalDecorators") == Some(true),
            use_define_for_class_fields: bool_entry(options, b"useDefineForClassFields"),
            has_compiler_options: true,
        }
    }

    fn inherit(&mut self, parent: ParsedConfig) {
        self.extends = parent.extends;
        self.base_url = self.base_url.take().or(parent.base_url);
        if self.paths.is_none() {
            self.paths = parent.paths;
        }
        self.jsx.inherit(parent.jsx);
        self.emits_decorator_metadata |= parent.emits_decorator_metadata;
        // `bun run` never merges this option, so the last file of the chain decides.
        self.experimental_decorators = parent.experimental_decorators;
        let use_define = parent.use_define_for_class_fields;
        self.use_define_for_class_fields = self.use_define_for_class_fields.or(use_define);
    }
}

impl<'h> Resolver<'h> {
    pub(in crate::resolve) fn enclosing_code_config(
        &self,
        directory: &[u8],
    ) -> Option<&'h CodeConfig<'h>> {
        if !self.is_under_tsconfig_override(directory) {
            return self.nearest_code_config(directory);
        }
        let load = || self.load_config(&self.override_path()?);
        *self.config_caches().override_config.get_or_init(load)
    }

    pub(crate) fn is_under_tsconfig_override(&self, _directory: &[u8]) -> bool {
        self.code_options().tsconfig_override.is_some()
    }

    pub(crate) fn transpiles_by_working_directory(&self) -> bool {
        self.code_options().transpiles_by_working_directory
    }

    pub fn transpile_settings(&self, path: &[u8]) -> &'h TranspileSettings {
        if self.is_aot_source_of_dependency(path) {
            return self.aot_package_settings(dirname::<Posix>(path));
        }
        let config = match self.transpiles_by_working_directory() {
            true => self.enclosing_code_config(&self.code_options().working_directory),
            false => self.enclosing_code_config(&self.code_host().directory_of(path)),
        };
        let create_default = || self.create_settings(&ParsedConfig::default());
        let default_settings = &self.config_caches().default_settings;
        match config {
            Some(config) => config.settings,
            None => *default_settings.get_or_init(create_default),
        }
    }

    /// TypeScript in a package with the "aot" condition, unless the program runs inside that package.
    fn is_aot_source_of_dependency(&self, path: &[u8]) -> bool {
        let working_directory = &self.code_options().working_directory;
        !is_javascript_file(self.host, path)
            && (self.aot_package_directory(path)).is_some_and(|package| {
                !contains_path(package, working_directory, self.host.is_case_sensitive())
            })
    }

    /// The `compilerOptions` of the package's own `package.json` decide how its TypeScript runs. No `tsconfig.json`
    /// and no flag of the program that installs it does, so the package answers alike in every program.
    fn aot_package_settings(&self, directory: &[u8]) -> &'h TranspileSettings {
        let by_directory = &self.config_caches().aot_package_settings;
        if let Some(&known) = by_directory.get_ref(directory) {
            return known;
        }
        // As `find_package_with_compiler_options` has it, which finds the options that the files are type checked under.
        let stated = ancestors(directory)
            .take_while(|&ancestor| strings::basename_posix(ancestor) != b"node_modules")
            .map(|ancestor| inside(ancestor, b"package.json"))
            .filter(|path| self.is_file(path))
            .find_map(|path| self.read_config(&path).filter(|it| it.has_compiler_options));
        let stated = stated.unwrap_or_default();
        let options = self.code_options();
        let is_development = (options.forced_jsx_development)
            .or(stated.jsx.is_development)
            .unwrap_or(options.jsx.is_development);
        let settings = self.session.keep(TranspileSettings {
            jsx: JsxSettings {
                is_development,
                ..stated.jsx.apply_to(&JsxSettings::default())
            },
            experimental_decorators: stated.experimental_decorators,
            emits_decorator_metadata: stated.emits_decorator_metadata,
            use_define_for_class_fields: stated.use_define_for_class_fields,
        });
        *by_directory.insert_ref(self.keep(directory), settings)
    }

    fn nearest_code_config(&self, directory: &[u8]) -> Option<&'h CodeConfig<'h>> {
        let by_directory = &self.config_caches().by_directory;
        let mut config = None;
        let mut unknown_count = 0;
        for ancestor in ancestors(directory) {
            if let Some(&known) = by_directory.get_ref(ancestor) {
                config = known;
                break;
            }
            unknown_count += 1;
            if let Some(path) = self.find_config_file(ancestor) {
                // A file that fails to load still hides the files above it.
                config = self.load_config(&path);
                break;
            }
        }
        for ancestor in ancestors(directory).take(unknown_count) {
            by_directory.insert_ref(self.keep(ancestor), config);
        }
        config
    }

    fn find_config_file(&self, directory: &[u8]) -> Option<Vec<u8>> {
        if !directory.starts_with(b"/") {
            return None;
        }
        let mut paths = CONFIG_FILE_NAMES.iter().map(|it| inside(directory, it));
        paths.find(|path| self.is_file(path))
    }

    fn override_path(&self) -> Option<Vec<u8>> {
        let path = self.code_options().tsconfig_override.as_deref()?;
        Some(match self.host.is_dir(path) {
            true => inside(path, b"tsconfig.json"),
            false => path.to_vec(),
        })
    }

    fn load_config(&self, path: &[u8]) -> Option<&'h CodeConfig<'h>> {
        let merged = self.load_merged(path)?;
        let session: &'h Session = self.session;
        let arena = session.arena();
        let entries = merged.paths.as_deref().unwrap_or_default();
        let paths = entries.iter().map(|(key, _)| self.keep(key));
        let config: &'h CodeConfig<'h> = arena.alloc(CodeConfig {
            base_url: merged.base_url.as_deref().map(|it| self.keep(it)),
            paths: arena.alloc_slice_fill_iter(paths),
            settings: self.create_settings(&merged),
        });
        Some(config)
    }

    fn load_merged(&self, path: &[u8]) -> Option<ParsedConfig> {
        let mut merged = self.read_config(path)?;
        let mut config_count = 1;
        while let Some(parent) = merged.extends.take().and_then(|it| self.read_config(&it)) {
            if config_count == MAX_EXTENDED_CONFIGS {
                return None;
            }
            config_count += 1;
            merged.inherit(parent);
        }
        Some(merged)
    }

    fn read_config(&self, path: &[u8]) -> Option<ParsedConfig> {
        let text = self.host.read(path)?;
        let arena = self.session.arena();
        let json = self.code_host().parse_runtime_tsconfig(arena, &text)?;
        Some(ParsedConfig::parse(path, &json))
    }

    fn create_settings(&self, config: &ParsedConfig) -> &'h TranspileSettings {
        let session: &'h Session = self.session;
        session.keep(TranspileSettings {
            jsx: JsxSettings {
                is_development: self.is_jsx_development(),
                ..config.jsx.apply_to(&self.code_options().jsx)
            },
            experimental_decorators: config.experimental_decorators,
            emits_decorator_metadata: config.emits_decorator_metadata,
            use_define_for_class_fields: config.use_define_for_class_fields,
        })
    }

    fn is_jsx_development(&self) -> bool {
        *self.config_caches().is_development.get_or_init(|| {
            let options = self.code_options();
            if let Some(forced) = options.forced_jsx_development {
                return forced;
            }
            let find_in_working_directory = || self.find_config_file(&options.working_directory);
            let path = self.override_path().or_else(find_in_working_directory);
            let merged = path.and_then(|path| self.load_merged(&path));
            let written = merged.and_then(|merged| merged.jsx.is_development);
            written.unwrap_or(options.jsx.is_development)
        })
    }
}

fn string_entry<'j>(json: &'j Json, key: &[u8]) -> Option<&'j [u8]> {
    get_first(json, key)?.as_str()
}

fn bool_entry(json: &Json, key: &[u8]) -> Option<bool> {
    get_first(json, key)?.as_bool()
}

fn parse_jsx_emit(name: &[u8]) -> Option<(JsxRuntime, Option<bool>)> {
    match name.to_ascii_lowercase().as_slice() {
        b"classic" | b"react" => Some((JsxRuntime::Classic, None)),
        b"automatic" => Some((JsxRuntime::Automatic, None)),
        b"react-jsx" => Some((JsxRuntime::Automatic, Some(false))),
        b"react-jsxdev" => Some((JsxRuntime::Automatic, Some(true))),
        _ => None,
    }
}

fn split_members(text: &[u8]) -> Option<Vec<Vec<u8>>> {
    let members: Vec<Vec<u8>> = strings::tokenize(text, b".").map(<[u8]>::to_vec).collect();
    (!members.is_empty()).then_some(members)
}

fn parse_paths(entries: &[(Vec<u8>, Json)], config_dir: &[u8], has_base_url: bool) -> Paths {
    let mut paths = Paths::new();
    for (key, value) in entries.iter().filter(|entry| is_valid_pattern(&entry.0)) {
        let Some(items) = value.as_array() else {
            continue;
        };
        let substitutions: Vec<Vec<u8>> = items
            .iter()
            .filter_map(Json::as_str)
            .map(|text| replace_config_dir(text, config_dir))
            .filter(|text| is_valid_pattern(text) && (has_base_url || is_relative_or_rooted(text)))
            .collect();
        if substitutions.is_empty() {
            continue;
        }
        match paths.iter_mut().find(|entry| entry.0 == *key) {
            Some(entry) => entry.1 = substitutions,
            None => paths.push((key.clone(), substitutions)),
        }
    }
    paths
}

fn replace_config_dir(text: &[u8], config_dir: &[u8]) -> Vec<u8> {
    let directory = inside(config_dir, b"");
    // Drops a separator after the template: `directory` ends in one, and `//` would start a UNC path.
    let text = strings::replace_owned(text, b"${configDir}/", &directory);
    strings::replace_owned(&text, b"${configDir}", &directory)
}

fn is_valid_pattern(text: &[u8]) -> bool {
    strings::count_char(text, b'*') <= 1
}

fn is_relative_or_rooted(text: &[u8]) -> bool {
    path_is_relative(text)
        || matches!(text, [b'/' | b'\\', _, _, ..])
        || matches!(text, [drive, b':', b'/' | b'\\', ..] if drive.is_ascii_alphabetic())
}

#[cfg(test)]
mod tests;
