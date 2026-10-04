//! Resolves an import specifier to the file that has its types: TypeScript's `moduleResolution:
//! "bundler"`, `"node16"` and `"nodenext"`.

use crate::hir::ResolutionMode;
use crate::json::Json;
use crate::session::Session;
use crate::util::ShardedMap;
use bstr::ByteSlice;
use bun_core::strings;
use bun_paths::platform::Posix;
use bun_paths::resolve_path::dirname;
use std::borrow::Cow;
use std::cell::{Cell, RefCell};
use std::cmp::Ordering;
use std::time::{Duration, Instant};

/// The phases of loading a program, for timing. `Discover`, `Link` and `Merge` run on one thread,
/// and `Aliases` is the time of the thread that waits for it. The others run on all threads in
/// parallel, and the time of every thread is counted.
#[derive(Copy, Clone, Debug)]
pub enum Phase {
    /// The configuration files, the directories traversed for `include`, the search for the
    /// libraries.
    Discover,
    Read,
    Parse,
    /// From Bun's AST to `hir`.
    Lower,
    Bind,
    /// Resolution of the imports and the `/// <reference>`s of a file.
    Resolve,
    /// The files are numbered in the order they refer to each other.
    Link,
    Merge,
    /// `Files::link`: the exports and the aliases of every module.
    Aliases,
}

impl Phase {
    pub const ALL: [Phase; 9] = [
        Phase::Discover,
        Phase::Read,
        Phase::Parse,
        Phase::Lower,
        Phase::Bind,
        Phase::Resolve,
        Phase::Link,
        Phase::Merge,
        Phase::Aliases,
    ];
}

/// On drop, reports its lifetime to the host.
pub struct Spent<'a>(&'a dyn Host, Phase, Instant);

impl<'a> Spent<'a> {
    pub fn on(host: &'a dyn Host, phase: Phase) -> Spent<'a> {
        Spent(host, phase, Instant::now())
    }
}

impl Drop for Spent<'_> {
    fn drop(&mut self) {
        self.0.spent(self.1, self.2.elapsed());
    }
}

/// The file system, and the parser. The bundler has its own of both.
pub trait Host: Sync {
    /// One thread has spent `time` on `phase`. Only a host whose `times` is queried accumulates it.
    fn spent(&self, _phase: Phase, _time: Duration) {}
    /// The totals reported to `spent` so far, in the order of `Phase::ALL`.
    fn times(&self) -> [Duration; Phase::ALL.len()] {
        [Duration::ZERO; Phase::ALL.len()]
    }
    /// The contents of the file. As in `bun_ast::Source`: a host that already holds them, as the
    /// bundler does for every file it has loaded, lends them, and nothing is read or copied.
    fn read(&self, path: &[u8]) -> Option<Cow<'static, [u8]>>;
    /// Reads a source file of the program. A file that cannot be read is loaded as an empty file and returned by `take_unreadable`.
    fn read_source(&self, path: &[u8]) -> Cow<'static, [u8]> {
        self.read(path).unwrap_or_default()
    }
    /// The paths for which `read_source` has failed since the last call.
    fn take_unreadable(&self) -> Vec<Vec<u8>> {
        Vec::new()
    }
    fn is_file(&self, path: &[u8]) -> bool;
    fn is_dir(&self, path: &[u8]) -> bool;
    /// With symbolic links followed.
    fn realpath(&self, path: &[u8]) -> Vec<u8>;
    fn list_dir(&self, path: &[u8]) -> Vec<Vec<u8>>;
    /// `GetAccessibleEntries`: the names of the files and of the directories in `path`, each sorted.
    fn entries(&self, path: &[u8]) -> (Vec<Vec<u8>>, Vec<Vec<u8>>) {
        let (mut directories, mut files): (Vec<Vec<u8>>, Vec<Vec<u8>>) = self
            .list_dir(path)
            .into_iter()
            .partition(|name| self.is_dir(&join(path, name)));
        files.sort();
        directories.sort();
        (files, directories)
    }
    /// `UseCaseSensitiveFileNames`
    fn is_case_sensitive(&self) -> bool {
        true
    }
    /// The lists of the result are in `arena`, which belongs to the calling thread.
    fn parse<'s>(
        &self,
        arena: &'s crate::session::Arena,
        path: &[u8],
        text: &[u8],
        atoms: &crate::atom::Interner<'s>,
        options: &Options,
    ) -> crate::hir::File<'s>;
    /// `packagejson.Parse`. `None`: `text` is not an object in JSON, and typescript-go goes on as
    /// if the file had no fields. What the parser leaves in `arena`, which belongs to the calling
    /// thread, is garbage.
    fn parse_package_json(&self, arena: &crate::session::Arena, text: &[u8]) -> Option<Json>;
    /// Calls `work` with every index below `count`, on any number of threads.
    fn parallel(&self, count: usize, work: &(dyn Fn(usize) + Sync));
    /// A program is loaded, and `parse` is not called again before it is checked: what the threads
    /// retain for the next file can be freed. Outside `parallel`.
    fn loaded(&self) {}
    /// The number of threads `parallel` uses.
    fn threads(&self) -> usize {
        1
    }
    /// The threads that only read files: `bun_threading::io_thread_pool`. `None`: the threads of
    /// `parallel` read the files that they process.
    fn io_pool(&self) -> Option<&bun_threading::ThreadPool> {
        None
    }
}

#[derive(Default, Copy, Clone, PartialEq, Eq, PartialOrd, Ord, Debug)]
pub enum ModuleKind {
    CommonJs,
    Amd,
    Umd,
    System,
    Es2015,
    Es2020,
    #[default]
    Es2022,
    EsNext,
    Node16,
    Node18,
    Node20,
    NodeNext,
    Preserve,
}

impl ModuleKind {
    /// Whether the module format of each file, CommonJS or ECMAScript module, is determined by its
    /// extension and its `package.json`.
    pub fn is_node(self) -> bool {
        (ModuleKind::Node16..=ModuleKind::NodeNext).contains(&self)
    }

    /// `ModuleKind.String`
    pub fn name(self) -> &'static [u8] {
        match self {
            ModuleKind::CommonJs => b"CommonJS",
            ModuleKind::Amd => b"AMD",
            ModuleKind::Umd => b"UMD",
            ModuleKind::System => b"System",
            ModuleKind::Es2015 => b"ES2015",
            ModuleKind::Es2020 => b"ES2020",
            ModuleKind::Es2022 => b"ES2022",
            ModuleKind::EsNext => b"ESNext",
            ModuleKind::Node16 => b"Node16",
            ModuleKind::Node18 => b"Node18",
            ModuleKind::Node20 => b"Node20",
            ModuleKind::NodeNext => b"NodeNext",
            ModuleKind::Preserve => b"Preserve",
        }
    }
}

bun_core::comptime_string_map! {
    /// `moduleOptionMap`, plus its former entries.
    static MODULE_KINDS: ModuleKind = {
        b"commonjs" => ModuleKind::CommonJs,
        b"amd" => ModuleKind::Amd,
        b"umd" => ModuleKind::Umd,
        b"system" => ModuleKind::System,
        b"es6" => ModuleKind::Es2015,
        b"es2015" => ModuleKind::Es2015,
        b"es2020" => ModuleKind::Es2020,
        b"es2022" => ModuleKind::Es2022,
        b"esnext" => ModuleKind::EsNext,
        b"node16" => ModuleKind::Node16,
        b"node18" => ModuleKind::Node18,
        b"node20" => ModuleKind::Node20,
        b"nodenext" => ModuleKind::NodeNext,
        b"preserve" => ModuleKind::Preserve,
    };
}

/// `core.ScriptTarget`. Ordered: a later target includes everything an earlier one has.
#[derive(Default, Copy, Clone, PartialEq, Eq, PartialOrd, Ord, Debug)]
pub enum ScriptTarget {
    /// `target` is not specified.
    #[default]
    None,
    ES5,
    ES2015,
    ES2016,
    ES2017,
    ES2018,
    ES2019,
    ES2020,
    ES2021,
    ES2022,
    ES2023,
    ES2024,
    ES2025,
    ESNext,
}

bun_core::comptime_string_map! {
    /// `targetOptionMap`, plus its former entries.
    static SCRIPT_TARGETS: ScriptTarget = {
        b"es3" => ScriptTarget::ES5,
        b"es5" => ScriptTarget::ES5,
        b"es6" => ScriptTarget::ES2015,
        b"es2015" => ScriptTarget::ES2015,
        b"es2016" => ScriptTarget::ES2016,
        b"es2017" => ScriptTarget::ES2017,
        b"es2018" => ScriptTarget::ES2018,
        b"es2019" => ScriptTarget::ES2019,
        b"es2020" => ScriptTarget::ES2020,
        b"es2021" => ScriptTarget::ES2021,
        b"es2022" => ScriptTarget::ES2022,
        b"es2023" => ScriptTarget::ES2023,
        b"es2024" => ScriptTarget::ES2024,
        b"es2025" => ScriptTarget::ES2025,
        b"esnext" => ScriptTarget::ESNext,
    };
}

#[derive(Default, Copy, Clone, PartialEq, Eq, Debug)]
pub enum JsxEmit {
    #[default]
    None,
    Preserve,
    ReactNative,
    React,
    ReactJsx,
    ReactJsxDev,
}

bun_core::comptime_string_map! {
    /// `jsxOptionMap`
    static JSX_EMITS: JsxEmit = {
        b"preserve" => JsxEmit::Preserve,
        b"react-native" => JsxEmit::ReactNative,
        b"react" => JsxEmit::React,
        b"react-jsx" => JsxEmit::ReactJsx,
        b"react-jsxdev" => JsxEmit::ReactJsxDev,
    };
}

/// `core.ModuleDetectionKind`: what makes a file that is not a declaration file a module.
#[derive(Default, Copy, Clone, PartialEq, Eq, Debug)]
pub enum ModuleDetection {
    /// An `import`, an `export` or `import.meta`; a JSX tag that imports its factory; the format
    /// implied by its file name or its package.
    #[default]
    Auto,
    /// An `import`, an `export` or `import.meta`.
    Legacy,
    /// No indicator is required.
    Force,
}

impl Options {
    /// `getParseFileRedirect`: `OutputDts`, which is read in place of the file at `path` if that is a source of a referenced project.
    pub fn parse_file_redirect(&self, path: &[u8]) -> Option<&[u8]> {
        let sources = &self.referenced_sources;
        let index = sources
            .binary_search_by(|it| it.0.as_slice().cmp(path))
            .ok()?;
        Some(sources[index].1.as_slice()).filter(|output| !output.is_empty())
    }

    /// `GetSourceOfProjectReferenceIfOutputIncluded`: the source that the declaration file at `path` is read in place of, else `path`.
    pub fn source_of_project_reference_if_output_included<'a>(
        &'a self,
        path: &'a [u8],
    ) -> &'a [u8] {
        let outputs = &self.referenced_output_dts;
        match outputs.binary_search_by(|it| it.0.as_slice().cmp(path)) {
            Ok(index) => &self.referenced_sources[outputs[index].1 as usize].0,
            Err(_) => path,
        }
    }
}

#[derive(Default, Clone, Debug)]
pub struct Options {
    /// The directory of `tsconfig.json`. Absolute, no trailing slash.
    pub base_dir: Vec<u8>,
    /// `compilerOptions.paths`: a pattern with at most one `*`, and the substitutions to try for
    /// it.
    pub paths: Vec<(Vec<u8>, Vec<Vec<u8>>)>,
    /// `PathsBasePath`: the directory of the configuration file that specifies `paths`, which they
    /// are relative to.
    pub paths_base_dir: Vec<u8>,
    /// `skipLibCheck`: declaration files are not checked. `skipDefaultLibCheck`: TypeScript's own are not.
    pub skip_lib_check: bool,
    pub skip_default_lib_check: bool,
    /// `noCheck`: only syntax errors are reported.
    pub no_check: bool,
    /// A file that nothing refers to is parsed only when it is checked, and freed afterwards with
    /// everything computed about it. Not a TypeScript option. A caller that wants to query such a
    /// file afterwards leaves it off.
    pub drops_unreferenced: bool,
    /// `GetSuggestionDiagnostics` are reported as well. Not a TypeScript option: its tests use
    /// `@captureSuggestions`.
    pub captures_suggestions: bool,
    /// Each file is emitted before it is checked. Not a TypeScript option: its tests read types and
    /// symbols from such a program.
    pub emits_first: bool,
    /// `GetCurrentDirectory`
    pub current_directory: Vec<u8>,
    /// Where `lib.*.d.ts` are.
    pub lib_dir: Vec<u8>,
    /// The `N` of each `lib.N.d.ts` to start from: the entries of `compilerOptions.lib`, or the
    /// default for the target.
    pub libs: Vec<Vec<u8>>,
    /// `noLib`: no libraries are loaded, and `/// <reference lib>` is ignored.
    pub no_lib: bool,
    /// `libReplacement`: `lib.dom.d.ts` is replaced by the package `@typescript/lib-dom`, if it
    /// exists.
    pub lib_replacement: bool,
    /// `traceResolution`
    pub trace_resolution: bool,
    /// `compilerOptions.types`.
    pub types: Option<Vec<Vec<u8>>>,
    /// `typeRoots`, as absolute paths.
    pub type_roots: Option<Vec<Vec<u8>>>,
    /// `noResolve`: `/// <reference path>` and `/// <reference types>` are ignored, and imports add
    /// no files to the program.
    pub no_resolve: bool,
    /// `customConditions`: conditions that match in the `exports` and `imports` of a
    /// `package.json`, in addition to the default ones.
    pub custom_conditions: Vec<Vec<u8>>,
    /// `getNodeResolutionFeatures`: the `exports` and the `imports` of a `package.json` are
    /// honored. Only bundler resolution can disable this.
    pub resolve_package_json_exports: bool,
    pub resolve_package_json_imports: bool,
    /// `rootDirs`, as absolute paths: directories that are treated as one directory when a relative
    /// specifier is resolved.
    pub root_dirs: Vec<Vec<u8>>,
    /// `moduleSuffixes`: suffixes inserted before the extension of a candidate file name, in the
    /// order they are tried.
    pub module_suffixes: Vec<Vec<u8>>,
    /// `preserveSymlinks`: a file of a package keeps the path it was found at instead of its real
    /// path.
    pub preserve_symlinks: bool,
    pub no_unchecked_indexed_access: bool,
    pub no_property_access_from_index_signature: bool,
    /// Built-in iterators of arrays, maps and the like have the return type `undefined`, not `any`.
    pub strict_builtin_iterator_return: bool,
    pub exact_optional_property_types: bool,
    /// Selects the decorator syntax the parser expects. `accessor` fields belong to the standard
    /// decorators.
    pub experimental_decorators: bool,
    /// The `strict` family: each option has its own value if specified, otherwise the value of
    /// `strict`, which defaults to true.
    pub strict_null_checks: bool,
    pub no_implicit_any: bool,
    pub strict_function_types: bool,
    pub strict_bind_call_apply: bool,
    pub use_unknown_in_catch_variables: bool,
    pub strict_property_initialization: bool,
    pub no_implicit_this: bool,
    pub allow_unreachable_code: Option<bool>,
    pub allow_unused_labels: Option<bool>,
    pub no_implicit_returns: bool,
    pub no_implicit_override: bool,
    pub no_fallthrough_cases_in_switch: bool,
    pub no_unused_locals: bool,
    pub no_unused_parameters: bool,
    pub resolve_json_module: bool,
    pub no_unchecked_side_effect_imports: bool,
    /// `deduplicatePackages: false`: two installed copies of a package are distinct packages.
    pub retains_duplicate_packages: bool,
    pub allow_js: bool,
    /// `maxNodeModuleJsDepth`: with `allowJs`, JavaScript is loaded up to this many imports deep into packages.
    pub max_node_module_js_depth: u32,
    /// `checkJs`. Unspecified is a third state: see `Checker::is_plain_js`.
    pub check_js: Option<bool>,
    /// The error codes of the configuration diagnostics, in order, deduplicated.
    pub errors: Vec<u32>,
    /// The same diagnostics with their full details.
    pub problems: Vec<crate::verify::Problem>,
    /// `ConfigFilePath != ""`
    pub has_config_file: bool,
    /// `suppressOutputPathCheck`: skips the check that an output file would overwrite an input
    /// file. Only tests set it.
    pub suppress_output_path_check: bool,
    /// `outDir`, `rootDir`, `declarationDir`, as absolute paths. Empty if unspecified.
    pub out_dir: Vec<u8>,
    pub root_dir: Vec<u8>,
    pub declaration_dir: Vec<u8>,
    /// For each referenced project that emits into a separate directory: its declaration output
    /// directory and its `rootDir`.
    pub referenced_outputs: Vec<(Vec<u8>, Vec<u8>)>,
    /// `sourceToProjectReference`, sorted: for each file of the referenced projects, `Source`,
    /// `OutputDts`, and the index in `referenced_options` of `Resolved`. `tsc -b` reads the
    /// declaration file in place of the source (`getParseFileRedirect`). `OutputDts` is empty if no
    /// declaration file is emitted for the file.
    pub referenced_sources: Vec<(Vec<u8>, Vec<u8>, u32)>,
    /// `outputDtsToProjectReference`, sorted: `OutputDts` and its index in `referenced_sources`.
    pub referenced_output_dts: Vec<(Vec<u8>, u32)>,
    /// The options of the referenced projects that have a file in `referenced_sources`.
    pub referenced_options: Vec<Options>,
    /// A later project of a `tsc -b` run reads the declaration files of this one: `Report::declaration_files` has them.
    pub writes_declaration_files: bool,
    /// `ConfigFilePath`. Empty if there is none.
    pub config_path: Vec<u8>,
    /// The configuration file has `references`.
    pub has_project_references: bool,
    /// `validatedFilesSpec`, as absolute paths.
    pub file_specs: Vec<Vec<u8>>,
    /// `validatedIncludeSpecsBeforeSubstitution`, each paired with the corresponding entry of
    /// `validatedIncludeSpecs`.
    pub include_specs: Vec<(Vec<u8>, Vec<u8>)>,
    /// `isDefaultIncludeSpec`
    pub is_default_include_spec: bool,
    /// `noEmit`, `emitDeclarationOnly`, `composite`
    pub no_emit: bool,
    pub emit_declaration_only: bool,
    pub composite: bool,
    /// `sourceMap` without `inlineSourceMap`, and `GetAreDeclarationMapsEnabled`.
    pub writes_source_maps: bool,
    pub writes_declaration_maps: bool,
    /// `sourceRoot` or `mapRoot` is specified.
    pub specifies_source_or_map_root: bool,
    /// The specified `target`. `None` if unspecified.
    pub target: ScriptTarget,
    /// The effective `module`, specified or defaulted.
    pub module: ModuleKind,
    /// The effective `moduleResolution` is `node16` or `nodenext`, specified or defaulted.
    /// Otherwise it is `bundler`.
    pub resolves_like_node: bool,
    /// The effective `moduleResolution` is `node16`, which does not support `#/` in the `imports`
    /// of a `package.json` (`NodeResolutionFeaturesImportsPatternRoot`). `nodenext` and `bundler`
    /// do.
    pub resolves_like_node16: bool,
    /// `ModuleResolution` is `GetModuleResolutionKind()`: it is specified, and still supported.
    pub specifies_module_resolution: bool,
    /// `GetEmitModuleDetectionKind`: the effective `moduleDetection`, specified or defaulted.
    pub module_detection: ModuleDetection,
    /// The entries of `files`, as absolute paths.
    pub files: Vec<Vec<u8>>,
    pub jsx_import_source: Vec<u8>,
    /// The module that every source file imports implicitly: `react/jsx-runtime`. Empty if there is
    /// none.
    pub jsx_runtime: Vec<u8>,
    pub jsx: JsxEmit,
    /// `useDefineForClassFields`, as specified or as implied by the target.
    pub use_define_for_class_fields: bool,
    /// Class fields are emitted as in the source: the target supports them and no option overrides
    /// that.
    pub emit_standard_class_fields: bool,
    /// `GetIsolatedModules`: `isolatedModules`, or `verbatimModuleSyntax`.
    pub isolated_modules: bool,
    /// `isolatedModules` itself.
    pub isolated_modules_reported: bool,
    /// `preserveConstEnums` itself. `ShouldPreserveConstEnums` is this or `isolated_modules`.
    pub preserve_const_enums: bool,
    /// `verbatimModuleSyntax`
    pub verbatim_module_syntax: bool,
    /// `GetAllowImportingTsExtensions`: `allowImportingTsExtensions`, or `rewriteRelativeImportExtensions`.
    pub allow_importing_ts_extensions: bool,
    /// `rewriteRelativeImportExtensions`
    pub rewrite_relative_import_extensions: bool,
    /// `allowUmdGlobalAccess`
    pub allow_umd_global_access: bool,
    /// `erasableSyntaxOnly`
    pub erasable_syntax_only: bool,
    /// `isolatedDeclarations`, only when declaration files are emitted (`GetEmitDeclarations`): its
    /// errors are reported by declaration emit.
    pub isolated_declarations: bool,
    /// `GetEmitDeclarations`: `declaration`, or `composite`.
    pub emits_declarations: bool,
    /// `noEmitOnError`
    pub no_emit_on_error: bool,
    /// `removeComments`
    pub remove_comments: bool,
    /// `IsIncremental`: `incremental`, or `composite`.
    pub is_incremental: bool,
    /// `Build`: the program belongs to a `tsc -b` run. Set for a project with `references` and for every project it references.
    pub is_build: bool,
    /// `noErrorTruncation`
    pub no_error_truncation: bool,
    /// `emitDecoratorMetadata`
    pub emit_decorator_metadata: bool,
    /// `stripInternal`
    pub strips_internal_declarations: bool,
    /// `importHelpers`
    pub import_helpers: bool,
    /// `allowArbitraryExtensions`
    pub allow_arbitrary_extensions: bool,
    /// `jsxFactory`, `jsxFragmentFactory`, `reactNamespace`, as specified. Empty if unspecified.
    pub jsx_factory: Vec<u8>,
    pub jsx_fragment_factory: Vec<u8>,
    pub react_namespace: Vec<u8>,
}

impl Options {
    /// Whether `compilerOptions.lib` names the DOM.
    pub fn has_dom_lib(&self) -> bool {
        self.libs.iter().any(|l| l == b"dom")
    }

    /// `GetEffectiveTypeRoots`: `typeRoots`, or else the `node_modules/@types` of the project
    /// directory and of each of its ancestor directories.
    pub fn effective_type_roots(&self) -> Vec<Vec<u8>> {
        if let Some(roots) = &self.type_roots {
            return roots.clone();
        }
        ancestors(&self.base_dir)
            .map(|dir| join(dir, b"node_modules/@types"))
            .collect()
    }

    /// `getEmitSyntaxForUsageLocationWorker` for a plain `import` in a file whose emit format is
    /// `implied_format`: if the file name and its package do not determine the format, `module`
    /// does.
    pub fn default_mode(&self, implied_format: ResolutionMode) -> ResolutionMode {
        match implied_format {
            ResolutionMode::None => match self.module {
                ModuleKind::CommonJs => ResolutionMode::Require,
                ModuleKind::Es2015
                | ModuleKind::Es2020
                | ModuleKind::Es2022
                | ModuleKind::EsNext
                | ModuleKind::Preserve => ResolutionMode::Import,
                _ => ResolutionMode::None,
            },
            known => known,
        }
    }

    /// The same for the argument of `import()`, in a file whose plain `import`s have
    /// `default_mode`. `ShouldTransformImportCall`: the call is preserved unless the file is
    /// emitted in a module format older than ECMAScript modules.
    pub fn import_call_mode(&self, default_mode: ResolutionMode) -> ResolutionMode {
        if self.module.is_node()
            || self.module == ModuleKind::Preserve
            || default_mode == ResolutionMode::Import
        {
            ResolutionMode::Import
        } else {
            ResolutionMode::Require
        }
    }
}

impl Options {
    /// Builds the options from `compiler`, the `compilerOptions` of a configuration file in
    /// `base_dir`.
    pub fn from_compiler_options(base_dir: &[u8], compiler: &Json) -> Options {
        let mut options = Options {
            base_dir: base_dir.to_vec(),
            ..Default::default()
        };
        let specified = |name: &[u8]| compiler.get(name).and_then(Json::as_bool);
        let flag = |name: &[u8]| specified(name).unwrap_or(false);
        let word = |name: &[u8]| compiler.get(name).and_then(Json::as_str);
        let lower = |name: &[u8]| word(name).map(<[u8]>::to_ascii_lowercase);
        let text = |name: &[u8]| word(name).unwrap_or_default().to_vec();
        let list = |name: &[u8]| -> Option<Vec<&[u8]>> {
            let items = compiler.get(name)?.as_array()?;
            Some(items.iter().filter_map(Json::as_str).collect())
        };
        let words = |name: &[u8]| Some(list(name)?.into_iter().map(<[u8]>::to_vec).collect());
        let directories =
            |name: &[u8]| Some(list(name)?.into_iter().map(|d| join(base_dir, d)).collect());
        let directory = |name: &[u8]| match word(name) {
            None | Some(b"") => Vec::new(),
            Some(specified) => join(base_dir, specified),
        };
        let target = lower(b"target");
        options.paths_base_dir = word(b"pathsBasePath").unwrap_or(base_dir).to_vec();
        if let Some(paths) = compiler.get(b"paths").and_then(Json::as_object) {
            for (pattern, targets) in paths {
                let targets = targets.as_array().unwrap_or(&[]).iter();
                let targets = targets.filter_map(|t| t.as_str().map(<[u8]>::to_vec));
                options.paths.push((pattern.clone(), targets.collect()));
            }
        }
        options.no_lib = flag(b"noLib");
        options.libs = match (list(b"lib"), target.as_deref()) {
            _ if options.no_lib => Vec::new(),
            (Some(libs), _) => libs.into_iter().map(lib_name).collect(),
            // `GetDefaultLibFileName`. The empty name is `lib.d.ts`, for a target that
            // `targetToLibMap` does not have.
            (None, Some(b"es6" | b"es2015")) => vec![b"es6".to_vec()],
            (None, Some(b"es3" | b"es5")) => vec![Vec::new()],
            (None, target) => vec![[target.unwrap_or(b"es2025"), b".full"].concat()],
        };
        options.types = words(b"types");
        options.type_roots = directories(b"typeRoots");
        options.custom_conditions = words(b"customConditions").unwrap_or_default();
        options.root_dirs = directories(b"rootDirs").unwrap_or_default();
        options.module_suffixes = words(b"moduleSuffixes").unwrap_or_default();
        options.no_resolve = flag(b"noResolve");
        options.preserve_symlinks = flag(b"preserveSymlinks");
        options.lib_replacement = flag(b"libReplacement");
        options.trace_resolution = flag(b"traceResolution");
        options.no_unchecked_indexed_access = flag(b"noUncheckedIndexedAccess");
        options.no_property_access_from_index_signature =
            flag(b"noPropertyAccessFromIndexSignature");
        options.exact_optional_property_types = flag(b"exactOptionalPropertyTypes");
        options.allow_unreachable_code = specified(b"allowUnreachableCode");
        options.allow_unused_labels = specified(b"allowUnusedLabels");
        options.allow_umd_global_access = flag(b"allowUmdGlobalAccess");
        options.erasable_syntax_only = flag(b"erasableSyntaxOnly");
        options.composite = flag(b"composite");
        options.emits_declarations = flag(b"declaration") || options.composite;
        options.no_emit_on_error = flag(b"noEmitOnError");
        options.remove_comments = flag(b"removeComments");
        options.is_incremental = flag(b"incremental") || options.composite;
        options.isolated_declarations = flag(b"isolatedDeclarations") && options.emits_declarations;
        options.no_error_truncation = flag(b"noErrorTruncation");
        options.emit_decorator_metadata = flag(b"emitDecoratorMetadata");
        options.import_helpers = flag(b"importHelpers");
        options.no_emit = flag(b"noEmit");
        options.allow_arbitrary_extensions = flag(b"allowArbitraryExtensions");
        options.no_implicit_returns = flag(b"noImplicitReturns");
        options.no_implicit_override = flag(b"noImplicitOverride");
        options.no_fallthrough_cases_in_switch = flag(b"noFallthroughCasesInSwitch");
        options.no_unused_locals = flag(b"noUnusedLocals");
        options.no_unused_parameters = flag(b"noUnusedParameters");
        options.experimental_decorators = flag(b"experimentalDecorators");
        // Since TypeScript 6.0 `strict` defaults to true.
        let strict = specified(b"strict").unwrap_or(true);
        let strict_flag = |name: &[u8]| specified(name).unwrap_or(strict);
        options.strict_builtin_iterator_return = strict_flag(b"strictBuiltinIteratorReturn");
        options.strict_null_checks = strict_flag(b"strictNullChecks");
        options.no_implicit_any = strict_flag(b"noImplicitAny");
        options.strict_function_types = strict_flag(b"strictFunctionTypes");
        options.strict_bind_call_apply = strict_flag(b"strictBindCallApply");
        options.use_unknown_in_catch_variables = strict_flag(b"useUnknownInCatchVariables");
        options.strict_property_initialization = strict_flag(b"strictPropertyInitialization");
        options.no_implicit_this = strict_flag(b"noImplicitThis");
        options.no_unchecked_side_effect_imports =
            specified(b"noUncheckedSideEffectImports").unwrap_or(true);
        options.retains_duplicate_packages = specified(b"deduplicatePackages") == Some(false);
        options.check_js = specified(b"checkJs");
        options.allow_js = specified(b"allowJs").unwrap_or_else(|| options.check_js == Some(true));
        if let Some(Json::Number(depth)) = compiler.get(b"maxNodeModuleJsDepth") {
            options.max_node_module_js_depth = *depth as u32;
        }
        let one_of = |name: &[u8]| word(name).unwrap_or_default();
        options.target = *SCRIPT_TARGETS
            .get_ascii_case_insensitive(one_of(b"target"))
            .unwrap_or(&ScriptTarget::None);
        // `GetEmitModuleKind`
        options.module = match MODULE_KINDS.get_ascii_case_insensitive(one_of(b"module")) {
            Some(&specified) => specified,
            None => match options.target {
                ScriptTarget::ESNext => ModuleKind::EsNext,
                ScriptTarget::ES5 => ModuleKind::CommonJs,
                ScriptTarget::ES2020 | ScriptTarget::ES2021 => ModuleKind::Es2020,
                // An unspecified target means the latest.
                ScriptTarget::None => ModuleKind::Es2022,
                target if target < ScriptTarget::ES2020 => ModuleKind::Es2015,
                _ => ModuleKind::Es2022,
            },
        };
        // `GetEmitModuleDetectionKind`: if unspecified, the Node module kinds treat every file as a
        // module.
        options.module_detection = match lower(b"moduleDetection").as_deref() {
            Some(b"force") => ModuleDetection::Force,
            Some(b"legacy") => ModuleDetection::Legacy,
            Some(_) => ModuleDetection::Auto,
            None if options.module.is_node() => ModuleDetection::Force,
            None => ModuleDetection::Auto,
        };
        // `GetModuleResolutionKind`: an unspecified value, or a value that is no longer supported,
        // is derived from `module`.
        let resolution = lower(b"moduleresolution").or_else(|| lower(b"moduleResolution"));
        options.resolves_like_node = match resolution.as_deref() {
            Some(b"node16" | b"nodenext") => true,
            Some(b"bundler") => false,
            _ => options.module.is_node(),
        };
        options.resolves_like_node16 = match resolution.as_deref() {
            Some(b"node16") => true,
            Some(b"nodenext" | b"bundler") => false,
            _ => matches!(
                options.module,
                ModuleKind::Node16 | ModuleKind::Node18 | ModuleKind::Node20
            ),
        };
        options.specifies_module_resolution = matches!(
            resolution.as_deref(),
            Some(b"node16" | b"nodenext" | b"bundler")
        );
        // `getNodeResolutionFeatures`
        let like_node = options.resolves_like_node;
        let is_not_off = |name: &[u8]| like_node || specified(name) != Some(false);
        options.resolve_package_json_exports = is_not_off(b"resolvePackageJsonExports");
        options.resolve_package_json_imports = is_not_off(b"resolvePackageJsonImports");
        // `GetResolveJsonModule`
        options.resolve_json_module = specified(b"resolveJsonModule").unwrap_or(
            matches!(options.module, ModuleKind::Node20 | ModuleKind::NodeNext) || !like_node,
        );
        options.jsx_factory = text(b"jsxFactory");
        options.jsx_fragment_factory = text(b"jsxFragmentFactory");
        options.react_namespace = text(b"reactNamespace");
        let has_class_fields =
            options.target == ScriptTarget::None || options.target >= ScriptTarget::ES2022;
        let use_define = specified(b"useDefineForClassFields");
        options.use_define_for_class_fields = use_define.unwrap_or(has_class_fields);
        options.emit_standard_class_fields = use_define != Some(false) && has_class_fields;
        options.isolated_modules_reported = flag(b"isolatedModules");
        options.verbatim_module_syntax = flag(b"verbatimModuleSyntax");
        options.isolated_modules =
            options.isolated_modules_reported || options.verbatim_module_syntax;
        options.preserve_const_enums = flag(b"preserveConstEnums");
        options.rewrite_relative_import_extensions = flag(b"rewriteRelativeImportExtensions");
        options.allow_importing_ts_extensions =
            flag(b"allowImportingTsExtensions") || options.rewrite_relative_import_extensions;
        options.jsx = *JSX_EMITS
            .get_ascii_case_insensitive(one_of(b"jsx"))
            .unwrap_or(&JsxEmit::None);
        options.jsx_import_source = word(b"jsxImportSource").unwrap_or(b"react").to_vec();
        let runtime: &[u8] = match options.jsx {
            JsxEmit::ReactJsxDev => b"/jsx-dev-runtime",
            JsxEmit::ReactJsx => b"/jsx-runtime",
            _ if compiler.get(b"jsxImportSource").is_some() => b"/jsx-runtime",
            _ => b"",
        };
        if !runtime.is_empty() {
            options.jsx_runtime = [&options.jsx_import_source, runtime].concat();
        }
        options.skip_lib_check = flag(b"skipLibCheck");
        options.strips_internal_declarations = flag(b"stripInternal");
        options.skip_default_lib_check = flag(b"skipDefaultLibCheck");
        options.no_check = flag(b"noCheck");
        options.suppress_output_path_check = flag(b"suppressOutputPathCheck");
        options.out_dir = directory(b"outDir");
        options.root_dir = directory(b"rootDir");
        options.declaration_dir = directory(b"declarationDir");
        options.emit_declaration_only = flag(b"emitDeclarationOnly");
        options.writes_source_maps = flag(b"sourceMap") && !flag(b"inlineSourceMap");
        options.writes_declaration_maps = flag(b"declarationMap") && options.emits_declarations;
        options.specifies_source_or_map_root =
            !text(b"sourceRoot").is_empty() || !text(b"mapRoot").is_empty();
        options.verify(compiler, b"");
        options
    }

    /// Validates the options, which were built from `compiler`, in the configuration file at
    /// `config_path`, if there is one.
    pub fn verify(&mut self, compiler: &Json, config_path: &[u8]) {
        self.has_config_file = !config_path.is_empty();
        self.config_path = config_path.to_vec();
        self.problems = crate::verify::verify_compiler_options(compiler, self, config_path);
        self.errors = self.problems.iter().map(|problem| problem.code).collect();
        self.errors.sort_unstable();
        self.errors.dedup();
    }
}

/// `GetLibFileName`: the `N` of the `lib.N.d.ts` that a name in `lib` or in `/// <reference lib>`
/// refers to.
pub fn lib_name(name: &[u8]) -> Vec<u8> {
    match name.to_ascii_lowercase().as_slice() {
        b"es6" => b"es2015".to_vec(),
        b"es7" => b"es2016".to_vec(),
        other => other.to_vec(),
    }
}

bun_core::comptime_string_map! {
    /// `LibMap`, "Fallback for backward compatibility": the library that the declarations of a library moved to.
    pub static LIB_FALLBACKS: &'static [u8] = {
        b"esnext.asynciterable" => b"es2018.asynciterable",
        b"esnext.symbol" => b"es2019.symbol",
        b"esnext.bigint" => b"es2020.bigint",
        b"esnext.weakref" => b"es2021.weakref",
        b"esnext.object" => b"es2024.object",
        b"esnext.regexp" => b"es2024.regexp",
        b"esnext.string" => b"es2024.string",
        b"esnext.float16" => b"es2025.float16",
        b"esnext.iterator" => b"es2025.iterator",
        b"esnext.promise" => b"es2025.promise",
    };
}

bun_core::comptime_string_set! {
    /// `tsoptions.Libs`: the keys of `LibMap`.
    pub static LIBS = {
        b"es5", b"es6", b"es2015", b"es7", b"es2016", b"es2017", b"es2018", b"es2019", b"es2020", b"es2021", b"es2022",
        b"es2023", b"es2024", b"es2025", b"esnext", b"dom", b"dom.iterable", b"dom.asynciterable", b"webworker",
        b"webworker.importscripts", b"webworker.iterable", b"webworker.asynciterable", b"scripthost", b"es2015.core",
        b"es2015.collection", b"es2015.generator", b"es2015.iterable", b"es2015.promise", b"es2015.proxy", b"es2015.reflect",
        b"es2015.symbol", b"es2015.symbol.wellknown", b"es2016.array.include", b"es2016.intl", b"es2017.arraybuffer",
        b"es2017.date", b"es2017.object", b"es2017.sharedmemory", b"es2017.string", b"es2017.intl", b"es2017.typedarrays",
        b"es2018.asyncgenerator", b"es2018.asynciterable", b"es2018.intl", b"es2018.promise", b"es2018.regexp", b"es2019.array",
        b"es2019.object", b"es2019.string", b"es2019.symbol", b"es2019.intl", b"es2020.bigint", b"es2020.date",
        b"es2020.promise", b"es2020.sharedmemory", b"es2020.string", b"es2020.symbol.wellknown", b"es2020.intl",
        b"es2020.number", b"es2021.promise", b"es2021.string", b"es2021.weakref", b"es2021.intl", b"es2022.array",
        b"es2022.error", b"es2022.intl", b"es2022.object", b"es2022.string", b"es2022.regexp", b"es2023.array",
        b"es2023.collection", b"es2023.intl", b"es2024.arraybuffer", b"es2024.collection", b"es2024.object", b"es2024.promise",
        b"es2024.regexp", b"es2024.sharedmemory", b"es2024.string", b"es2025.collection", b"es2025.float16", b"es2025.intl",
        b"es2025.iterator", b"es2025.promise", b"es2025.regexp", b"esnext.asynciterable", b"esnext.symbol", b"esnext.bigint",
        b"esnext.weakref", b"esnext.object", b"esnext.regexp", b"esnext.string", b"esnext.float16", b"esnext.iterator",
        b"esnext.promise", b"esnext.array", b"esnext.collection", b"esnext.date", b"esnext.decorators", b"esnext.disposable",
        b"esnext.error", b"esnext.intl", b"esnext.sharedmemory", b"esnext.temporal", b"esnext.typedarrays", b"decorators",
        b"decorators.legacy",
    };
}

/// `IsExternalModuleNameRelative`: `spec` is a file path. It is not searched for in `node_modules`,
/// and no `declare module` matches it.
pub fn is_relative(spec: &[u8]) -> bool {
    path_is_relative(spec) || is_rooted_disk_path(spec)
}

/// `IsRootedDiskPath`
pub(crate) fn is_rooted_disk_path(path: &[u8]) -> bool {
    match path {
        // A POSIX, UNC or untitled (`^/`) root
        [b'/' | b'\\', ..] | [b'^', b'/', ..] => true,
        // A DOS volume: `c:`, `c:/` or `c:\`, but not `c:d`
        [volume, b':'] | [volume, b':', b'/' | b'\\', ..] => volume.is_ascii_alphabetic(),
        _ => false,
    }
}

/// `PathIsRelative`
pub(crate) fn path_is_relative(path: &[u8]) -> bool {
    matches!(
        path,
        [b'.'] | [b'.', b'.'] | [b'.', b'/' | b'\\', ..] | [b'.', b'.', b'/' | b'\\', ..]
    )
}

/// `ToFileNameLowerCase`
pub fn to_file_name_lower_case(file_name: &[u8]) -> Vec<u8> {
    if file_name.is_ascii() {
        return file_name.to_ascii_lowercase();
    }
    let mut out = Vec::with_capacity(file_name.len());
    for c in file_name.chars() {
        let lower = c.to_lowercase().filter(|_| c != '\u{130}');
        for c in lower.chain((c == '\u{130}').then_some(c)) {
            out.extend_from_slice(c.encode_utf8(&mut [0; 4]).as_bytes());
        }
    }
    out
}

/// `ensurePathIsNonModuleName`
pub(crate) fn ensure_path_is_non_module_name(path: Vec<u8>) -> Vec<u8> {
    if path.starts_with(b"/") || path_is_relative(&path) {
        path
    } else {
        [&b"./"[..], &path[..]].concat()
    }
}

/// `ForEachAncestorDirectory`: `dir`, then each of its ancestor directories up to the root.
pub fn ancestors(dir: &[u8]) -> impl Iterator<Item = &[u8]> {
    std::iter::successors(Some(dir), |&dir| {
        (dir != b"/" && !dir.is_empty()).then(|| dirname::<Posix>(dir))
    })
}

/// The path of `name` in `dir`. Only the root directory ends in `/`.
pub fn inside(dir: &[u8], name: &[u8]) -> Vec<u8> {
    [if dir == b"/" { b"" } else { dir }, b"/", name].concat()
}

/// `GetNormalizedAbsolutePath`. `dir` is already normalized and absolute and is copied as is: one
/// pass over `rest`, one allocation.
/// (`bun_paths::join_abs_string_buf` copies the whole path three times before it reaches a `Vec`.)
pub fn join(dir: &[u8], rest: &[u8]) -> Vec<u8> {
    // `GetEncodedRootLength`: on Windows `C:\a` is an absolute path too. It is represented as
    // `/C:/a` here.
    let has_drive = cfg!(windows)
        && matches!(rest, [drive, b':'] | [drive, b':', b'/' | b'\\', ..] if drive.is_ascii_alphabetic());
    let is_rooted = has_drive || matches!(rest.first(), Some(b'/' | b'\\'));
    let dir = if is_rooted || dir == b"/" { b"" } else { dir };
    let mut out = Vec::with_capacity(dir.len() + rest.len() + 1);
    out.extend_from_slice(dir);
    for part in strings::split_any(rest, b"/\\") {
        match part {
            b"" | b"." => {}
            b".." => out.truncate(strings::last_index_of_char(&out, b'/').unwrap_or(0)),
            _ => {
                out.push(b'/');
                out.extend_from_slice(part);
            }
        }
    }
    if out.is_empty() {
        out.push(b'/');
    }
    out
}

struct Package<'h> {
    json: Json,
    /// `readPackageJsonPeerDependencies`
    peer_dependencies: std::sync::OnceLock<&'h [u8]>,
}

/// `InferredTypesContainingFile`: the name of the file that the entries of `compilerOptions.types`
/// are resolved from, in the directory of the project.
pub const INFERRED_TYPES_CONTAINING_FILE: &[u8] = b"__inferred type names__.ts";

/// `DiagAndArgs`
pub struct DiagAndArgs {
    pub code: u32,
    pub args: Vec<Vec<u8>>,
}

/// `tracer`: what `traceResolution` logs during one resolution.
#[derive(Default)]
pub struct Tracer {
    traces: RefCell<Vec<DiagAndArgs>>,
}

impl Tracer {
    pub fn write(&self, code: u32, args: &[&[u8]]) {
        let args = args.iter().map(|arg| arg.to_vec()).collect();
        self.traces.borrow_mut().push(DiagAndArgs { code, args });
    }

    /// `getTraces`
    pub fn into_traces(self) -> Vec<DiagAndArgs> {
        self.traces.into_inner()
    }
}

/// `resolutionState`: the parameters of a lookup.
#[derive(Copy, Clone)]
struct Look<'a> {
    tracer: Option<&'a Tracer>,
    /// `esmMode`: Node's rules for `import`. No extension is added, and a directory does not
    /// resolve.
    esm: bool,
    /// The condition `import` matches. Otherwise `require` matches.
    import: bool,
    /// `extensionsTypeScript`: `.ts`, `.tsx`, `.mts` and `.cts` files that are not declaration files.
    typescript: bool,
    /// `extensionsDeclaration`: `.d.ts`, `.d.mts`, `.d.cts` and `.d.*.ts` files.
    declarations: bool,
    /// `extensionsJavaScript`
    js: bool,
    /// `extensionsJson`
    json: bool,
    /// `isConfigLookup`
    is_config_lookup: bool,
    /// Number of `imports` targets naming a module that have been followed so far. They can form a
    /// cycle.
    depth: u8,
    /// `candidateEndingIsFromConfig`: the extension of the candidate comes from `paths`, `typesVersions` or a `package.json` field, not
    /// from the specifier.
    ending_from_config: bool,
    /// `resolved.resolvedUsingTsExtension`. Starts as false and is set where a file is found. The search returns the first file it
    /// finds, so the cell is set at most once.
    using_ts_extension: &'a Cell<bool>,
    /// `resolved.extension` is `.d.css.ts`, `.d.json.ts` or similar, for which
    /// `GetResolutionDiagnostic` requires `allowArbitraryExtensions`.
    /// Set like `using_ts_extension`.
    arbitrary_extension: &'a Cell<bool>,
    /// `resolvedPackageDirectory`: the `package.json` of a package with the requested name has been
    /// found.
    found_package: &'a Cell<bool>,
    /// `IsExternalLibraryImport`
    is_external: &'a Cell<bool>,
    /// `resolved.packageId` stays empty: `nodeLoadModuleByRelativeName` sets it for a file, and
    /// `loadNodeModuleFromDirectory` does not.
    lacks_package_id: &'a Cell<bool>,
    /// `PackageDirectory` of the `packageInfo` that `getPackageId` is called with, before symlinks
    /// are resolved. Empty until a file is found.
    package_directory: &'a RefCell<Vec<u8>>,
    /// `resolved.path` before symlinks are resolved, which `getPackageId` is called with. Only kept
    /// for the log.
    found_at: &'a RefCell<Vec<u8>>,
    /// Not `NodeResolutionFeaturesExports`: the `exports` of a package in `node_modules` are
    /// ignored.
    ignores_exports: bool,
}

impl Look<'_> {
    /// `tracer.write`
    #[inline]
    fn trace(self, code: u32, args: &[&[u8]]) {
        if let Some(tracer) = self.tracer {
            tracer.write(code, args);
        }
    }

    /// `extensions.String`
    fn extensions(self) -> Vec<u8> {
        let kinds: [(bool, &[u8]); 4] = [
            (self.typescript, b"TypeScript"),
            (self.js, b"JavaScript"),
            (self.declarations, b"Declaration"),
            (self.json, b"JSON"),
        ];
        let names: Vec<&[u8]> = (kinds.iter().filter(|kind| kind.0).map(|kind| kind.1)).collect();
        names.join(&b", "[..])
    }

    /// `resolutionState.mangleScopedPackageName`
    fn mangle_scoped_package_name(self, name: &[u8]) -> Vec<u8> {
        let mangled = mangle_scoped(name);
        if mangled != name {
            self.trace(6182, &[&mangled]);
        }
        mangled
    }

    /// `priorityExtensions`
    fn for_types(self) -> Self {
        Look {
            js: false,
            json: false,
            ..self
        }
    }

    /// `secondaryExtensions`
    fn for_the_rest(self) -> Self {
        Look {
            typescript: false,
            declarations: false,
            ..self
        }
    }

    /// `extensionsDeclaration` alone.
    fn for_declarations(self) -> Self {
        Look {
            typescript: false,
            declarations: true,
            js: false,
            json: false,
            ..self
        }
    }
}

/// The result of searching one location.
enum Found {
    File(Vec<u8>),
    /// `unresolved()`: explicitly resolved to nothing, which ends the search.
    Blocked,
    /// `continueSearching()`
    No,
}

impl Found {
    fn of(file: Option<Vec<u8>>) -> Found {
        file.map_or(Found::No, Found::File)
    }

    fn file(self) -> Option<Vec<u8>> {
        match self {
            Found::File(file) => Some(file),
            Found::Blocked | Found::No => None,
        }
    }
}

/// `module.ResolvedModule`. The paths live as long as the resolver.
#[derive(Copy, Clone, Debug)]
pub struct ResolvedModule<'h> {
    /// `ResolvedFileName`. For a declaration file of a referenced project, the source it is emitted from.
    pub file_name: &'h [u8],
    pub using_ts_extension: bool,
    /// `Extension` is one that requires `allowArbitraryExtensions` (`GetResolutionDiagnostic`).
    pub has_arbitrary_extension: bool,
    /// It was found in a `node_modules`, judged by the path before symlinks are resolved.
    pub is_external_library_import: bool,
    /// The file with the types of a package whose `exports` only resolve to JavaScript, found by
    /// ignoring the `exports`.
    pub alternate_result: Option<&'h [u8]>,
    /// `file_name` replaces a declaration file, and `Extension` is that of the declaration file.
    pub is_project_reference_redirect: bool,
    /// `PackageId.Name`, unless it is empty.
    pub package_name: Option<&'h [u8]>,
}

pub struct Resolver<'h> {
    /// Owns every path in the caches. It is not the session of the check: the caches are of no use
    /// once the program is loaded, and the caller frees them then.
    session: &'h Session,
    host: &'h dyn Host,
    options: &'h Options,
    packages: ShardedMap<&'h [u8], Option<Package<'h>>>,
    dirs: ShardedMap<&'h [u8], bool>,
    files: ShardedMap<&'h [u8], bool>,
    /// Cache of the results of `resolve_module_name`. The key is the directory, `//`, the mode as a
    /// digit, and the specifier. No directory contains `//`.
    resolved: ShardedMap<&'h [u8], Option<ResolvedModule<'h>>>,
    /// `resolutionState.diagnostics` of all lookups: whether it concerns `imports`, the entry, and
    /// the `package.json`.
    ambiguous_roots: bun_threading::Guarded<Vec<(bool, &'h [u8], &'h [u8]), &'h Session>>,
    /// `OriginalPath` and `ResolvedFileName` of each file found through a symlink. Only recorded
    /// when declaration files are emitted.
    links: bun_threading::Guarded<Vec<(&'h [u8], &'h [u8]), &'h Session>>,
    /// `knownSymlinks.Directories`: the symlink target of a package directory in `node_modules`.
    /// `None`: it is not a symlink.
    linked_packages: ShardedMap<&'h [u8], Option<&'h [u8]>>,
    /// `GetCompilerOptionsWithRedirect`: one for each of `options.referenced_options`.
    redirected: Vec<Resolver<'h>>,
    /// `redirectedReference != nil`: it is one of the `redirected` of another resolver.
    is_redirect: bool,
}

/// `guessDirectorySymlink`: the real path of the symlinked directory and the path of the symlink,
/// inferred from a file at `real` that was found at `link`.
fn guess_directory_link(real: &[u8], link: &[u8]) -> Option<(Vec<u8>, Vec<u8>)> {
    let mut a: Vec<&[u8]> = strings::split(real, b"/").collect();
    let mut b: Vec<&[u8]> = strings::split(link, b"/").collect();
    // `isNodeModulesOrScopedPackageDirectory`: the symlink is an entry of such a directory, not the
    // directory itself.
    let holds_packages = |name: &[u8]| name == b"node_modules" || name.starts_with(b"@");
    let mut is_directory = false;
    while a.len() >= 2
        && b.len() >= 2
        && !holds_packages(a[a.len() - 2])
        && !holds_packages(b[b.len() - 2])
        && a[a.len() - 1] == b[b.len() - 1]
    {
        a.pop();
        b.pop();
        is_directory = true;
    }
    is_directory.then(|| (a.join(&b"/"[..]), b.join(&b"/"[..])))
}

/// `GetOutputDeclarationFileNameWorker` for a file that a declaration file is emitted for.
/// `output`: `declarationDir` or `outDir`, and `CommonSourceDirectory`, both without a trailing
/// `/`. `None`: next to the source.
pub fn output_declaration_file_name(
    source: &[u8],
    output: Option<(&[u8], &[u8])>,
) -> Option<Vec<u8>> {
    if is_declaration_file_name(source) {
        return None;
    }
    // `GetDeclarationEmitExtensionForPath`
    let extension: &[u8] = match known_extension(source) {
        b".ts" | b".tsx" | b".js" | b".jsx" => b".d.ts",
        b".mts" | b".mjs" => b".d.mts",
        b".cts" | b".cjs" => b".d.cts",
        _ => return None,
    };
    let stem = remove_file_extension(source);
    match output {
        None => Some([stem, extension].concat()),
        Some((output_dir, root_dir)) => {
            let relative = stem
                .strip_prefix(root_dir)
                .filter(|it| it.starts_with(b"/"))?;
            Some([output_dir, relative, extension].concat())
        }
    }
}

/// `SupportedDeclarationExtensions`, `SupportedTSImplementationExtensions`, `SupportedJSExtensionsFlat`
const SUPPORTED_DECLARATION_EXTENSIONS: [&[u8]; 3] = [b".d.ts", b".d.cts", b".d.mts"];
const SUPPORTED_TS_IMPLEMENTATION_EXTENSIONS: [&[u8]; 4] = [b".ts", b".tsx", b".mts", b".cts"];
const SUPPORTED_JS_EXTENSIONS_FLAT: [&[u8]; 4] = [b".js", b".jsx", b".mjs", b".cjs"];

/// `GetSupportedExtensions`: `SupportedTSExtensions` or `AllSupportedExtensions`. In each group the
/// first extension has priority.
pub(crate) fn supported_extensions(options: &Options) -> &'static [&'static [&'static [u8]]] {
    if options.allow_js {
        &[
            &[b".ts", b".tsx", b".d.ts", b".js", b".jsx"],
            &[b".cts", b".d.cts", b".cjs"],
            &[b".mts", b".d.mts", b".mjs"],
        ]
    } else {
        &[
            &[b".ts", b".tsx", b".d.ts"],
            &[b".cts", b".d.cts"],
            &[b".mts", b".d.mts"],
        ]
    }
}

/// `FileExtensionIsOneOf`
pub(crate) fn file_extension_is_one_of(path: &[u8], extensions: &[&[u8]]) -> bool {
    extensions.iter().any(|e| path.ends_with(e))
}

/// Whether the file name has a TypeScript extension, including the declaration file extensions.
pub(crate) fn has_ts_implementation_extension(path: &[u8]) -> bool {
    file_extension_is_one_of(path, &SUPPORTED_TS_IMPLEMENTATION_EXTENSIONS)
}

/// `TryExtractTSExtension`
pub(crate) fn try_extract_ts_extension(path: &[u8]) -> Option<&'static [u8]> {
    (SUPPORTED_DECLARATION_EXTENSIONS.into_iter())
        .chain(SUPPORTED_TS_IMPLEMENTATION_EXTENSIONS)
        .find(|&e| path.ends_with(e))
}

/// `GetImpliedNodeFormatForFile`, as far as the extension alone determines it.
pub(crate) fn format_by_extension(path: &[u8]) -> ResolutionMode {
    if file_extension_is_one_of(path, &[b".mts", b".mjs"]) {
        ResolutionMode::Import
    } else if file_extension_is_one_of(path, &[b".cts", b".cjs"]) {
        ResolutionMode::Require
    } else {
        ResolutionMode::None
    }
}

/// `extensionsToRemove`: the recognized extensions, in the order they are matched against the end
/// of a name.
const KNOWN_EXTENSIONS: [&[u8]; 12] = [
    b".d.ts", b".d.mts", b".d.cts", b".mjs", b".mts", b".cjs", b".cts", b".ts", b".js", b".tsx",
    b".jsx", b".json",
];

/// `TryGetExtensionFromPath`: the extension of `path`, if it is a recognized one. Empty otherwise.
pub(crate) fn known_extension(path: &[u8]) -> &'static [u8] {
    KNOWN_EXTENSIONS
        .into_iter()
        .find(|e| path.len() > e.len() && path.ends_with(*e))
        .unwrap_or(b"")
}

/// `RemoveFileExtension`
pub(crate) fn remove_file_extension(path: &[u8]) -> &[u8] {
    &path[..path.len() - known_extension(path).len()]
}

/// `IsDeclarationFileName`: the name ends in `.d.ts`, `.d.mts`, `.d.cts` or `.d.*.ts`.
pub fn is_declaration_file_name(path: &[u8]) -> bool {
    let base = &path[strings::last_index_of_char(path, b'/').map_or(0, |i| i + 1)..];
    file_extension_is_one_of(base, &SUPPORTED_DECLARATION_EXTENSIONS)
        || base.ends_with(b".ts") && strings::contains(base, b".d.")
}

/// `GetNodeModulePathParts`: the start of the first `/node_modules` in `path`, the index of the `/`
/// after it, and the end of the innermost package directory. `None`: `path` is not in a package in
/// a `node_modules`.
pub fn node_module_path_parts(path: &[u8]) -> Option<(usize, usize, usize)> {
    #[derive(Copy, Clone)]
    enum State {
        BeforeNodeModules,
        NodeModules,
        Scope,
        PackageContent,
    }
    let (mut top_level_node_modules, mut top_level_package_name, mut package_root) = (0, 0, 0);
    let mut state = State::BeforeNodeModules;
    let mut part_end = Some(0);
    while let Some(part_start) = part_end {
        part_end = path
            .get(part_start + 1..)
            .and_then(|rest| strings::index_of_char_usize(rest, b'/'))
            .map(|at| part_start + 1 + at);
        let is_node_modules = path[part_start..].starts_with(b"/node_modules/");
        state = match state {
            State::BeforeNodeModules if is_node_modules => {
                top_level_node_modules = part_start;
                top_level_package_name = part_end.unwrap_or(path.len());
                State::NodeModules
            }
            State::BeforeNodeModules => State::BeforeNodeModules,
            State::NodeModules if path.get(part_start + 1) == Some(&b'@') => State::Scope,
            State::NodeModules | State::Scope => {
                package_root = part_end.unwrap_or(path.len());
                State::PackageContent
            }
            State::PackageContent if is_node_modules => State::NodeModules,
            State::PackageContent => State::PackageContent,
        };
    }
    matches!(state, State::Scope | State::PackageContent).then_some((
        top_level_node_modules,
        top_level_package_name,
        package_root,
    ))
}

/// Whether the file at `path` is JavaScript, based on its name.
pub fn is_javascript(path: &[u8]) -> bool {
    file_extension_is_one_of(path, &SUPPORTED_JS_EXTENSIONS_FLAT)
}

impl<'h> Resolver<'h> {
    pub fn new(session: &'h Session, host: &'h dyn Host, options: &'h Options) -> Self {
        let redirected = options.referenced_options.iter().map(|options| Resolver {
            is_redirect: true,
            ..Resolver::new(session, host, options)
        });
        Resolver {
            session,
            host,
            options,
            packages: ShardedMap::default(),
            dirs: ShardedMap::default(),
            files: ShardedMap::default(),
            resolved: ShardedMap::default(),
            ambiguous_roots: bun_threading::Guarded::new(Vec::new_in(session)),
            links: bun_threading::Guarded::new(Vec::new_in(session)),
            linked_packages: ShardedMap::default(),
            // Not in an arena: a resolver that keeps nothing creates none.
            redirected: redirected.collect(),
            is_redirect: false,
        }
    }

    /// A copy of `bytes` that lives as long as the resolver, in the arena of the calling thread.
    /// For what is stored after a lookup has missed, which costs system calls.
    pub fn keep(&self, bytes: &[u8]) -> &'h [u8] {
        if bytes.is_empty() {
            return &[];
        }
        let session: &'h Session = self.session;
        session.arena().alloc_slice_copy(bytes)
    }

    pub fn options(&self) -> &'h Options {
        self.options
    }

    /// `getRedirectForResolution`: the resolver that resolves the specifiers in the file at `path`,
    /// which has the options of the project the file belongs to, and the file they are resolved
    /// from: a declaration file that is read in place of a source resolves its specifiers as the
    /// source does.
    pub fn redirect_for_resolution<'a>(&'a self, path: &'a [u8]) -> (&'a Resolver<'h>, &'a [u8]) {
        let sources = &self.options.referenced_sources;
        let outputs = &self.options.referenced_output_dts;
        let index = match sources.binary_search_by(|it| it.0.as_slice().cmp(path)) {
            Ok(index) => index,
            Err(_) => match outputs.binary_search_by(|it| it.0.as_slice().cmp(path)) {
                Ok(index) => outputs[index].1 as usize,
                Err(_) => return (self, path),
            },
        };
        let (source, _, project) = &sources[index];
        (&self.redirected[*project as usize], source)
    }

    /// `realPath`
    fn real_path(&self, path: &[u8], look: Look) -> Vec<u8> {
        let real = self.host.realpath(path);
        look.trace(6130, &[path, &real]);
        real
    }

    /// `getOriginalAndResolvedFileName`: the real path of `found`.
    fn followed(&self, found: Vec<u8>, look: Look) -> Vec<u8> {
        let real = self.real_path(&found, look);
        if real != found {
            self.links
                .lock()
                .push((self.keep(&found), self.keep(&real)));
        }
        real
    }

    /// `GetSymlinkCache`, `DirectoriesByRealpath`: each directory known to be a symlink target,
    /// with a symlink to it, in order. They are collected from the resolutions, and from the
    /// dependencies of the packages of the files at `emitted`.
    pub fn linked_directories<'a>(
        &self,
        emitted: impl Iterator<Item = &'a [u8]>,
    ) -> Vec<(Vec<u8>, Vec<u8>)> {
        let mut found: Vec<(Vec<u8>, Vec<u8>)> = Vec::new();
        // `processResolution`, `SetDirectory`
        let mut note = |real: &[u8], link: &[u8]| {
            if let Some(pair) = guess_directory_link(real, link)
                && ![b"/node_modules/.".as_slice(), b"/.git", b".#"]
                    .iter()
                    .any(|ignored| strings::contains(&pair.1, ignored))
                && !found.iter().any(|known| known.1 == pair.1)
            {
                found.push(pair);
            }
        };
        // The imports of a file of a referenced project are resolved by the resolver of that project.
        let mut links: Vec<(&[u8], &[u8])> = self.links.lock().to_vec();
        for redirected in &self.redirected {
            links.extend(redirected.links.lock().iter().copied());
        }
        links.sort();
        links.dedup();
        for (link, real) in &links {
            note(real, link);
        }
        let mut seen: Vec<&[u8]> = Vec::new();
        for path in emitted {
            let Some((directory, package)) = self.package_scope(dirname::<Posix>(path)) else {
                continue;
            };
            if seen.contains(&directory) {
                continue;
            }
            seen.push(directory);
            // `GetRuntimeDependencyNames`
            for field in [
                b"dependencies".as_slice(),
                b"peerDependencies",
                b"optionalDependencies",
            ] {
                let Some(Json::Object(entries)) = package.json.get(field) else {
                    continue;
                };
                for (name, _) in entries {
                    // `ResolvePackageDirectory`
                    let packages = [
                        [b"node_modules/", &name[..]].concat(),
                        [b"node_modules/@types/", &mangle_scoped(name)[..]].concat(),
                    ];
                    let link = ancestors(directory)
                        .flat_map(|around| packages.iter().map(move |it| inside(around, it)))
                        .find(|candidate| self.is_dir(candidate));
                    if let Some(link) = link {
                        let real = self.host.realpath(&link);
                        if real != link {
                            note(
                                &inside(&real, b"package.json"),
                                &inside(&link, b"package.json"),
                            );
                        }
                    }
                }
            }
        }
        found.sort();
        found
    }

    fn is_dir(&self, path: &[u8]) -> bool {
        if let Some(&known) = self.dirs.get_ref(path) {
            return known;
        }
        // `projectReferenceDtsFakingVfs.DirectoryExists`
        let result = self.host.is_dir(path)
            || (!self.options.referenced_outputs.is_empty()
                && (self.directory_exists_if_project_reference_decl_dir(path)
                    || self.path_through_linked_package(path).is_some_and(|real| {
                        self.directory_exists_if_project_reference_decl_dir(&real)
                    })));
        self.dirs.insert(self.keep(path), result)
    }

    fn is_file(&self, path: &[u8]) -> bool {
        if let Some(&known) = self.files.get_ref(path) {
            return known;
        }
        // Most misses are in directories that do not exist.
        let result = self.is_dir(dirname::<Posix>(path)) && self.host.is_file(path);
        self.files.insert(self.keep(path), result)
    }

    fn package(&self, dir: &[u8]) -> Option<&Package<'h>> {
        if let Some(known) = self.packages.get_ref(dir) {
            return known.as_ref();
        }
        let path = inside(dir, b"package.json");
        // `getPackageJsonInfo`: a file that cannot be read or parsed is a package without fields.
        let package = self.is_file(&path).then(|| {
            let text = self.host.read(&path);
            let json =
                text.and_then(|text| (self.host).parse_package_json(self.session.arena(), &text));
            Package {
                json: json.unwrap_or(Json::Null),
                peer_dependencies: Default::default(),
            }
        });
        self.packages.insert_ref(self.keep(dir), package).as_ref()
    }

    /// `getPackageJsonInfo`: `package`, logged. A directory that does not exist is passed over in
    /// silence. It is logged as found in `packageJsonInfoCache`: which lookup is the first one is
    /// known when the log is put in order.
    fn get_package_json_info(&self, dir: &[u8], look: Look) -> Option<&Package<'h>> {
        let package = self.package(dir);
        if look.tracer.is_some() {
            let path = inside(dir, b"package.json");
            if package.is_some() {
                look.trace(6239, &[&path]);
            } else if self.is_dir(dir) {
                look.trace(6240, &[&path]);
            }
        }
        package
    }

    /// The `package.json` in `dir`, if one exists.
    pub fn package_json(&self, dir: &[u8]) -> Option<Json> {
        self.package(dir).map(|package| package.json.clone())
    }

    /// `Resolver.GetPackageScopeForPath`: the nearest `package.json` in `dir` or an ancestor
    /// directory, and its directory.
    fn package_scope<'d>(&self, dir: &'d [u8]) -> Option<(&'d [u8], &Package<'h>)> {
        ancestors(dir).find_map(|dir| Some((dir, self.package(dir)?)))
    }

    /// `resolutionState.getPackageScopeForPath`: `package_scope`, logged.
    fn get_package_scope_for_path<'d>(
        &self,
        dir: &'d [u8],
        look: Look,
    ) -> Option<(&'d [u8], &Package<'h>)> {
        ancestors(dir).find_map(|dir| Some((dir, self.get_package_json_info(dir, look)?)))
    }

    /// `ResolveModuleName`
    pub fn resolve_module_name(
        &self,
        spec: &[u8],
        from: &[u8],
        mode: ResolutionMode,
    ) -> Option<ResolvedModule<'h>> {
        self.resolve_module_name_traced(spec, from, mode, None)
    }

    /// The same. With a tracer every step is taken again, whatever is known already.
    pub fn resolve_module_name_traced(
        &self,
        spec: &[u8],
        from: &[u8],
        mode: ResolutionMode,
        tracer: Option<&Tracer>,
    ) -> Option<ResolvedModule<'h>> {
        let key = resolution_key(spec, from, mode);
        if tracer.is_none()
            && let Some(&known) = self.resolved.get_ref(key.as_slice())
        {
            return known;
        }
        let (using_ts_extension, arbitrary_extension) = (Cell::new(false), Cell::new(false));
        let (found_package, is_external) = (Cell::new(false), Cell::new(false));
        let lacks_package_id = Cell::new(false);
        let (package_directory, found_at) = (RefCell::new(Vec::new()), RefCell::new(Vec::new()));
        let look = self.look(
            mode,
            true,
            &using_ts_extension,
            &arbitrary_extension,
            &found_package,
            &is_external,
            &lacks_package_id,
            &package_directory,
            &found_at,
        );
        let look = Look { tracer, ..look };
        look.trace(6086, &[spec, from]);
        self.trace_resolution_using_project_reference(look);
        let options = self.options;
        let kind: &[u8] = match (options.resolves_like_node, options.resolves_like_node16) {
            (false, _) => b"Bundler",
            (true, true) => b"Node16",
            (true, false) => b"NodeNext",
        };
        let is_specified = options.specifies_module_resolution;
        look.trace(if is_specified { 6087 } else { 6088 }, &[kind]);
        let found = self.resolve_node_like(spec, from, look);
        let found = found.map(|(path, alternate_result)| {
            let package_name = match lacks_package_id.get() {
                true => None,
                false => self.package_name(&package_directory.borrow()),
            };
            if tracer.is_some() {
                match self.package_id_text(look) {
                    Some(id) => look.trace(6218, &[spec, &path, &id]),
                    None => look.trace(6089, &[spec, &path]),
                }
            }
            // `getSourceOfProjectReferenceRedirect`. Also applies when the output exists: a build
            // would first bring it up to date with the source.
            let source = self.source_of_project_reference_redirect(&path);
            ResolvedModule {
                is_project_reference_redirect: source.is_some(),
                file_name: self.keep(&source.unwrap_or(path)),
                using_ts_extension: using_ts_extension.get(),
                has_arbitrary_extension: arbitrary_extension.get(),
                is_external_library_import: is_external.get(),
                alternate_result: alternate_result.map(|types| self.keep(&types)),
                package_name,
            }
        });
        if tracer.is_some() {
            if found.is_none() {
                look.trace(6090, &[spec]);
            }
            return found;
        }
        *self.resolved.insert_ref(self.keep(&key), found)
    }

    /// `traceResolutionUsingProjectReference`
    fn trace_resolution_using_project_reference(&self, look: Look) {
        if self.is_redirect {
            look.trace(6215, &[&self.options.config_path]);
        }
    }

    /// `PackageId.String` of the file that `look` has found. `None`: `PackageId.Name` is empty.
    fn package_id_text(&self, look: Look) -> Option<Vec<u8>> {
        let directory = look.package_directory.borrow().clone();
        if look.lacks_package_id.get() || directory.is_empty() {
            return None;
        }
        let package = self.package(&directory)?;
        let name = package.json.get(b"name")?.as_str()?;
        let version = package.json.get(b"version")?.as_str()?;
        let peers = *package.peer_dependencies.get_or_init(|| {
            let look = Look {
                tracer: None,
                ..look
            };
            self.keep(&self.read_package_json_peer_dependencies(&directory, &package.json, look))
        });
        // `PackageName`
        Some(match look.found_at.borrow().get(directory.len() + 1..) {
            None | Some(b"") => [name, b"@", version, peers].concat(),
            Some(sub_module_name) => [name, b"/", sub_module_name, b"@", version, peers].concat(),
        })
    }

    /// `resolveNodeLike`: `ResolvedFileName` and `AlternateResult`.
    fn resolve_node_like(
        &self,
        spec: &[u8],
        from: &[u8],
        look: Look,
    ) -> Option<(Vec<u8>, Option<Vec<u8>>)> {
        if look.tracer.is_some() {
            // `GetConditions`
            let by_mode: &[u8] = if look.import { b"import" } else { b"require" };
            let mut conditions: Vec<&[u8]> = vec![by_mode, b"types"];
            if self.options.resolves_like_node {
                conditions.push(b"node");
            }
            conditions.extend(self.options.custom_conditions.iter().map(Vec::as_slice));
            let quoted = conditions.iter().map(|it| [b"'", *it, b"'"].concat());
            let quoted: Vec<Vec<u8>> = quoted.collect();
            let mode: &[u8] = if look.esm { b"ESM" } else { b"CJS" };
            look.trace(6402, &[mode, &quoted.join(&b", "[..])]);
        }
        let path = self.resolve_with(spec, from, look)?;
        // Whether types would be found if the `exports` of the package were ignored. The answer is
        // only used for JavaScript. For other files without types the search is only logged.
        let is_untyped = || match look.tracer {
            Some(_) => !has_ts_implementation_extension(&path) || look.arbitrary_extension.get(),
            None => is_javascript(&path),
        };
        if !(look.found_package.get()
            && !look.is_config_lookup
            && self.options.resolve_package_json_exports
            && !look.ignores_exports
            && (look.typescript || look.declarations)
            && !is_relative(spec)
            && look.is_external.get()
            && look.import
            && is_untyped())
        {
            return Some((path, None));
        }
        look.trace(6277, &[]);
        let [using_ts_extension, arbitrary_extension, found_package] =
            [(); 3].map(|()| Cell::new(false));
        let (is_external, lacks_package_id) = (Cell::new(false), Cell::new(false));
        let (package_directory, found_at) = (RefCell::default(), RefCell::default());
        let without_exports = Look {
            ignores_exports: true,
            using_ts_extension: &using_ts_extension,
            arbitrary_extension: &arbitrary_extension,
            found_package: &found_package,
            is_external: &is_external,
            lacks_package_id: &lacks_package_id,
            package_directory: &package_directory,
            found_at: &found_at,
            ..look.for_types()
        };
        let types = self.resolve_with(spec, from, without_exports);
        // `features` has lost `NodeResolutionFeaturesExports` for good: if the name is a target of
        // `imports`, the `resolveNodeLike` of the specifier does not search again.
        look.found_package.set(false);
        Some((path, types.filter(|_| is_external.get())))
    }

    /// `newResolutionState`. `is_module`: the name is a module specifier. Otherwise it is the name in a `/// <reference types>`, which
    /// resolves to declaration files only.
    fn look<'a>(
        &self,
        mode: ResolutionMode,
        is_module: bool,
        using_ts_extension: &'a Cell<bool>,
        arbitrary_extension: &'a Cell<bool>,
        found_package: &'a Cell<bool>,
        is_external: &'a Cell<bool>,
        lacks_package_id: &'a Cell<bool>,
        package_directory: &'a RefCell<Vec<u8>>,
        found_at: &'a RefCell<Vec<u8>>,
    ) -> Look<'a> {
        let like_node = self.options.resolves_like_node;
        Look {
            tracer: None,
            esm: like_node && mode == ResolutionMode::Import,
            // `GetConditions`: under bundler resolution, a mode that is not explicitly `require` is
            // `import`.
            import: mode == ResolutionMode::Import || mode == ResolutionMode::None && !like_node,
            typescript: is_module,
            declarations: true,
            js: is_module,
            json: is_module && self.options.resolve_json_module,
            is_config_lookup: false,
            depth: 0,
            ending_from_config: false,
            using_ts_extension,
            arbitrary_extension,
            found_package,
            is_external,
            lacks_package_id,
            package_directory,
            found_at,
            ignores_exports: false,
        }
    }

    /// `resolveNodeLikeWorker`
    fn resolve_with(&self, spec: &[u8], from: &[u8], look: Look) -> Option<Vec<u8>> {
        let from_dir = dirname::<Posix>(from);
        // `createResolvedModuleHandlingSymlink`: a file that a non-relative name resolves to in a
        // package is replaced by its real path.
        let follows_links = !self.options.preserve_symlinks && !is_relative(spec);
        let real = |found: Vec<u8>| {
            let is_in_package = strings::contains(&found, b"/node_modules/");
            look.is_external.set(is_in_package);
            let is_known = !look.package_directory.borrow().is_empty();
            if !is_known && let Some(directory) = parse_node_module_from_path(&found) {
                look.package_directory.replace(directory.to_vec());
            }
            // `resolved.originalPath != ""`: a target of `imports` names a module, and resolving
            // that has followed a symlink. To follow again changes nothing but the log.
            let mut is_followed = false;
            if look.tracer.is_some() {
                let mut found_at = look.found_at.borrow_mut();
                match found_at.is_empty() {
                    true => found_at.clone_from(&found),
                    false => is_followed = *found_at != found,
                }
            }
            if follows_links && is_in_package && !is_followed {
                self.followed(found, look)
            } else {
                found
            }
        };
        // `tryLoadModuleUsingPathsIfEligible`: `paths` applies to every specifier that does not
        // start with dots, including `/a`.
        let starts_with_dots =
            spec.starts_with(b"./") || spec.starts_with(b"../") || spec == b"." || spec == b"..";
        if !starts_with_dots && let Some(found) = self.through_paths(spec, look) {
            return Some(real(found));
        }
        if is_relative(spec) {
            return self
                .through_root_dirs(spec, from_dir, look)
                .or_else(|| self.relative(spec, from_dir, look))
                .map(real);
        }
        // Tries each location in turn until one produces a result.
        let mut found = Found::No;
        if self.options.resolve_package_json_imports && spec.starts_with(b"#") {
            found = self.package_imports(spec, from_dir, look);
        }
        if let Found::No = found {
            found = self.self_name(spec, from_dir, look);
        }
        if let Found::No = found {
            // A specifier that looks like a URI is not in a package.
            let is_uri = strings::contains_char(spec, b':');
            if look.tracer.is_some() {
                let code = if is_uri { 6164 } else { 6098 };
                look.trace(code, &[spec, &look.extensions()]);
            }
            if is_uri {
                return None;
            }
            found = self.node_modules(spec, from_dir, look);
        }
        // `resolveFromTypeRoot`
        if let Found::No = found
            && look.declarations
            && let Some(roots) = &self.options.type_roots
        {
            found = Found::of(self.in_type_roots(roots, true, spec, look.for_declarations()));
        }
        found.file().map(real)
    }

    /// `loadModuleFromSelfNameReference`: a package can import what it exports, by its own name.
    fn self_name(&self, spec: &[u8], from_dir: &[u8], look: Look) -> Found {
        let Some((dir, package)) = self.get_package_scope_for_path(from_dir, look) else {
            return Found::No;
        };
        let Some(exports) = package.json.get(b"exports").filter(|e| !is_falsy(e)) else {
            return Found::No;
        };
        let Some(name) = package.json.get(b"name").and_then(Json::as_str) else {
            return Found::No;
        };
        // Compared component by component, and a trailing slash is ignored (`GetPathComponents`).
        let Some(rest) = spec.strip_suffix(b"/").unwrap_or(spec).strip_prefix(name) else {
            return Found::No;
        };
        let key = match rest.strip_prefix(b"/") {
            Some(subpath) => [&b"./"[..], subpath].concat(),
            None if rest.is_empty() => b".".to_vec(),
            None => return Found::No,
        };
        // With `allowJs`, a project's exports may be its own JavaScript sources, which then take
        // priority over the declarations emitted from them.
        if self.options.allow_js && !strings::contains(from_dir, b"/node_modules/") {
            return self.exports(dir, exports, &key, look);
        }
        // Otherwise as in `node_modules`: a full pass for types first, then a pass for the other
        // kinds of file.
        match self.exports(dir, exports, &key, look.for_types()) {
            Found::No => self.exports(dir, exports, &key, look.for_the_rest()),
            found => found,
        }
    }

    /// The format that the `package.json` nearest to `path` declares for its `.js` files: `Import`
    /// for `"type": "module"`, `Require` for `"type": "commonjs"`.
    fn package_type(&self, path: &[u8]) -> ResolutionMode {
        match self.package_scope(dirname::<Posix>(path)) {
            Some((_, package)) => match package.json.get(b"type").and_then(Json::as_str) {
                Some(b"module") => ResolutionMode::Import,
                Some(b"commonjs") => ResolutionMode::Require,
                _ => ResolutionMode::None,
            },
            None => ResolutionMode::None,
        }
    }

    /// `loadSourceFileMetaData`, `PackageJsonDirectory`: the directory of the `package.json`
    /// nearest to the file at `path`.
    pub fn package_json_directory<'d>(&self, path: &'d [u8]) -> Option<&'d [u8]> {
        Some(self.package_scope(dirname::<Posix>(path))?.0)
    }

    /// `loadSourceFileMetaData`: the `package.json` nearest to the file at `path`
    /// (`PackageJsonDirectory`), if it exists and yields no `PackageJsonType`.
    pub fn package_json_without_type(&self, path: &[u8]) -> Option<Vec<u8>> {
        let (dir, package) = self.package_scope(dirname::<Posix>(path))?;
        let is_requested = self.options.resolves_like_node
            && format_by_extension(path) == ResolutionMode::None
            || strings::contains(path, b"/node_modules/");
        let says_type = is_requested
            && package
                .json
                .get(b"type")
                .and_then(Json::as_str)
                .is_some_and(|specified| !specified.is_empty());
        (!says_type).then(|| inside(dir, b"package.json"))
    }

    /// Under `module: node16` and later: whether the file at `path` is an ECMAScript module,
    /// determined by its extension, or else by the `package.json` nearest to it.
    pub fn is_ecmascript_module(&self, path: &[u8]) -> bool {
        let format = match format_by_extension(path) {
            ResolutionMode::None => self.package_type(path),
            specified => specified,
        };
        format == ResolutionMode::Import
    }

    /// `GetImpliedNodeFormatForEmitWorker` over `loadSourceFileMetaData`: the emit format of the
    /// file at `path`, if its name or its package determines it. Under `module: node16` and later
    /// they always do, except for JSON.
    pub fn implied_format(&self, path: &[u8]) -> ResolutionMode {
        let specified = format_by_extension(path);
        if specified != ResolutionMode::None
            || !file_extension_is_one_of(path, &[b".ts", b".tsx", b".js", b".jsx"])
        {
            return specified;
        }
        // The package is consulted only when modules are resolved as Node does, and for installed
        // packages.
        let package_type =
            if self.options.resolves_like_node || strings::contains(path, b"/node_modules/") {
                self.package_type(path)
            } else {
                ResolutionMode::None
            };
        if self.options.module.is_node() && package_type != ResolutionMode::Import {
            return ResolutionMode::Require;
        }
        package_type
    }

    /// `getPackageId`: `name@version+peer@version/path/in/package` for a file of a package. Two
    /// copies of the same version of a package with the same peers have the same id.
    pub fn package_id(&self, path: &[u8]) -> Option<Vec<u8>> {
        let directory = parse_node_module_from_path(path)?;
        let subpath = path.get(directory.len() + 1..).unwrap_or_default();
        let package = self.package(directory)?;
        let version = package.json.get(b"version")?.as_str()?;
        let declared = package.json.get(b"name")?.as_str()?;
        let peers = *package.peer_dependencies.get_or_init(|| {
            let (ignored, unused) = (Cell::new(false), RefCell::default());
            let look = self.look(
                ResolutionMode::None,
                false,
                &ignored,
                &ignored,
                &ignored,
                &ignored,
                &ignored,
                &unused,
                &unused,
            );
            self.keep(&self.read_package_json_peer_dependencies(directory, &package.json, look))
        });
        Some([declared, b"@", version, peers, b"/", subpath].concat())
    }

    /// `resolved.packageId = getPackageId(..)` with the `package.json` in `directory`, which has
    /// been looked up. The id is made from `look.package_directory` when it is needed. What
    /// making it logs is logged here.
    fn get_package_id(&self, directory: &[u8], look: Look) {
        look.lacks_package_id.set(false);
        look.package_directory.replace(directory.to_vec());
        if look.tracer.is_some()
            && let Some(package) = self.package(directory)
            && package.json.get(b"name").and_then(Json::as_str).is_some()
            && package
                .json
                .get(b"version")
                .and_then(Json::as_str)
                .is_some()
        {
            self.read_package_json_peer_dependencies(directory, &package.json, look);
        }
    }

    /// `getPackageId(..).Name` for the package in `directory`.
    fn package_name(&self, directory: &[u8]) -> Option<&'h [u8]> {
        if directory.is_empty() {
            return None;
        }
        let package = self.package(directory)?;
        package.json.get(b"version")?.as_str()?;
        Some(self.keep(package.json.get(b"name")?.as_str()?))
    }

    /// `readPackageJsonPeerDependencies`: `+name@version` for each peer of the package in `directory` that is installed next to it.
    fn read_package_json_peer_dependencies(
        &self,
        directory: &[u8],
        json: &Json,
        look: Look,
    ) -> Vec<u8> {
        let peers = validate_package_json_field(
            json,
            b"peerDependencies",
            b"object",
            // A map of strings.
            |field| {
                let peers = field.as_object()?;
                (peers.iter().all(|peer| peer.1.as_str().is_some())).then_some(peers)
            },
            look,
        );
        let Some(peers) = peers.filter(|peers| !peers.is_empty()) else {
            return Vec::new();
        };
        look.trace(6281, &[]);
        let real = self.real_path(directory, look);
        let Some(at) = strings::last_index_of(&real, b"/node_modules") else {
            return Vec::new();
        };
        let node_modules = &real[..at + b"/node_modules".len()];
        let mut names: Vec<&[u8]> = peers.iter().map(|peer| peer.0.as_slice()).collect();
        names.sort_unstable();
        let mut found = Vec::new();
        for name in names {
            let Some(peer) = self.get_package_json_info(&inside(node_modules, name), look) else {
                look.trace(6283, &[name]);
                continue;
            };
            let version = peer.json.get(b"version").and_then(Json::as_str);
            let version = version.unwrap_or_default();
            found.extend_from_slice(&[b"+", name, b"@", version].concat());
            look.trace(6282, &[name, version]);
        }
        found
    }

    /// `ResolveTypeReferenceDirective`: `/// <reference types="name" />` in the file at `from`,
    /// resolved in `mode`. An entry of `compilerOptions.types` is in a file with the name
    /// `INFERRED_TYPES_CONTAINING_FILE`. Returns `ResolvedFileName` and `IsExternalLibraryImport`.
    pub fn resolve_type_reference(
        &self,
        name: &[u8],
        from: &[u8],
        mode: ResolutionMode,
        tracer: Option<&Tracer>,
    ) -> Option<(Vec<u8>, bool)> {
        let from_dir = dirname::<Posix>(from);
        // `ResolvedTypeReferenceDirective` has no `ResolvedUsingTsExtension`.
        let (ignored, lacks_package_id) = (Cell::new(false), Cell::new(false));
        let (directory, found_at) = (RefCell::default(), RefCell::default());
        let look = self.look(
            mode,
            false,
            &ignored,
            &ignored,
            &ignored,
            &ignored,
            &lacks_package_id,
            &directory,
            &found_at,
        );
        let look = Look { tracer, ..look };
        // `GetEffectiveTypeRoots`
        let from_config = self.options.type_roots.is_some();
        let roots = match &self.options.type_roots {
            Some(roots) => Cow::Borrowed(roots.as_slice()),
            None => Cow::Owned(self.options.effective_type_roots()),
        };
        if tracer.is_some() {
            look.trace(6116, &[name, from, &roots.join(&b","[..])]);
            self.trace_resolution_using_project_reference(look);
            match roots.is_empty() {
                true => look.trace(6122, &[]),
                false => look.trace(6121, &[&roots.join(&b", "[..])]),
            }
        }
        // First in the type roots, regardless of the location of the reference.
        let primary = self.in_type_roots(&roots, from_config, name, look);
        let is_primary = primary.is_some();
        let found = primary.or_else(|| {
            // Then like a module, from the location of the reference. An entry of `types` is only
            // looked up in `typeRoots`.
            if from_config && from.ends_with(INFERRED_TYPES_CONTAINING_FILE) {
                look.trace(6265, &[]);
                return None;
            }
            look.trace(6125, &[from_dir]);
            if is_relative(name) {
                self.relative(name, from_dir, look)
            } else {
                self.node_modules(name, from_dir, look).file()
            }
        });
        // `createResolvedTypeReferenceDirective`: `typesVersions` can name any file, but only a
        // TypeScript file is accepted.
        let Some(found) = found.filter(|found| has_ts_implementation_extension(found)) else {
            look.trace(6120, &[name]);
            return None;
        };
        let is_external = strings::contains(&found, b"/node_modules/");
        if tracer.is_some() {
            found_at.replace(found.clone());
        }
        let source = self.source_of_project_reference_redirect(&found);
        // The real path of a file that its source replaces is only logged.
        let found = if self.options.preserve_symlinks || source.is_some() && tracer.is_none() {
            found
        } else {
            self.followed(found, look)
        };
        // `traceTypeReferenceDirectiveResult`
        if tracer.is_some() {
            let primary: &[u8] = if is_primary { b"true" } else { b"false" };
            match self.package_id_text(look) {
                Some(id) => look.trace(6219, &[name, &found, &id, primary]),
                None => look.trace(6119, &[name, &found, primary]),
            }
        }
        Some((source.unwrap_or(found), is_external))
    }

    /// The search of `resolveTypeReferenceDirective` and of `resolveFromTypeRoot` in type roots: a
    /// directory in one of `roots`, or with `from_config` a file.
    fn in_type_roots(
        &self,
        roots: &[Vec<u8>],
        from_config: bool,
        name: &[u8],
        look: Look,
    ) -> Option<Vec<u8>> {
        for root in roots {
            // `getCandidateFromTypeRoot`
            let candidate = if root.ends_with(b"/node_modules/@types") {
                inside(root, &look.mangle_scoped_package_name(name))
            } else {
                inside(root, name)
            };
            if !self.is_dir(root) {
                look.trace(6148, &[root]);
                continue;
            }
            if from_config && let Some(found) = self.file(&candidate, look) {
                // Without a tracer, `resolve_with` finds the same directory.
                if look.tracer.is_some()
                    && let Some(directory) = parse_node_module_from_path(&found)
                {
                    self.get_package_json_info(directory, look);
                    self.get_package_id(directory, look);
                }
                return Some(found);
            }
            // In a directory that does not exist `loadNodeModuleFromDirectory` finds nothing, and
            // logs nothing.
            if self.is_dir(&candidate)
                && let Some(found) = self.package_entry(&candidate, look)
            {
                look.lacks_package_id.set(true);
                return Some(found);
            }
        }
        None
    }

    /// `tryLoadModuleUsingPathsIfEligible`: `tryLoadModuleUsingPaths` with `compilerOptions.paths`.
    fn through_paths(&self, spec: &[u8], look: Look) -> Option<Vec<u8>> {
        if self.options.paths.is_empty() {
            return None;
        }
        look.trace(6091, &[spec]);
        let (pattern, targets, matched) = best_pattern(self.options.paths.as_slice(), spec)?;
        look.trace(6092, &[spec, pattern]);
        targets.iter().find_map(|target| {
            let base = if self.options.paths_base_dir.is_empty() {
                &self.options.base_dir
            } else {
                &self.options.paths_base_dir
            };
            let filled = target.replacen(b"*", matched, 1);
            look.trace(6093, &[target, &filled]);
            let path = join(base, &filled);
            let look = Look {
                ending_from_config: look.ending_from_config || !known_extension(target).is_empty(),
                ..look
            };
            // `tryLoadModuleUsingPaths` returns what `tryFile` finds as it is.
            self.very_file(target, &path, look)
                .inspect(|_| look.lacks_package_id.set(true))
                .or_else(|| match filled.ends_with(b"/") {
                    true => self.directory(&path, look),
                    false => self.file_or_directory(&path, look),
                })
        })
    }

    /// In `tryLoadModuleUsingPaths`: a substitution `written` with an extension may name the file
    /// at `path` exactly. That file is then the result, regardless of the requested kinds of file,
    /// before the extension is interpreted.
    fn very_file(&self, written: &[u8], path: &[u8], look: Look) -> Option<Vec<u8>> {
        let extension = known_extension(written);
        // Without `resolveJsonModule` a JSON file is unusable (`GetResolutionDiagnostic`), so it is
        // treated as not found, and only looked up for the log.
        let is_unusable = extension == b".json" && !self.options.resolve_json_module;
        if extension.is_empty() || is_unusable && look.tracer.is_none() {
            return None;
        }
        self.try_file(path, look).filter(|_| !is_unusable)
    }

    /// `tryLoadModuleUsingRootDirs`: a candidate inside one of `rootDirs` is tried there, and then
    /// at the same relative path in each of the others.
    fn through_root_dirs(&self, spec: &[u8], from_dir: &[u8], look: Look) -> Option<Vec<u8>> {
        let roots = &self.options.root_dirs;
        if roots.is_empty() {
            return None;
        }
        look.trace(6107, &[spec]);
        // `NormalizePath` keeps a slash at the end.
        let mut candidate = join(from_dir, spec);
        if spec.ends_with(b"/") && candidate != b"/" {
            candidate.push(b'/');
        }
        // The longest of them that contains it. Ties go to the first.
        let mut matched: Option<&[u8]> = None;
        for root in roots {
            let is_longest = candidate
                .strip_prefix(root.as_slice())
                .is_some_and(|rest| root == b"/" || rest.starts_with(b"/"))
                && matched.is_none_or(|m| m.len() < root.len());
            if look.tracer.is_some() {
                let answer: &[u8] = if is_longest { b"true" } else { b"false" };
                look.trace(6104, &[&inside(root, b""), &candidate, answer]);
            }
            if is_longest {
                matched = Some(root.as_slice());
            }
        }
        let matched = matched?;
        // `matchedNormalizedPrefix` ends in a slash.
        let prefix = if matched == b"/" {
            1
        } else {
            matched.len() + 1
        };
        let (prefix, suffix) = candidate.split_at(prefix);
        look.trace(6108, &[&candidate, prefix]);
        let load = |path: &[u8]| match path.strip_suffix(b"/") {
            Some(b"") => self.directory(path, look),
            Some(directory) => self.directory(directory, look),
            None => self.file_or_directory(path, look),
        };
        look.trace(6109, &[suffix, prefix, &candidate]);
        if let Some(found) = load(&candidate) {
            return Some(found);
        }
        look.trace(6110, &[]);
        for root in roots.iter().filter(|root| root.as_slice() != matched) {
            let candidate = match suffix {
                b"" => root.clone(),
                _ => inside(root, suffix),
            };
            look.trace(6109, &[suffix, root, &candidate]);
            if let Some(found) = load(&candidate) {
                return Some(found);
            }
        }
        look.trace(6111, &[]);
        None
    }

    /// `tryLoadModuleUsingPaths` with what `get_version_paths` returns for a `package.json`: maps
    /// `name`, a path in `dir`, and loads the result with `load`. The second argument of `load` is
    /// whether the substitution has an extension (`candidateEndingIsFromConfig`).
    fn through_types_versions(
        &self,
        (version, mapping): (&[u8], &Json),
        dir: &[u8],
        name: &[u8],
        load: &dyn Fn(&[u8], bool) -> Option<Vec<u8>>,
        look: Look,
    ) -> Option<Vec<u8>> {
        look.trace(6208, &[version, VERSION, name]);
        let (pattern, targets, matched) = best_pattern(mapping.as_object()?, name)?;
        look.trace(6092, &[name, pattern]);
        targets
            .as_array()?
            .iter()
            .filter_map(Json::as_str)
            .find_map(|target| {
                let filled = target.replacen(b"*", matched, 1);
                look.trace(6093, &[target, &filled]);
                let path = join(dir, &filled);
                self.very_file(target, &path, look)
                    .inspect(|_| look.lacks_package_id.set(true))
                    .or_else(|| load(&path, !known_extension(target).is_empty()))
            })
    }

    /// Resolves the relative specifier `spec` from `from_dir`.
    fn relative(&self, spec: &[u8], from_dir: &[u8], look: Look) -> Option<Vec<u8>> {
        let path = join(from_dir, spec);
        // `normalizePathForCJSResolution`: a specifier that ends in a slash or in dots can only be
        // a directory.
        let is_directory = spec.ends_with(b"/")
            || spec == b"."
            || spec == b".."
            || spec.ends_with(b"/.")
            || spec.ends_with(b"/..");
        if is_directory {
            self.directory(&path, look)
        } else {
            self.file_or_directory(&path, look)
        }
    }

    /// `nodeLoadModuleByRelativeName` with `considerPackageJson`.
    fn file_or_directory(&self, path: &[u8], look: Look) -> Option<Vec<u8>> {
        self.node_load_module_by_relative_name(path, false, true, look)
    }

    /// The same for a candidate that ends in a slash, which `path` lacks.
    fn directory(&self, path: &[u8], look: Look) -> Option<Vec<u8>> {
        self.node_load_module_by_relative_name(path, true, true, look)
    }

    /// `ends_in_slash`: the candidate is `path` with a slash at its end, and can only be a
    /// directory.
    fn node_load_module_by_relative_name(
        &self,
        path: &[u8],
        ends_in_slash: bool,
        consider_package_json: bool,
        look: Look,
    ) -> Option<Vec<u8>> {
        let is_traced = look.tracer.is_some();
        let candidate: Cow<[u8]> = if is_traced && ends_in_slash && path != b"/" {
            Cow::Owned([path, b"/"].concat())
        } else {
            Cow::Borrowed(path)
        };
        if is_traced {
            look.trace(6095, &[&candidate[..], &look.extensions()]);
        }
        if !ends_in_slash {
            // Without a tracer, `is_file` finds nothing in a directory that does not exist.
            if is_traced {
                let parent = dirname::<Posix>(path);
                if !self.is_dir(parent) {
                    look.trace(6148, &[parent]);
                    return None;
                }
            }
            if let Some(found) = self.file(path, look) {
                // Without a tracer, `resolve_with` finds the same directory.
                if is_traced
                    && consider_package_json
                    && let Some(directory) = parse_node_module_from_path(&found)
                {
                    self.get_package_json_info(directory, look);
                    self.get_package_id(directory, look);
                }
                return Some(found);
            }
        }
        // Under Node's rules for `import` a directory does not resolve, whether it exists or not.
        if (is_traced || !look.esm) && !self.is_dir(path) {
            look.trace(6148, &[&candidate[..]]);
            return None;
        }
        if look.esm {
            return None;
        }
        if !consider_package_json {
            return self.directory_entry(path, None, true, look);
        }
        let found = self.package_entry(path, look)?;
        look.lacks_package_id.set(true);
        Some(found)
    }

    /// `tryFile`: `path`, if it is a file. With `moduleSuffixes`, the first existing file among
    /// `path` with each suffix inserted before its extension.
    fn try_file(&self, path: &[u8], look: Look) -> Option<Vec<u8>> {
        // `tryFileLookup`
        let lookup = |path: &[u8]| {
            let exists =
                self.is_file(path) || self.source_of_project_reference_redirect(path).is_some();
            look.trace(if exists { 6097 } else { 6096 }, &[path]);
            exists
        };
        if self.options.module_suffixes.is_empty() {
            return lookup(path).then(|| path.to_vec());
        }
        let extension = known_extension(path);
        let stem = &path[..path.len() - extension.len()];
        self.options
            .module_suffixes
            .iter()
            .map(|suffix| [stem, &suffix[..], extension].concat())
            .find(|c| lookup(c))
    }

    /// `projectReferenceDtsFakingVfs.FileExists`: the source file from which a referenced project would emit the declaration file
    /// `path`. Lets a package whose `exports` point at build output be imported without building it.
    fn source_of_project_reference_redirect(&self, path: &[u8]) -> Option<Vec<u8>> {
        if self.options.referenced_outputs.is_empty()
            || !matches!(known_extension(path), b".d.ts" | b".d.mts" | b".d.cts")
        {
            return None;
        }
        self.file_exists_if_project_reference_dts(path).or_else(|| {
            // `fileOrDirectoryExistsUsingSource`
            let real = self.path_through_linked_package(path)?;
            self.file_exists_if_project_reference_dts(&real)
        })
    }

    /// `fileExistsIfProjectReferenceDts`
    fn file_exists_if_project_reference_dts(&self, path: &[u8]) -> Option<Vec<u8>> {
        for (output_dir, root_dir) in &self.options.referenced_outputs {
            let Some(relative) = path
                .strip_prefix(output_dir.as_slice())
                .and_then(|rest| rest.strip_prefix(b"/"))
            else {
                continue;
            };
            let extension = known_extension(relative);
            let sources: &[&[u8]] = match extension {
                b".d.ts" => &[b".ts", b".tsx"],
                b".d.mts" => &[b".mts"],
                b".d.cts" => &[b".cts"],
                _ => continue,
            };
            let stem = join(root_dir, &relative[..relative.len() - extension.len()]);
            if let Some(source) = sources
                .iter()
                .map(|source| [stem.as_slice(), *source].concat())
                .find(|candidate| self.is_file(candidate))
            {
                return Some(source);
            }
        }
        None
    }

    /// `directoryExistsIfProjectReferenceDeclDir`: the output directory of a referenced project, an
    /// ancestor of it or a directory inside it.
    fn directory_exists_if_project_reference_decl_dir(&self, path: &[u8]) -> bool {
        let is_inside = |inner: &[u8], outer: &[u8]| {
            inner
                .strip_prefix(outer)
                .is_some_and(|rest| rest.is_empty() || rest.starts_with(b"/"))
        };
        self.options
            .referenced_outputs
            .iter()
            .any(|(output_dir, _)| is_inside(output_dir, path) || is_inside(path, output_dir))
    }

    /// `handleDirectoryCouldBeSymlink` of `ParseNodeModuleFromPath`: `path` with its package
    /// directory replaced by that directory's symlink target. `None` if it is not in a package, or
    /// the package directory is not a symlink.
    fn path_through_linked_package(&self, path: &[u8]) -> Option<Vec<u8>> {
        const NODE_MODULES: &[u8] = b"/node_modules/";
        let name = strings::last_index_of(path, NODE_MODULES)? + NODE_MODULES.len();
        let next_separator = |from: usize| {
            strings::index_of_char_usize(&path[from..], b'/').map_or(path.len(), |at| from + at)
        };
        let mut end = next_separator(name);
        if path[name..].starts_with(b"@") && end < path.len() {
            end = next_separator(end + 1);
        }
        let package_root = &path[..end];
        let known = self.linked_packages.get_ref(package_root);
        let real = known.unwrap_or_else(|| {
            let real = Some(self.host.realpath(package_root)).filter(|real| real != package_root);
            let real = real.map(|real| self.keep(&real));
            self.linked_packages
                .insert_ref(self.keep(package_root), real)
        });
        Some([(*real)?, &path[end..]].concat())
    }

    /// The first existing file among `stem` with each of `extensions` appended.
    fn first_file(&self, stem: &[u8], extensions: &[&[u8]], look: Look) -> Option<Vec<u8>> {
        extensions
            .iter()
            .find_map(|e| self.try_file(&[stem, *e].concat(), look))
    }

    /// `loadModuleFromFile`: the file that `path` maps to through its own extension, or else `path`
    /// with an extension added.
    fn file(&self, path: &[u8], look: Look) -> Option<Vec<u8>> {
        if let Some(found) = self.load_module_from_file_no_implicit_extensions(path, look) {
            return Some(found);
        }
        // Under Node's rules for `import` no extension is added.
        if look.esm {
            return None;
        }
        self.with_extensions(path, b"", look)
    }

    /// `loadModuleFromFileNoImplicitExtensions`: the extension in the specifier is removed, and the
    /// extensions it maps to are tried in its place.
    fn load_module_from_file_no_implicit_extensions(
        &self,
        path: &[u8],
        look: Look,
    ) -> Option<Vec<u8>> {
        let name = &path[strings::last_index_of_char(path, b'/').map_or(0, |i| i + 1)..];
        let dot = strings::last_index_of_char(name, b'.')?;
        // `RemoveFileExtension`: `.d.ts` is removed as a whole.
        let extension = SUPPORTED_DECLARATION_EXTENSIONS
            .into_iter()
            .find(|e| name.ends_with(*e))
            .unwrap_or_else(|| &name[dot..]);
        look.trace(6132, &[path, extension]);
        self.with_extensions(&path[..path.len() - extension.len()], extension, look)
    }

    /// `tryAddingExtensions`: `stem` with each of the extensions that `written` maps to, in a fixed
    /// order: TypeScript, declaration, JavaScript or JSON, each kind only if `look` allows it. The
    /// original extension is not tried first.
    fn with_extensions(&self, stem: &[u8], written: &[u8], look: Look) -> Option<Vec<u8>> {
        // No file is looked up in a directory that does not exist. Without a tracer, `is_file` sees
        // to that.
        if look.tracer.is_some() && !self.is_dir(dirname::<Posix>(stem)) {
            return None;
        }
        let (typescript, declaration, javascript): (&[&[u8]], &[u8], &[&[u8]]) = match written {
            b".ts" | b".d.ts" | b".js" | b"" => (&[b".ts", b".tsx"], b".d.ts", &[b".js", b".jsx"]),
            b".tsx" | b".jsx" => (&[b".tsx", b".ts"], b".d.ts", &[b".jsx", b".js"]),
            b".mts" | b".d.mts" | b".mjs" => (&[b".mts"], b".d.mts", &[b".mjs"]),
            b".cts" | b".d.cts" | b".cjs" => (&[b".cts"], b".d.cts", &[b".cjs"]),
            b".json" => (&[], b".d.json.ts", &[]),
            // `./a.css` is declared by `a.d.css.ts`.
            _ => {
                return if look.declarations {
                    let found = self.try_file(&[stem, b".d", written, b".ts"].concat(), look)?;
                    look.arbitrary_extension.set(true);
                    Some(found)
                } else {
                    None
                };
            }
        };
        let typed = if look.typescript {
            self.first_file(stem, typescript, look)
        } else {
            None
        };
        let typed = typed.or_else(|| {
            if look.declarations {
                self.try_file(&[stem, declaration].concat(), look)
            } else {
                None
            }
        });
        if let Some(found) = typed {
            // `tryExtension`
            let is_ts_extension = matches!(
                written,
                b".ts" | b".d.ts" | b".tsx" | b".mts" | b".d.mts" | b".cts" | b".d.cts"
            );
            look.using_ts_extension
                .set(!look.ending_from_config && is_ts_extension);
            // `.d.json.ts`
            look.arbitrary_extension.set(written == b".json");
            return Some(found);
        }
        if look.js
            && let Some(found) = self.first_file(stem, javascript, look)
        {
            return Some(found);
        }
        let is_json = match written {
            b".json" => look.json,
            b".ts" | b".d.ts" | b".js" | b"" => look.is_config_lookup,
            _ => false,
        };
        is_json.then(|| self.try_file(&[stem, b".json"].concat(), look))?
    }

    /// `loadFileNameFromPackageJSONField`: the file at `path`, which a `package.json` names. A
    /// TypeScript or declaration file name resolves to exactly that file or to nothing, if `look`
    /// allows its kind. The extension of any other name is replaced as it is in a specifier, and
    /// none is added. `package_json_value` is the raw value in the `package.json`, before a `*` in
    /// it is substituted.
    fn named_file(&self, path: &[u8], package_json_value: &[u8], look: Look) -> Option<Vec<u8>> {
        let is_declaration = is_declaration_file_name(path);
        let is_implementation = !is_declaration && has_ts_implementation_extension(path);
        if look.typescript && is_implementation || look.declarations && is_declaration {
            let found = self.try_file(path, look)?;
            // A trailing `*` matches a part of the specifier that includes the extension.
            look.using_ts_extension
                .set(package_json_value.ends_with(b"*"));
            return Some(found);
        }
        self.load_module_from_file_no_implicit_extensions(path, look)
    }

    /// `loadNodeModuleFromDirectory`: the file the directory `dir` resolves to, using its own
    /// `package.json`.
    fn package_entry(&self, dir: &[u8], look: Look) -> Option<Vec<u8>> {
        let package = self.get_package_json_info(dir, look);
        self.directory_entry(dir, package, true, look)
    }

    /// `loadNodeModuleFromDirectoryWorker`: the file the directory `dir` resolves to: the file its
    /// `package.json` names, or its `index`.
    /// `package` is the `package.json` of `dir` if `is_package_dir`. Otherwise it is that of the
    /// package enclosing `dir`, and only its `typesVersions` apply.
    fn directory_entry(
        &self,
        dir: &[u8],
        package: Option<&Package>,
        is_package_dir: bool,
        look: Look,
    ) -> Option<Vec<u8>> {
        let index: &[u8] = if look.is_config_lookup {
            b"tsconfig"
        } else {
            b"index"
        };
        if let Some(package) = package {
            let version_paths = get_version_paths(&package.json, look);
            // `getPackageFile`: only the first of these fields that has a value.
            let fields: &[&[u8]] = match (is_package_dir, look.declarations) {
                (false, _) => &[],
                (true, _) if look.is_config_lookup => &[b"tsconfig"],
                (true, true) => &[b"typings", b"types", b"main"],
                (true, false) => &[b"main"],
            };
            let entry = (fields.iter())
                .find_map(|field| get_package_json_path_field(&package.json, field, dir, look));
            let package_file = entry.as_deref().unwrap_or(b"");
            let inner = Look {
                // An entry named by a package that is not `"type": "module"` may omit its
                // extension, for any importer.
                esm: look.esm
                    && package.json.get(b"type").and_then(Json::as_str) == Some(b"module"),
                // `expandedExtensions`: `types` may name a `.ts` file even when only declaration
                // files are requested.
                typescript: look.typescript || look.declarations && !look.js,
                ending_from_config: true,
                ..look
            };
            let load = |path: &[u8], has_extension_from_config: bool| -> Option<Vec<u8>> {
                let as_named = Look {
                    ending_from_config: look.ending_from_config || has_extension_from_config,
                    ..look
                };
                // `HasTrailingDirectorySeparator`: it has no extension, and is not looked up as a file.
                if let Some(directory) = path.strip_suffix(b"/").filter(|it| !it.is_empty()) {
                    return self.node_load_module_by_relative_name(directory, true, false, inner);
                }
                self.named_file(path, package_file, as_named)
                    .or_else(|| self.node_load_module_by_relative_name(path, false, false, inner))
            };
            // `typesVersions` also apply to the entry, if it is inside the package, and to `index`
            // if there is no entry.
            let in_package = match &entry {
                Some(entry) => entry
                    .strip_prefix(dir)
                    .and_then(|rest| rest.strip_prefix(b"/"))
                    .map(|rest| rest.strip_suffix(b"/").unwrap_or(rest)),
                None => Some(index),
            };
            if let Some(paths) = version_paths
                && let Some(name) = in_package
                && let Some(found) = self.through_types_versions(paths, dir, name, &load, look)
            {
                return Some(found);
            }
            if let Some(entry) = &entry
                && let Some(found) = load(entry, false)
            {
                return Some(found);
            }
        }
        if look.esm {
            None
        } else {
            self.file(&inside(dir, index), look)
        }
    }

    /// `loadModuleFromNearestNodeModulesDirectory`: types in a farther directory take priority over
    /// JavaScript in a nearer one. A specifier that the search for types finds explicitly
    /// unresolved is not searched for again.
    fn node_modules(&self, spec: &[u8], from_dir: &[u8], look: Look) -> Found {
        if look.typescript || look.declarations {
            if look.tracer.is_some() {
                look.trace(6417, &[&look.for_types().extensions()]);
            }
            match self.node_modules_once(spec, from_dir, look.for_types()) {
                Found::No => {}
                found => return found,
            }
        }
        if look.js || look.json {
            if look.tracer.is_some() {
                look.trace(6418, &[&look.for_the_rest().extensions()]);
            }
            self.node_modules_once(spec, from_dir, look.for_the_rest())
        } else {
            Found::No
        }
    }

    /// `loadModuleFromNearestNodeModulesDirectoryWorker`: in each `node_modules` from `from_dir` up
    /// through its ancestors, the package and then, for types, its `@types`.
    fn node_modules_once(&self, spec: &[u8], from_dir: &[u8], look: Look) -> Found {
        for dir in ancestors(from_dir).filter(|dir| !dir.ends_with(b"/node_modules")) {
            let modules = inside(dir, b"node_modules");
            if !self.is_dir(&modules) {
                look.trace(6148, &[&modules]);
                continue;
            }
            match self.in_modules(&modules, spec, look) {
                Found::No => {}
                found => return found,
            }
            if !look.declarations {
                continue;
            }
            let types = [modules.as_slice(), b"/@types"].concat();
            if !self.is_dir(&types) {
                look.trace(6148, &[&types]);
                continue;
            }
            let mangled = look.mangle_scoped_package_name(spec);
            match self.in_modules(&types, &mangled, look.for_declarations()) {
                Found::No => {}
                found => return found,
            }
        }
        Found::No
    }

    /// `loadModuleFromSpecificNodeModulesDirectory`: `spec` in `modules`, which is a `node_modules` or the `@types` in one.
    fn in_modules(&self, modules: &[u8], spec: &[u8], look: Look) -> Found {
        let spec = spec.strip_suffix(b"/").unwrap_or(spec);
        let (name, rest) = split_package_name(spec);
        // `NormalizePath`
        let candidate = join(modules, spec);
        let package_dir = [modules, b"/", name].concat();
        let package = self.package(&package_dir);
        let respects_exports = self.options.resolve_package_json_exports && !look.ignores_exports;
        let exports = package
            .and_then(|p| p.json.get(b"exports"))
            .filter(|_| respects_exports);
        // The log has the calls of `getPackageJsonInfo` in their order: first for `candidate`, even
        // if the `exports` of the package make the answer irrelevant, then for the package.
        let is_traced = look.tracer.is_some();
        let mut is_package_logged = !is_traced;
        if !rest.is_empty()
            && (exports.is_none() || is_traced)
            && let Some(nested) = self.get_package_json_info(&candidate, look)
        {
            if is_traced && respects_exports {
                is_package_logged = self.get_package_json_info(&package_dir, look).is_some();
            }
            // A directory inside a package that has its own `package.json` uses that one, unless
            // the package declares `exports`.
            if exports.is_none() {
                if let Some(found) = self.file(&candidate, look) {
                    look.lacks_package_id.set(true);
                    return Found::File(found);
                }
                if let Some(found) = self.directory_entry(&candidate, Some(nested), true, look) {
                    self.get_package_id(&candidate, look);
                    return Found::File(found);
                }
            }
        }
        if !is_package_logged {
            self.get_package_json_info(&package_dir, look);
        }
        if package.is_some() {
            look.found_package.set(true);
        }
        // The `exports` of a package are exhaustive: no file lookup, no directory lookup, no
        // `typesVersions`. `"exports": null` counts as absent.
        if let Some(exports) = exports
            && !is_falsy(exports)
        {
            let key = if rest.is_empty() {
                b".".to_vec()
            } else {
                [&b"./"[..], rest].concat()
            };
            return self.exports(&package_dir, exports, &key, look);
        }
        let load = |candidate: &[u8], has_extension_from_config: bool| -> Option<Vec<u8>> {
            let look = Look {
                ending_from_config: look.ending_from_config || has_extension_from_config,
                ..look
            };
            let from_file = if !rest.is_empty() || !look.esm {
                self.file(candidate, look)
            } else {
                None
            };
            // The `package.json` of the package also applies to the directories inside the package.
            let is_package_dir = candidate == package_dir;
            let found = from_file
                .or_else(|| self.directory_entry(candidate, package, is_package_dir, look))
                .or_else(|| {
                    // Under Node's rules for `import`, a package with no entry and no `exports`
                    // still resolves to `index.js`.
                    let is_silent = rest.is_empty()
                        && package.is_some_and(|p| {
                            matches!(p.json.get(b"exports"), None | Some(Json::Null))
                        });
                    if look.esm && is_silent {
                        self.file(&[candidate, b"/index.js"].concat(), look)
                    } else {
                        None
                    }
                })?;
            self.get_package_id(&package_dir, look);
            Some(found)
        };
        if !rest.is_empty()
            && let Some(package) = package
            && let Some(paths) = get_version_paths(&package.json, look)
            && let Some(found) = self.through_types_versions(paths, &package_dir, rest, &load, look)
        {
            return Found::File(found);
        }
        Found::of(load(&candidate, false))
    }

    /// `loadModuleFromExports`: resolves `key`, which is `.` or `./sub/path`, through the `exports`
    /// of the package in `package_dir`.
    fn exports(&self, package_dir: &[u8], exports: &Json, key: &[u8], look: Look) -> Found {
        // `IsConditions`, `IsSubpaths`: none of the keys starts with a dot, or all of them do.
        fn dotted(entries: &[(Vec<u8>, Json)]) -> usize {
            entries.iter().filter(|e| e.0.starts_with(b".")).count()
        }
        if key == b"." {
            let main = match exports {
                Json::String(_) | Json::Array(_) => Some(exports),
                Json::Object(entries) if dotted(entries) == 0 => Some(exports),
                Json::Object(entries) => entries.iter().find(|e| e.0 == b".").map(|e| &e.1),
                _ => None,
            };
            if let Some(main) = main {
                return self.export_target(package_dir, key, main, b"", false, key, false, look);
            }
        } else if let Json::Object(entries) = exports
            && dotted(entries) == entries.len()
        {
            match self.lookup_table(package_dir, entries, key, false, look) {
                Found::No => {}
                found => return found,
            }
        }
        look.trace(6276, &[key, package_dir]);
        Found::No
    }

    /// `loadModuleFromExportsOrImports`: looks up `name` in `table`, the `exports` or the `imports`
    /// of the `package.json` in `package_dir`.
    fn lookup_table(
        &self,
        package_dir: &[u8],
        table: &[(Vec<u8>, Json)],
        name: &[u8],
        is_imports: bool,
        look: Look,
    ) -> Found {
        if !name.ends_with(b"/")
            && !strings::contains_char(name, b'*')
            && let Some((_, target)) = table.iter().find(|e| e.0 == name)
        {
            return self.export_target(
                package_dir,
                name,
                target,
                b"",
                false,
                name,
                is_imports,
                look,
            );
        }
        // The keys that match many names: those with one `*`, and those that end in a slash.
        let mut keys: Vec<&(Vec<u8>, Json)> = table
            .iter()
            .filter(|e| strings::count_char(&e.0, b'*') == 1 || e.0.ends_with(b"/"))
            .collect();
        keys.sort_by(|a, b| compare_pattern_keys(&a.0, &b.0));
        // The first matching key is used, whatever its target resolves to.
        for (key, target) in keys {
            let (subpath, is_pattern) = if let Some(matched) = match_pattern(key, name) {
                (matched, true)
            } else if let Some(rest) = name.strip_prefix(key.as_slice()) {
                (rest, false)
            } else {
                continue;
            };
            return self.export_target(
                package_dir,
                name,
                target,
                subpath,
                is_pattern,
                key,
                is_imports,
                look,
            );
        }
        Found::No
    }

    /// `loadModuleFromTargetExportOrImport`. `subpath`: the text matched by the `*` of `key` if
    /// `is_pattern`, or else the text after `key`.
    fn export_target(
        &self,
        package_dir: &[u8],
        module_name: &[u8],
        target: &Json,
        subpath: &[u8],
        is_pattern: bool,
        key: &[u8],
        is_imports: bool,
        look: Look,
    ) -> Found {
        let field: &[u8] = if is_imports { b"imports" } else { b"exports" };
        let inner = |target: &Json| {
            self.export_target(
                package_dir,
                module_name,
                target,
                subpath,
                is_pattern,
                key,
                is_imports,
                look,
            )
        };
        match target {
            Json::String(path) => {
                // A subpath can only be appended to a directory.
                if !is_pattern && !subpath.is_empty() && !path.ends_with(b"/") {
                    look.trace(6275, &[package_dir, module_name]);
                    return Found::No;
                }
                let filled = if is_pattern {
                    strings::replace_owned(path, b"*", subpath)
                } else {
                    [&path[..], subpath].concat()
                };
                if !path.starts_with(b"./") {
                    // In `imports` the target may be a module name, which is resolved from the
                    // directory of the `package.json`.
                    if is_imports
                        && !path.starts_with(b"../")
                        && !path.starts_with(b"/")
                        && look.depth < 8
                    {
                        let look = Look {
                            depth: look.depth + 1,
                            ..look
                        };
                        if look.tracer.is_some() {
                            look.trace(6404, &[field, key, &filled]);
                            look.trace(6086, &[&filled, &inside(package_dir, b"")]);
                        }
                        let from = inside(package_dir, b"package.json");
                        let found = self.resolve_node_like(&filled, &from, look);
                        return Found::of(found.map(|found| found.0));
                    }
                    look.trace(6275, &[package_dir, module_name]);
                    return Found::No;
                }
                // The target must stay inside the package and outside the packages nested in it.
                let leads_away = |part: &[u8]| matches!(part, b".." | b"." | b"node_modules");
                if strings::split(path, b"/").skip(1).any(leads_away)
                    || strings::split(subpath, b"/").any(leads_away)
                {
                    look.trace(6275, &[package_dir, module_name]);
                    return Found::No;
                }
                look.trace(6404, &[field, key, &filled]);
                let named = join(package_dir, &filled);
                let input = self.input_file_for(&named, subpath, package_dir, is_imports, look);
                let found = match input {
                    Found::No => Found::of(self.named_file(&named, path, look)),
                    found => found,
                };
                if !matches!(found, Found::No) {
                    self.get_package_id(package_dir, look);
                }
                found
            }
            // The first condition that matches and produces a result.
            Json::Object(conditions) => {
                look.trace(6413, &[]);
                for (condition, target) in conditions {
                    if !self.condition_matches(condition, look) {
                        look.trace(6405, &[condition]);
                        continue;
                    }
                    look.trace(6403, &[field, condition]);
                    match inner(target) {
                        Found::No => look.trace(6415, &[condition]),
                        found => {
                            if let Found::File(_) = found {
                                look.trace(6414, &[condition]);
                            }
                            look.trace(6416, &[]);
                            return found;
                        }
                    }
                }
                look.trace(6416, &[]);
                Found::No
            }
            Json::Array(targets) => {
                for target in targets {
                    match inner(target) {
                        Found::No => {}
                        found => return found,
                    }
                }
                look.trace(6275, &[package_dir, module_name]);
                Found::No
            }
            Json::Null => {
                look.trace(6274, &[package_dir, module_name]);
                Found::Blocked
            }
            _ => {
                look.trace(6275, &[package_dir, module_name]);
                Found::No
            }
        }
    }

    /// `tryLoadInputFileForPath`: `path`, which the `exports` or the `imports` of the
    /// `package.json` in `package_dir` resolve to, may be an output that the project itself emits
    /// to `outDir` or `declarationDir`. It is then mapped to the input file it is emitted from.
    /// `entry`: the text matched by the `*` of the key, or the text after the key.
    fn input_file_for(
        &self,
        path: &[u8],
        entry: &[u8],
        package_dir: &[u8],
        is_imports: bool,
        look: Look,
    ) -> Found {
        let options = self.options;
        let is_case_sensitive = self.host.is_case_sensitive();
        if options.out_dir.is_empty() && options.declaration_dir.is_empty()
            || strings::contains(path, b"/node_modules/")
            || options.has_config_file
                && !contains_path(package_dir, &options.base_dir, is_case_sensitive)
        {
            return Found::No;
        }
        let root_dir = if !options.root_dir.is_empty() {
            options.root_dir.as_slice()
        } else if options.has_config_file {
            options.base_dir.as_slice()
        } else {
            let entry = if entry.is_empty() { b"." } else { entry };
            self.ambiguous_roots.lock().push((
                is_imports,
                self.keep(entry),
                self.keep(&inside(package_dir, b"package.json")),
            ));
            return Found::Blocked;
        };
        // `resolutionState.extensions`: all kinds of file, regardless of the kinds this pass of the
        // search requests.
        let look = Look {
            typescript: true,
            declarations: true,
            js: true,
            json: self.options.resolve_json_module,
            ..look
        };
        // `getOutputDirectoriesForBaseDirectory`
        let mut assigned_to = vec![options.declaration_dir.as_slice()];
        if options.out_dir != options.declaration_dir {
            assigned_to.push(options.out_dir.as_slice());
        }
        for dir in assigned_to {
            if dir.is_empty() || !contains_path(dir, path, is_case_sensitive) {
                continue;
            }
            let input = join(root_dir, path.get(dir.len() + 1..).unwrap_or(b""));
            let written = known_extension(&input);
            // `GetPossibleOriginalInputExtensionForExtension`
            let extensions: &[&[u8]] = match written {
                b".mjs" | b".d.mts" => &[b".mts", b".mjs"],
                b".cjs" | b".d.cts" => &[b".cts", b".cjs"],
                b".js" | b".json" | b".d.ts" => &[b".tsx", b".ts", b".jsx", b".js"],
                _ => continue,
            };
            let stem = &input[..input.len() - written.len()];
            for extension in extensions {
                let candidate = [stem, *extension].concat();
                if self.is_file(&candidate)
                    && let Some(found) = self.named_file(&candidate, b"", look)
                {
                    return Found::File(found);
                }
            }
        }
        Found::No
    }

    /// `ResolutionDiagnostics` of all lookups, deduplicated: 2209 2210.
    pub fn resolution_problems(&self) -> Vec<crate::verify::Problem> {
        let mut roots = self.ambiguous_roots.lock().to_vec();
        roots.sort();
        roots.dedup();
        roots
            .iter()
            .map(|&(is_imports, entry, package_json)| {
                crate::verify::Problem::new(
                    if is_imports { 2210 } else { 2209 },
                    &[entry, package_json],
                    crate::verify::Place::Nowhere,
                )
            })
            .collect()
    }

    /// `conditionMatches` against the conditions `GetConditions` returns. (See `version_in_range`
    /// for `types@<range>`.)
    fn condition_matches(&self, condition: &[u8], look: Look) -> bool {
        let by_mode: &[u8] = if look.import { b"import" } else { b"require" };
        condition == b"default"
            || condition == b"types"
            || condition == by_mode
            || condition == b"node" && self.options.resolves_like_node
            || self
                .options
                .custom_conditions
                .iter()
                .any(|c| c == condition)
            || condition
                .strip_prefix(b"types@")
                .is_some_and(|range| version_in_range(TYPESCRIPT_VERSION, range))
    }

    /// `loadModuleFromImports`: `#name`, through the `imports` of the nearest `package.json`.
    fn package_imports(&self, spec: &[u8], from_dir: &[u8], look: Look) -> Found {
        if spec == b"#" || spec.starts_with(b"#/") && self.options.resolves_like_node16 {
            look.trace(6272, &[spec]);
            return Found::No;
        }
        let Some((dir, package)) = self.get_package_scope_for_path(from_dir, look) else {
            look.trace(6270, &[from_dir]);
            return Found::No;
        };
        let Some(imports) = package.json.get(b"imports").and_then(Json::as_object) else {
            look.trace(6273, &[dir]);
            return Found::No;
        };
        let found = self.lookup_table(dir, imports, spec, true, look);
        if let Found::No = found {
            look.trace(6271, &[spec, dir]);
        }
        found
    }
}

/// `ResolveConfig`. What the lookup caches is left in `session`.
pub fn resolve_config(
    host: &dyn Host,
    session: &Session,
    module_name: &[u8],
    containing_file: &[u8],
) -> Option<Vec<u8>> {
    let options = Options {
        resolves_like_node: true,
        resolve_package_json_exports: true,
        resolve_package_json_imports: true,
        ..Default::default()
    };
    let resolver = Resolver::new(session, host, &options);
    let [a, b, c, d, e] = [(); 5].map(|()| Cell::new(false));
    let (directory, found_at) = (RefCell::default(), RefCell::default());
    let look = Look {
        typescript: false,
        declarations: false,
        js: false,
        json: true,
        is_config_lookup: true,
        ..resolver.look(
            ResolutionMode::Require,
            true,
            &a,
            &b,
            &c,
            &d,
            &e,
            &directory,
            &found_at,
        )
    };
    resolver.resolve_with(module_name, containing_file, look)
}

/// `ContainsPath` for two absolute, normalized paths: `child` equals `parent` or is inside it.
pub(crate) fn contains_path(parent: &[u8], child: &[u8], is_case_sensitive: bool) -> bool {
    if !is_case_sensitive && !(parent.is_ascii() && child.is_ascii()) {
        let (parent, child) = (
            to_file_name_lower_case(parent),
            to_file_name_lower_case(child),
        );
        return contains_path(&parent, &child, true);
    }
    let Some(start) = child.get(..parent.len()) else {
        return false;
    };
    let is_same = if is_case_sensitive {
        start == parent
    } else {
        start.eq_ignore_ascii_case(parent)
    };
    is_same
        && (child.len() == parent.len() || parent.ends_with(b"/") || child[parent.len()] == b'/')
}

/// `IsFalsy` for a value in a `package.json`.
fn is_falsy(json: &Json) -> bool {
    match json {
        Json::Null | Json::Bool(false) => true,
        Json::String(text) => text.is_empty(),
        Json::Number(n) => *n == 0.0,
        _ => false,
    }
}

/// `JSONValueType.String`
fn json_type(json: &Json) -> &'static [u8] {
    match json {
        Json::Null => b"null",
        Json::Bool(_) => b"boolean",
        Json::Number(_) => b"number",
        Json::String(_) => b"string",
        Json::Array(_) => b"array",
        Json::Object(_) => b"object",
    }
}

/// `validatePackageJSONField`: the field `name` of the `package.json` `json`, if `read` accepts it
/// as a value of the type `expected`.
fn validate_package_json_field<'j, T>(
    json: &'j Json,
    name: &[u8],
    expected: &[u8],
    read: impl Fn(&'j Json) -> Option<T>,
    look: Look,
) -> Option<T> {
    let field = json.get(name);
    let valid = field.and_then(read);
    if valid.is_none() {
        if let Some(field) = field {
            look.trace(6105, &[name, expected, json_type(field)]);
        }
        look.trace(6100, &[name]);
    }
    valid
}

/// `getPackageJSONPathField`: the path that the field `name` of the `package.json` in `dir` names.
fn get_package_json_path_field(
    json: &Json,
    name: &[u8],
    dir: &[u8],
    look: Look,
) -> Option<Vec<u8>> {
    let value = validate_package_json_field(json, name, b"string", Json::as_str, look)?;
    if value.is_empty() {
        look.trace(6220, &[name]);
        return None;
    }
    // `NormalizePath` keeps a trailing separator.
    let mut path = join(dir, value);
    if value.ends_with(b"/") && !path.ends_with(b"/") {
        path.push(b'/');
    }
    look.trace(6101, &[name, value, &path]);
    Some(path)
}

/// `GetVersionPaths`: the first entry of `typesVersions` in the `package.json` `json` whose range
/// contains the compiler's version: the range, and the paths, which are an object.
fn get_version_paths<'j>(json: &'j Json, look: Look) -> Option<(&'j [u8], &'j Json)> {
    let Some(field) = json.get(b"typesVersions") else {
        look.trace(6100, &[b"typesVersions"]);
        return None;
    };
    let Some(versions) = field.as_object() else {
        look.trace(6105, &[b"typesVersions", b"object", json_type(field)]);
        return None;
    };
    look.trace(6206, &[b"typesVersions"]);
    for (range, paths) in versions {
        if look.tracer.is_some() && !is_version_range(range) {
            look.trace(6209, &[range]);
            continue;
        }
        if !version_in_range(TYPESCRIPT_VERSION, range) {
            continue;
        }
        if paths.as_object().is_some() {
            return Some((range.as_slice(), paths));
        }
        if look.tracer.is_some() {
            let name = [b"typesVersions['", range.as_slice(), b"']"].concat();
            look.trace(6105, &[&name, b"object", json_type(paths)]);
        }
        return None;
    }
    look.trace(6207, &[VERSION_MAJOR_MINOR]);
    None
}

/// The key of `Resolver::resolved`. Only the directory of `from` is used.
fn resolution_key(spec: &[u8], from: &[u8], mode: ResolutionMode) -> Vec<u8> {
    [
        dirname::<Posix>(from),
        match mode {
            ResolutionMode::None => b"//0",
            ResolutionMode::Import => b"//1",
            ResolutionMode::Require => b"//2",
        },
        spec,
    ]
    .concat()
}

/// `MatchPatternOrExact`: the entry of `table` for `name`: an exact match, or else the matching
/// pattern with the longest prefix, the first of those on a tie. Returns the pattern, the value
/// and the text matched by the `*`.
pub(crate) fn best_pattern<'t, 'n, T>(
    table: &'t [(Vec<u8>, T)],
    name: &'n [u8],
) -> Option<(&'t [u8], &'t T, &'n [u8])> {
    if let Some((pattern, exact)) = table
        .iter()
        .find(|e| e.0 == name && !strings::contains_char(&e.0, b'*'))
    {
        return Some((pattern.as_slice(), exact, b""));
    }
    let mut best: Option<((&'t [u8], &'t T, &'n [u8]), usize)> = None;
    for (pattern, value) in table {
        // `TryParsePattern`: with more than one `*` it is not a pattern.
        let Some(star) = strings::index_of_char_usize(pattern, b'*') else {
            continue;
        };
        if !strings::contains_char(&pattern[star + 1..], b'*')
            && best.is_none_or(|b| star > b.1)
            && let Some(matched) = match_pattern(pattern, name)
        {
            best = Some(((pattern.as_slice(), value, matched), star));
        }
    }
    best.map(|b| b.0)
}

/// `ComparePatternKeys`: the key with the longer part before the `*` sorts first, then a key with a
/// `*`, then the longer key.
fn compare_pattern_keys(a: &[u8], b: &[u8]) -> Ordering {
    let (star_a, star_b) = (
        strings::index_of_char_usize(a, b'*'),
        strings::index_of_char_usize(b, b'*'),
    );
    let (base_a, base_b) = (
        star_a.map_or(a.len(), |i| i + 1),
        star_b.map_or(b.len(), |i| i + 1),
    );
    base_b
        .cmp(&base_a)
        .then(star_a.is_none().cmp(&star_b.is_none()))
        .then(b.len().cmp(&a.len()))
}

fn match_pattern<'a>(pattern: &[u8], text: &'a [u8]) -> Option<&'a [u8]> {
    let star = strings::index_of_char_usize(pattern, b'*')?;
    let (prefix, suffix) = (&pattern[..star], &pattern[star + 1..]);
    if text.len() >= prefix.len() + suffix.len()
        && text.starts_with(prefix)
        && text.ends_with(suffix)
    {
        return Some(&text[prefix.len()..text.len() - suffix.len()]);
    }
    None
}

/// `ParseNodeModuleFromPath`: the directory of the package that the file at `path` is in. A file
/// right in the `node_modules`, or in the directory of a scope, has that directory.
fn parse_node_module_from_path(path: &[u8]) -> Option<&[u8]> {
    let marker = b"/node_modules/";
    let at = strings::last_index_of(path, marker)? + marker.len();
    // `moveToNextDirectorySeparatorIfAvailable`
    let next = |from: usize| {
        let rest = path.get(from + 1..).unwrap_or_default();
        strings::index_of_char_usize(rest, b'/').map_or(from, |slash| from + 1 + slash)
    };
    let mut end = next(at);
    if path.get(at) == Some(&b'@') {
        end = next(end);
    }
    Some(&path[..if end == at { at - 1 } else { end }])
}

/// `@scope/name/sub/path` is (`@scope/name`, `sub/path`).
fn split_package_name(spec: &[u8]) -> (&[u8], &[u8]) {
    let mut slash = strings::index_of_char_usize(spec, b'/');
    if spec.starts_with(b"@")
        && let Some(first) = slash
    {
        slash = strings::index_of_char_usize(&spec[first + 1..], b'/').map(|i| first + 1 + i);
    }
    match slash {
        Some(i) => (&spec[..i], &spec[i + 1..]),
        None => (spec, b""),
    }
}

/// `MangleScopedPackageName`: `@scope/name` has its types in `@types/scope__name`.
pub(crate) fn mangle_scoped(name: &[u8]) -> Vec<u8> {
    match name.strip_prefix(b"@") {
        Some(rest) if strings::contains_char(rest, b'/') => rest.replacen(b"/", b"__", 1),
        _ => name.to_vec(),
    }
}

/// The TypeScript version whose behavior is reproduced, for packages that ship different
/// declarations for different versions.
const TYPESCRIPT_VERSION: [u64; 3] = [7, 0, 2];
/// `core.Version`
const VERSION: &[u8] = b"7.0.2";
/// `core.VersionMajorMinor`
const VERSION_MAJOR_MINOR: &[u8] = b"7.0";

/// `VersionRange.Test`
fn version_in_range([major, minor, patch]: [u64; 3], range: &[u8]) -> bool {
    let version = bun_semver::Version {
        major,
        minor,
        patch,
        ..Default::default()
    };
    bun_semver::query::parse(range, bun_semver::SlicedString::init(range, range))
        .is_ok_and(|group| group.satisfies(version, range, b""))
}

/// Whether `TryParseVersionRange` accepts `text`.
fn is_version_range(text: &[u8]) -> bool {
    /// `partialRegExp`
    fn is_partial(text: &[u8]) -> bool {
        let is_xr = |part: &[u8]| match part {
            b"x" | b"X" | b"*" | b"0" => true,
            [b'1'..=b'9', rest @ ..] => rest.iter().all(u8::is_ascii_digit),
            _ => false,
        };
        let is_parts = |parts: &[u8]| {
            let is_part = |c: &u8| c.is_ascii_alphanumeric() || b"-.".contains(c);
            !parts.is_empty() && parts.iter().all(is_part)
        };
        let mut parts = text.splitn(3, |&c| c == b'.');
        let (major, minor, rest) = (parts.next(), parts.next(), parts.next());
        let rest = rest.unwrap_or(b"*");
        let end = strings::index_of_any(rest, b"-+").unwrap_or(rest.len());
        let (patch, qualifier) = rest.split_at(end);
        let (pre, build) = match strings::split_once_char(qualifier, b'+') {
            Some((pre, build)) => (pre, Some(build)),
            None => (qualifier, None),
        };
        major.is_some_and(is_xr)
            && minor.is_none_or(is_xr)
            && is_xr(patch)
            && (pre.is_empty() || is_parts(&pre[1..]))
            && build.is_none_or(is_parts)
    }
    strings::split(text, b"||").all(|range| {
        let simples: Vec<&[u8]> = strings::tokenize_any(range, b" \t\n\x0C\r").collect();
        // `hyphenRegExp`
        if let [left, b"-", right] = simples[..] {
            return is_partial(left) && is_partial(right);
        }
        // `rangeRegExp`
        simples.iter().all(|simple| {
            let operator = simple.iter().take_while(|c| b"~^<>=".contains(c)).count();
            let (operator, partial) = simple.split_at(operator);
            matches!(
                operator,
                b"" | b"~" | b"^" | b"<" | b">" | b"=" | b"<=" | b">="
            ) && is_partial(partial)
        })
    })
}

bun_core::comptime_string_set! {
    /// `UnprefixedNodeCoreModules`: Node's built-in modules, with or without the `node:` prefix.
    static NODE_CORE_MODULES = {
        b"assert", b"assert/strict", b"async_hooks", b"buffer", b"child_process", b"cluster", b"console", b"constants",
        b"crypto", b"dgram", b"diagnostics_channel", b"dns", b"dns/promises", b"domain", b"events", b"fs", b"fs/promises",
        b"http", b"http2", b"https", b"inspector", b"inspector/promises", b"module", b"net", b"os", b"path", b"path/posix",
        b"path/win32", b"perf_hooks", b"process", b"punycode", b"querystring", b"readline", b"readline/promises", b"repl",
        b"stream", b"stream/consumers", b"stream/promises", b"stream/web", b"string_decoder", b"sys", b"timers",
        b"timers/promises", b"tls", b"trace_events", b"tty", b"url", b"util", b"util/types", b"v8", b"vm", b"wasi",
        b"worker_threads", b"zlib",
    };
}

bun_core::comptime_string_set! {
    /// `ExclusivelyPrefixedNodeCoreModules`
    static PREFIXED_NODE_CORE_MODULES = { b"node:quic", b"node:sea", b"node:sqlite", b"node:test", b"node:test/reporters" };
}

pub fn is_node_core_module(spec: &[u8]) -> bool {
    NODE_CORE_MODULES.contains(spec.strip_prefix(b"node:").unwrap_or(spec))
        || PREFIXED_NODE_CORE_MODULES.contains(spec)
}
