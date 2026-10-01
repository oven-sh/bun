//! From an import specifier to the file that has its types: TypeScript's `moduleResolution: "bundler"`, `"node16"` and `"nodenext"`.

use crate::hir::ResolutionMode;
use crate::json::Json;
use crate::util::FxHashMap;
use std::borrow::Cow;
use std::cell::Cell;
use std::cmp::Ordering;
use std::sync::{Arc, RwLock};

/// The file system, and the parser. The bundler has its own of both.
pub trait Host: Sync {
    /// What the file says. As in `bun_ast::Source`: a host that already holds it, as the bundler does of whatever it has loaded, lends
    /// it, and nothing is read or copied.
    fn read(&self, path: &str) -> Option<Cow<'static, [u8]>>;
    fn is_file(&self, path: &str) -> bool;
    fn is_dir(&self, path: &str) -> bool;
    /// With symbolic links followed.
    fn realpath(&self, path: &str) -> String;
    fn list_dir(&self, path: &str) -> Vec<String>;
    /// `GetAccessibleEntries`: the names of the files and of the directories in `path`, each sorted.
    fn entries(&self, path: &str) -> (Vec<String>, Vec<String>) {
        let (mut directories, mut files): (Vec<String>, Vec<String>) = self
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
    fn parse(
        &self,
        path: &str,
        text: &[u8],
        atoms: &crate::atom::Interner,
        options: &Options,
    ) -> crate::hir::File;
    /// Calls `work` with every number below `count`, on as many threads as it likes.
    fn parallel(&self, count: usize, work: &(dyn Fn(usize) + Sync));
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
    /// Whether each file is CommonJS or an ECMAScript module going by its extension and its `package.json`.
    pub fn is_node(self) -> bool {
        (ModuleKind::Node16..=ModuleKind::NodeNext).contains(&self)
    }
}

/// `core.ScriptTarget`. In order: a later one has all that an earlier one has.
#[derive(Default, Copy, Clone, PartialEq, Eq, PartialOrd, Ord, Debug)]
pub enum ScriptTarget {
    /// `target` is not said.
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

/// `core.ModuleDetectionKind`: what makes a module of a file that is not only declarations.
#[derive(Default, Copy, Clone, PartialEq, Eq, Debug)]
pub enum ModuleDetection {
    /// An `import`, an `export` or `import.meta`; a JSX tag that imports its factory; the format its name or its package gives it.
    #[default]
    Auto,
    /// An `import`, an `export` or `import.meta`.
    Legacy,
    /// Nothing is needed.
    Force,
}

#[derive(Default, Clone, Debug)]
pub struct Options {
    /// Where `tsconfig.json` is. Absolute, no trailing slash.
    pub base_dir: String,
    /// `compilerOptions.paths`: a pattern with at most one `*`, and what to try for it.
    pub paths: Vec<(String, Vec<String>)>,
    /// `PathsBasePath`: where the configuration file that says `paths` is, which is what they are relative to.
    pub paths_base_dir: String,
    /// `skipLibCheck`: declaration files are not checked. `skipDefaultLibCheck`: TypeScript's own are not.
    pub skip_lib_check: bool,
    pub skip_default_lib_check: bool,
    /// A file nothing refers to is only parsed when it is checked, and forgotten afterwards with all that was found out about it. Not an
    /// option of TypeScript's. Whoever wants to ask about such a file afterwards leaves it off.
    pub drops_what_nothing_refers_to: bool,
    /// Where `lib.*.d.ts` are.
    pub lib_dir: String,
    /// The `N` of each `lib.N.d.ts` to start from: what `compilerOptions.lib` names, or what goes with the target.
    pub libs: Vec<String>,
    /// `noLib`: there are none, and `/// <reference lib>` is not looked at.
    pub no_lib: bool,
    /// `libReplacement`: `lib.dom.d.ts` gives way to the package `@typescript/lib-dom`, if there is one.
    pub lib_replacement: bool,
    /// `compilerOptions.types`.
    pub types: Option<Vec<String>>,
    /// `typeRoots`, as absolute paths.
    pub type_roots: Option<Vec<String>>,
    /// `noResolve`: `/// <reference path>` and `/// <reference types>` are not looked at, and an import brings no file in.
    pub no_resolve: bool,
    /// `customConditions`: what holds in the `exports` and `imports` of a `package.json` besides what always does.
    pub custom_conditions: Vec<String>,
    /// `getNodeResolutionFeatures`: the `exports` and the `imports` of a `package.json` count. Only a bundler can do without.
    pub resolve_package_json_exports: bool,
    pub resolve_package_json_imports: bool,
    /// `rootDirs`, as absolute paths: directories that count as one to a specifier that says where a file is.
    pub root_dirs: Vec<String>,
    /// `moduleSuffixes`: what may stand before the extension of a file that is looked for, in the order it is tried.
    pub module_suffixes: Vec<String>,
    /// `preserveSymlinks`: a file of a package is where it is found, not where the links to it lead.
    pub preserve_symlinks: bool,
    pub no_unchecked_indexed_access: bool,
    pub no_property_access_from_index_signature: bool,
    /// Iterators of arrays, maps and the like end with `undefined`, not `any`.
    pub strict_builtin_iterator_return: bool,
    pub exact_optional_property_types: bool,
    /// Which decorators the parser is to expect; `accessor` fields come with the standard ones.
    pub experimental_decorators: bool,
    /// The `strict` family: each is what it says, or else what `strict` says, which is on unless turned off.
    pub strict_null_checks: bool,
    pub no_implicit_any: bool,
    pub strict_function_types: bool,
    pub strict_bind_call_apply: bool,
    pub use_unknown_in_catch_variables: bool,
    pub strict_property_initialization: bool,
    pub no_implicit_this: bool,
    pub allow_unreachable_code: bool,
    /// `allowUnreachableCode: false`, `allowUnusedLabels: false`: said, not just left out.
    pub reports_unreachable_code: bool,
    pub reports_unused_labels: bool,
    pub no_implicit_returns: bool,
    pub no_implicit_override: bool,
    pub no_fallthrough_cases_in_switch: bool,
    pub no_unused_locals: bool,
    pub no_unused_parameters: bool,
    pub resolve_json_module: bool,
    pub no_unchecked_side_effect_imports: bool,
    pub allow_js: bool,
    /// `maxNodeModuleJsDepth`: with `allowJs`, JavaScript is loaded up to this many imports deep into packages.
    pub max_node_module_js_depth: u32,
    /// `checkJs`. Not said at all is a third thing: see `Checker::is_plain_js`.
    pub check_js: Option<bool>,
    /// What is wrong with the configuration itself: the codes.
    pub errors: Vec<u32>,
    /// What `target` says, `None` if it says nothing.
    pub target: ScriptTarget,
    /// What `module` comes to, said or not.
    pub module: ModuleKind,
    /// `moduleResolution` is `node16` or `nodenext`, said or not; otherwise it is `bundler`.
    pub resolves_like_node: bool,
    /// `moduleResolution` comes to `node16`, which does not know `#/` in the `imports` of a `package.json`
    /// (`NodeResolutionFeaturesImportsPatternRoot`); `nodenext` and `bundler` do.
    pub resolves_like_node16: bool,
    /// `GetEmitModuleDetectionKind`: what `moduleDetection` comes to, said or not.
    pub module_detection: ModuleDetection,
    /// What `files` names, as absolute paths.
    pub files: Vec<String>,
    pub jsx_import_source: String,
    /// The module every source file imports without saying so: `react/jsx-runtime`. Empty if there is none.
    pub jsx_runtime: String,
    pub jsx: JsxEmit,
    /// `useDefineForClassFields`, as said or as the target implies.
    pub use_define_for_class_fields: bool,
    /// Fields are left as they are written: the target has them and nothing says to do otherwise.
    pub emit_standard_class_fields: bool,
    /// `GetIsolatedModules`: `isolatedModules`, or `verbatimModuleSyntax`.
    pub isolated_modules: bool,
    /// `isolatedModules` itself.
    pub isolated_modules_said: bool,
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
    /// `emitDecoratorMetadata`
    pub emit_decorator_metadata: bool,
    /// `importHelpers`
    pub import_helpers: bool,
    /// `allowArbitraryExtensions`
    pub allow_arbitrary_extensions: bool,
    /// JavaScript is written next to its source: none of `noEmit`, `emitDeclarationOnly`, `outDir`.
    pub writes_js_beside_source: bool,
    /// Declaration files are written next to their source: `GetEmitDeclarations`, and none of `noEmit`, `declarationDir`, `outDir`.
    pub writes_declarations_beside_source: bool,
    /// `jsxFactory`, `jsxFragmentFactory`, `reactNamespace`, as written. Empty if they are not.
    pub jsx_factory: String,
    pub jsx_fragment_factory: String,
    pub react_namespace: String,
}

impl Options {
    /// Whether `compilerOptions.lib` names the DOM.
    pub fn has_dom_lib(&self) -> bool {
        self.libs.iter().any(|l| l == "dom")
    }

    /// `GetEffectiveTypeRoots`: `typeRoots`, or else the `node_modules/@types` of the project and of all that is around it.
    pub fn effective_type_roots(&self) -> Vec<String> {
        if let Some(roots) = &self.type_roots {
            return roots.clone();
        }
        let mut roots = Vec::new();
        let mut dir = self.base_dir.as_str();
        loop {
            roots.push(join(dir, "node_modules/@types"));
            if dir == "/" || dir.is_empty() {
                return roots;
            }
            dir = parent_dir(dir);
        }
    }

    /// `getEmitSyntaxForUsageLocationWorker` of a plain `import` in a file that is emitted as `implied_format`: what its name and
    /// its package leave open, `module` settles.
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

    /// The same of the argument of `import()`, in a file whose plain `import`s are `default_mode`. `ShouldTransformImportCall`: it
    /// stays what it is unless the file is emitted as something older than ECMAScript modules.
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
    /// The options of the one file at `path`, and the `files` it names. `config::load` also follows `extends` and `include`.
    pub fn from_tsconfig(host: &dyn Host, path: &str) -> Option<Options> {
        let json = Json::parse(&host.read(path)?)?;
        let empty = Json::Object(Vec::new());
        let compiler = json.get("compilerOptions").unwrap_or(&empty);
        let mut options = Options::from_compiler_options(parent_dir(path), compiler);
        if let Some(files) = json.get("files").and_then(Json::as_array) {
            options.files = files
                .iter()
                .filter_map(Json::as_str)
                .map(|f| normalize(&format!("{}/{f}", options.base_dir)))
                .collect();
        }
        Some(options)
    }

    /// What `compiler`, the `compilerOptions` of a configuration file in `base_dir`, comes to.
    pub fn from_compiler_options(base_dir: &str, compiler: &Json) -> Options {
        let mut options = Options {
            base_dir: base_dir.to_owned(),
            ..Default::default()
        };
        options.jsx_import_source = "react".to_owned();
        options.libs = vec!["es2025.full".to_owned()];
        options.paths_base_dir = compiler
            .get("pathsBasePath")
            .and_then(Json::as_str)
            .unwrap_or(base_dir)
            .to_owned();
        // The library that goes with the target, unless `lib` says which.
        if let Some(target) = compiler
            .get("target")
            .and_then(Json::as_str)
            .map(str::to_ascii_lowercase)
        {
            options.libs = vec![match target.as_str() {
                "es6" | "es2015" => "es6".to_owned(),
                _ => format!("{target}.full"),
            }];
        }
        if let Some(paths) = compiler.get("paths").and_then(Json::as_object) {
            for (pattern, targets) in paths {
                let targets = targets
                    .as_array()
                    .unwrap_or(&[])
                    .iter()
                    .filter_map(|t| t.as_str().map(str::to_owned));
                options.paths.push((pattern.clone(), targets.collect()));
            }
        }
        if let Some(libs) = compiler.get("lib").and_then(Json::as_array) {
            options.libs = libs.iter().filter_map(Json::as_str).map(lib_name).collect();
        }
        options.no_lib = compiler.get("noLib").and_then(Json::as_bool) == Some(true);
        if options.no_lib {
            options.libs.clear();
        }
        if let Some(types) = compiler.get("types").and_then(Json::as_array) {
            options.types = Some(
                types
                    .iter()
                    .filter_map(|l| l.as_str().map(str::to_owned))
                    .collect(),
            );
        }
        if let Some(roots) = compiler.get("typeRoots").and_then(Json::as_array) {
            options.type_roots = Some(
                roots
                    .iter()
                    .filter_map(Json::as_str)
                    .map(|root| join(&options.base_dir, root))
                    .collect(),
            );
        }
        if let Some(conditions) = compiler.get("customConditions").and_then(Json::as_array) {
            options.custom_conditions = conditions
                .iter()
                .filter_map(|c| c.as_str().map(str::to_owned))
                .collect();
        }
        if let Some(dirs) = compiler.get("rootDirs").and_then(Json::as_array) {
            options.root_dirs = dirs
                .iter()
                .filter_map(Json::as_str)
                .map(|dir| join(&options.base_dir, dir))
                .collect();
        }
        if let Some(suffixes) = compiler.get("moduleSuffixes").and_then(Json::as_array) {
            options.module_suffixes = suffixes
                .iter()
                .filter_map(|s| s.as_str().map(str::to_owned))
                .collect();
        }
        let flag = |name: &str| compiler.get(name).and_then(Json::as_bool).unwrap_or(false);
        options.no_resolve = flag("noResolve");
        options.preserve_symlinks = flag("preserveSymlinks");
        options.lib_replacement = flag("libReplacement");
        options.no_unchecked_indexed_access = flag("noUncheckedIndexedAccess");
        options.no_property_access_from_index_signature =
            flag("noPropertyAccessFromIndexSignature");
        options.exact_optional_property_types = flag("exactOptionalPropertyTypes");
        options.allow_unreachable_code = flag("allowUnreachableCode");
        options.allow_umd_global_access = flag("allowUmdGlobalAccess");
        options.erasable_syntax_only = flag("erasableSyntaxOnly");
        options.emit_decorator_metadata = flag("emitDecoratorMetadata");
        options.import_helpers = flag("importHelpers");
        options.allow_arbitrary_extensions = flag("allowArbitraryExtensions");
        options.reports_unreachable_code =
            compiler.get("allowUnreachableCode").and_then(Json::as_bool) == Some(false);
        options.reports_unused_labels =
            compiler.get("allowUnusedLabels").and_then(Json::as_bool) == Some(false);
        options.no_implicit_returns = flag("noImplicitReturns");
        options.no_implicit_override = flag("noImplicitOverride");
        options.no_fallthrough_cases_in_switch = flag("noFallthroughCasesInSwitch");
        options.no_unused_locals = flag("noUnusedLocals");
        options.no_unused_parameters = flag("noUnusedParameters");
        options.experimental_decorators = flag("experimentalDecorators");
        // Since TypeScript 6.0 `strict` is on unless it is turned off.
        let strict = compiler
            .get("strict")
            .and_then(Json::as_bool)
            .unwrap_or(true);
        let strict_flag = |name: &str| compiler.get(name).and_then(Json::as_bool).unwrap_or(strict);
        options.strict_builtin_iterator_return = strict_flag("strictBuiltinIteratorReturn");
        options.strict_null_checks = strict_flag("strictNullChecks");
        options.no_implicit_any = strict_flag("noImplicitAny");
        options.strict_function_types = strict_flag("strictFunctionTypes");
        options.strict_bind_call_apply = strict_flag("strictBindCallApply");
        options.use_unknown_in_catch_variables = strict_flag("useUnknownInCatchVariables");
        options.strict_property_initialization = strict_flag("strictPropertyInitialization");
        options.no_implicit_this = strict_flag("noImplicitThis");
        options.no_unchecked_side_effect_imports = compiler
            .get("noUncheckedSideEffectImports")
            .and_then(Json::as_bool)
            .unwrap_or(true);
        options.allow_js = compiler
            .get("allowJs")
            .and_then(Json::as_bool)
            .unwrap_or(flag("checkJs"));
        if let Some(Json::Number(depth)) = compiler.get("maxNodeModuleJsDepth") {
            options.max_node_module_js_depth = *depth as u32;
        }
        options.check_js = compiler.get("checkJs").and_then(Json::as_bool);
        let lower = |name: &str| {
            compiler
                .get(name)
                .and_then(Json::as_str)
                .map(str::to_ascii_lowercase)
        };
        options.target = match lower("target").as_deref() {
            Some("es3" | "es5") => ScriptTarget::ES5,
            Some("es6" | "es2015") => ScriptTarget::ES2015,
            Some("es2016") => ScriptTarget::ES2016,
            Some("es2017") => ScriptTarget::ES2017,
            Some("es2018") => ScriptTarget::ES2018,
            Some("es2019") => ScriptTarget::ES2019,
            Some("es2020") => ScriptTarget::ES2020,
            Some("es2021") => ScriptTarget::ES2021,
            Some("es2022") => ScriptTarget::ES2022,
            Some("es2023") => ScriptTarget::ES2023,
            Some("es2024") => ScriptTarget::ES2024,
            Some("es2025") => ScriptTarget::ES2025,
            Some("esnext") => ScriptTarget::ESNext,
            _ => ScriptTarget::None,
        };
        // `GetEmitModuleKind`
        options.module = match lower("module").as_deref() {
            Some("commonjs") => ModuleKind::CommonJs,
            Some("amd") => ModuleKind::Amd,
            Some("umd") => ModuleKind::Umd,
            Some("system") => ModuleKind::System,
            Some("es6" | "es2015") => ModuleKind::Es2015,
            Some("es2020") => ModuleKind::Es2020,
            Some("es2022") => ModuleKind::Es2022,
            Some("esnext") => ModuleKind::EsNext,
            Some("node16") => ModuleKind::Node16,
            Some("node18") => ModuleKind::Node18,
            Some("node20") => ModuleKind::Node20,
            Some("nodenext") => ModuleKind::NodeNext,
            Some("preserve") => ModuleKind::Preserve,
            _ => match lower("target").as_deref() {
                Some("esnext") => ModuleKind::EsNext,
                Some("es3" | "es5") => ModuleKind::CommonJs,
                Some("es6" | "es2015" | "es2016" | "es2017" | "es2018" | "es2019") => {
                    ModuleKind::Es2015
                }
                Some("es2020" | "es2021") => ModuleKind::Es2020,
                _ => ModuleKind::Es2022,
            },
        };
        // `GetEmitModuleDetectionKind`: unsaid, Node's kinds of module make one of every file.
        options.module_detection = match lower("moduleDetection").as_deref() {
            Some("force") => ModuleDetection::Force,
            Some("legacy") => ModuleDetection::Legacy,
            Some(_) => ModuleDetection::Auto,
            None if options.module.is_node() => ModuleDetection::Force,
            None => ModuleDetection::Auto,
        };
        // `GetModuleResolutionKind`: what is not said, or is said in a way that is no more, goes by `module`.
        let resolution = lower("moduleresolution").or_else(|| lower("moduleResolution"));
        options.resolves_like_node = match resolution.as_deref() {
            Some("node16" | "nodenext") => true,
            Some("bundler") => false,
            _ => options.module.is_node(),
        };
        options.resolves_like_node16 = match resolution.as_deref() {
            Some("node16") => true,
            Some("nodenext" | "bundler") => false,
            _ => matches!(
                options.module,
                ModuleKind::Node16 | ModuleKind::Node18 | ModuleKind::Node20
            ),
        };
        // `getNodeResolutionFeatures`
        let like_node = options.resolves_like_node;
        let is_not_off =
            |name: &str| like_node || compiler.get(name).and_then(Json::as_bool) != Some(false);
        options.resolve_package_json_exports = is_not_off("resolvePackageJsonExports");
        options.resolve_package_json_imports = is_not_off("resolvePackageJsonImports");
        // `GetResolveJsonModule`
        options.resolve_json_module = compiler
            .get("resolveJsonModule")
            .and_then(Json::as_bool)
            .unwrap_or(
                matches!(options.module, ModuleKind::Node20 | ModuleKind::NodeNext)
                    || !options.resolves_like_node,
            );
        let text = |name: &str| {
            compiler
                .get(name)
                .and_then(Json::as_str)
                .unwrap_or("")
                .to_owned()
        };
        options.jsx_factory = text("jsxFactory");
        options.jsx_fragment_factory = text("jsxFragmentFactory");
        options.react_namespace = text("reactNamespace");
        if let Some(source) = compiler.get("jsxImportSource").and_then(Json::as_str) {
            options.jsx_import_source = source.to_owned();
        }
        // Without a target it is the latest.
        let has_class_fields = match compiler
            .get("target")
            .and_then(Json::as_str)
            .map(str::to_ascii_lowercase)
            .as_deref()
        {
            Some(
                "es3" | "es5" | "es6" | "es2015" | "es2016" | "es2017" | "es2018" | "es2019"
                | "es2020" | "es2021",
            ) => false,
            _ => true,
        };
        let use_define = compiler
            .get("useDefineForClassFields")
            .and_then(Json::as_bool);
        options.use_define_for_class_fields = use_define.unwrap_or(has_class_fields);
        options.emit_standard_class_fields = use_define != Some(false) && has_class_fields;
        options.isolated_modules_said = flag("isolatedModules");
        options.verbatim_module_syntax = flag("verbatimModuleSyntax");
        options.isolated_modules = options.isolated_modules_said || options.verbatim_module_syntax;
        options.preserve_const_enums = flag("preserveConstEnums");
        options.rewrite_relative_import_extensions = flag("rewriteRelativeImportExtensions");
        options.allow_importing_ts_extensions =
            flag("allowImportingTsExtensions") || options.rewrite_relative_import_extensions;
        let writes_beside_source = !flag("noEmit") && text("outDir").is_empty();
        options.writes_js_beside_source = writes_beside_source && !flag("emitDeclarationOnly");
        options.writes_declarations_beside_source = writes_beside_source
            && (flag("declaration") || flag("composite"))
            && text("declarationDir").is_empty();
        options.jsx = match compiler
            .get("jsx")
            .and_then(Json::as_str)
            .map(str::to_ascii_lowercase)
            .as_deref()
        {
            Some("preserve") => JsxEmit::Preserve,
            Some("react-native") => JsxEmit::ReactNative,
            Some("react") => JsxEmit::React,
            Some("react-jsx") => JsxEmit::ReactJsx,
            Some("react-jsxdev") => JsxEmit::ReactJsxDev,
            _ => JsxEmit::None,
        };
        match compiler
            .get("jsx")
            .and_then(Json::as_str)
            .map(str::to_ascii_lowercase)
            .as_deref()
        {
            Some("react-jsx") => {
                options.jsx_runtime = format!("{}/jsx-runtime", options.jsx_import_source)
            }
            Some("react-jsxdev") => {
                options.jsx_runtime = format!("{}/jsx-dev-runtime", options.jsx_import_source)
            }
            _ if compiler.get("jsxImportSource").is_some() => {
                options.jsx_runtime = format!("{}/jsx-runtime", options.jsx_import_source)
            }
            _ => {}
        }
        options.skip_lib_check = flag("skipLibCheck");
        options.skip_default_lib_check = flag("skipDefaultLibCheck");
        options.errors = crate::verify::verify_compiler_options(compiler, &options);
        options
    }
}

/// `GetLibFileName`: the `N` of the `lib.N.d.ts` that a name in `lib` or in `/// <reference lib>` means.
pub fn lib_name(name: &str) -> String {
    match name.to_ascii_lowercase().as_str() {
        "es6" => "es2015".to_owned(),
        "es7" => "es2016".to_owned(),
        other => other.to_owned(),
    }
}

/// `IsExternalModuleNameRelative`: `spec` says where a file is. It is not looked for in `node_modules`, and no `declare module` goes by it.
pub fn is_relative(spec: &str) -> bool {
    spec.starts_with("./")
        || spec.starts_with("../")
        || spec == "."
        || spec == ".."
        || spec.starts_with('/')
}

pub fn parent_dir(path: &str) -> &str {
    match path.rfind('/') {
        Some(0) => "/",
        Some(i) => &path[..i],
        None => "",
    }
}

/// `a/b/../c/./d` is `a/c/d`.
pub fn normalize(path: &str) -> String {
    let mut parts: Vec<&str> = Vec::new();
    for part in path.split('/') {
        match part {
            "" | "." => {}
            ".." => {
                parts.pop();
            }
            _ => parts.push(part),
        }
    }
    let mut out = String::with_capacity(path.len());
    for part in parts {
        out.push('/');
        out.push_str(part);
    }
    if out.is_empty() {
        out.push('/');
    }
    out
}

pub fn join(dir: &str, rest: &str) -> String {
    if rest.starts_with('/') {
        return normalize(rest);
    }
    normalize(&format!("{dir}/{rest}"))
}

struct Package {
    json: Json,
}

/// `resolutionState`: how something is looked for.
#[derive(Copy, Clone)]
struct Look<'a> {
    /// `esmMode`: Node's rules for `import`. No extension is added, and a directory is nothing.
    esm: bool,
    /// The condition `import` holds; otherwise `require` does.
    import: bool,
    /// `extensionsTypeScript`: `.ts`, `.tsx`, `.mts` and `.cts` files that are not declaration files.
    typescript: bool,
    /// `extensionsDeclaration`: `.d.ts`, `.d.mts`, `.d.cts` and `.d.*.ts` files.
    declarations: bool,
    /// `extensionsJavaScript`, and `extensionsJson` with `resolveJsonModule`.
    js: bool,
    /// How many targets of `imports` that name a module have been followed to get here. They can go in a circle.
    depth: u8,
    /// `candidateEndingIsFromConfig`: the extension of the candidate comes from `paths`, `typesVersions` or a `package.json` field, not
    /// from the specifier.
    ending_from_config: bool,
    /// `resolved.resolvedUsingTsExtension`. Starts as false and is set where a file is found. The search returns the first file it
    /// finds, so the cell is set at most once.
    using_ts_extension: &'a Cell<bool>,
    /// `resolved.extension` is `.d.css.ts`, `.d.json.ts` or the like, which `GetResolutionDiagnostic` takes `allowArbitraryExtensions` for.
    /// Set like `using_ts_extension`.
    arbitrary_extension: &'a Cell<bool>,
}

impl Look<'_> {
    /// `priorityExtensions`
    fn for_types(self) -> Self {
        Look { js: false, ..self }
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
            ..self
        }
    }
}

/// What looking in one place came to.
enum Found {
    File(String),
    /// `unresolved()`: it is said to be nothing, and nowhere else is looked.
    Blocked,
    /// `continueSearching()`
    No,
}

impl Found {
    fn of(file: Option<String>) -> Found {
        file.map_or(Found::No, Found::File)
    }

    fn file(self) -> Option<String> {
        match self {
            Found::File(file) => Some(file),
            Found::Blocked | Found::No => None,
        }
    }
}

pub struct Resolver<'h> {
    host: &'h dyn Host,
    options: &'h Options,
    packages: RwLock<FxHashMap<String, Option<Arc<Package>>>>,
    dirs: RwLock<FxHashMap<String, bool>>,
    files: RwLock<FxHashMap<String, bool>>,
}

/// `extensionsToRemove`: the extensions that mean something, in the order they are looked for at the end of a name.
const KNOWN_EXTENSIONS: [&str; 12] = [
    ".d.ts", ".d.mts", ".d.cts", ".mjs", ".mts", ".cjs", ".cts", ".ts", ".js", ".tsx", ".jsx",
    ".json",
];

/// `TryGetExtensionFromPath`: the extension of `path`, if it is one that means something. Empty otherwise.
pub(crate) fn known_extension(path: &str) -> &'static str {
    KNOWN_EXTENSIONS
        .into_iter()
        .find(|e| path.len() > e.len() && path.ends_with(*e))
        .unwrap_or("")
}

/// `IsDeclarationFileName`: the name ends in `.d.ts`, `.d.mts`, `.d.cts` or `.d.*.ts`.
fn is_declaration_file_name(path: &str) -> bool {
    let base = &path[path.rfind('/').map_or(0, |i| i + 1)..];
    [".d.ts", ".d.mts", ".d.cts"]
        .iter()
        .any(|e| base.ends_with(e))
        || base.ends_with(".ts") && base.contains(".d.")
}

/// Whether the file at `path` is JavaScript, going by its name.
pub fn is_javascript(path: &str) -> bool {
    [".js", ".jsx", ".mjs", ".cjs"]
        .iter()
        .any(|e| path.ends_with(e))
}

impl<'h> Resolver<'h> {
    pub fn new(host: &'h dyn Host, options: &'h Options) -> Self {
        Resolver {
            host,
            options,
            packages: RwLock::default(),
            dirs: RwLock::default(),
            files: RwLock::default(),
        }
    }

    fn is_dir(&self, path: &str) -> bool {
        if let Some(&known) = self.dirs.read().unwrap().get(path) {
            return known;
        }
        let result = self.host.is_dir(path);
        self.dirs.write().unwrap().insert(path.to_owned(), result);
        result
    }

    fn is_file(&self, path: &str) -> bool {
        if let Some(&known) = self.files.read().unwrap().get(path) {
            return known;
        }
        // Most misses are in directories that are not there at all.
        let result = self.is_dir(parent_dir(path)) && self.host.is_file(path);
        self.files.write().unwrap().insert(path.to_owned(), result);
        result
    }

    fn package(&self, dir: &str) -> Option<Arc<Package>> {
        if let Some(known) = self.packages.read().unwrap().get(dir) {
            return known.clone();
        }
        let path = format!("{dir}/package.json");
        let package = if self.is_file(&path) {
            self.host
                .read(&path)
                .and_then(|text| Json::parse(&text))
                .map(|json| Arc::new(Package { json }))
        } else {
            None
        };
        self.packages
            .write()
            .unwrap()
            .insert(dir.to_owned(), package.clone());
        package
    }

    /// `getPackageScopeForPath`: the `package.json` nearest to `dir`, in it or above it, and where it is.
    fn package_scope<'d>(&self, mut dir: &'d str) -> Option<(&'d str, Arc<Package>)> {
        loop {
            if let Some(package) = self.package(dir) {
                return Some((dir, package));
            }
            if dir.is_empty() || dir == "/" {
                return None;
            }
            dir = parent_dir(dir);
        }
    }

    /// The file with the types of what `spec` names when `from` (an absolute path) imports it with a plain `import`.
    pub fn resolve(&self, spec: &str, from: &str) -> Option<String> {
        self.resolve_as(spec, from, self.default_mode(from))
    }

    /// The same for a use that is resolved in `mode` (`getModeForUsageLocation`).
    pub fn resolve_as(&self, spec: &str, from: &str, mode: ResolutionMode) -> Option<String> {
        self.resolve_module(spec, from, mode)
            .filter(|found| !is_javascript(found))
    }

    /// `ResolveModuleName`: the file `spec` names. It may be JavaScript (`is_javascript`): then nothing declares its types.
    pub fn resolve_module(&self, spec: &str, from: &str, mode: ResolutionMode) -> Option<String> {
        self.resolve_module_name(spec, from, mode)
            .map(|resolved| resolved.0)
    }

    /// `ResolveModuleName`: `ResolvedFileName` and `ResolvedUsingTsExtension` of the result.
    pub fn resolve_module_name(
        &self,
        spec: &str,
        from: &str,
        mode: ResolutionMode,
    ) -> Option<(String, bool)> {
        self.resolve_module_and_extension(spec, from, mode)
            .map(|resolved| (resolved.0, resolved.1))
    }

    /// The same, and whether `Extension` of the result is one that takes `allowArbitraryExtensions` (`GetResolutionDiagnostic`).
    pub fn resolve_module_and_extension(
        &self,
        spec: &str,
        from: &str,
        mode: ResolutionMode,
    ) -> Option<(String, bool, bool)> {
        let (using_ts_extension, arbitrary_extension) = (Cell::new(false), Cell::new(false));
        let look = self.look(mode, true, &using_ts_extension, &arbitrary_extension);
        let found = self.resolve_with(spec, from, look)?;
        Some((found, using_ts_extension.get(), arbitrary_extension.get()))
    }

    /// `newResolutionState`. `is_module`: the name is a module specifier. Otherwise it is the name in a `/// <reference types>`, which
    /// resolves to declaration files only.
    fn look<'a>(
        &self,
        mode: ResolutionMode,
        is_module: bool,
        using_ts_extension: &'a Cell<bool>,
        arbitrary_extension: &'a Cell<bool>,
    ) -> Look<'a> {
        let like_node = self.options.resolves_like_node;
        Look {
            esm: like_node && mode == ResolutionMode::Import,
            // `GetConditions`: to a bundler, what is not said to be `require` is `import`.
            import: mode == ResolutionMode::Import || mode == ResolutionMode::None && !like_node,
            typescript: is_module,
            declarations: true,
            js: is_module,
            depth: 0,
            ending_from_config: false,
            using_ts_extension,
            arbitrary_extension,
        }
    }

    /// `resolveNodeLikeWorker`
    fn resolve_with(&self, spec: &str, from: &str, look: Look) -> Option<String> {
        let from_dir = parent_dir(from);
        // `createResolvedModuleHandlingSymlink`: what is in a package is where the links to it lead.
        let follows_links = !self.options.preserve_symlinks;
        let real = |found: String| {
            if follows_links && found.contains("/node_modules/") {
                self.host.realpath(&found)
            } else {
                found
            }
        };
        // `tryLoadModuleUsingPathsIfEligible`: `paths` is asked about all that does not start with dots, `/a` too.
        let starts_with_dots =
            spec.starts_with("./") || spec.starts_with("../") || spec == "." || spec == "..";
        if !starts_with_dots && let Some(found) = self.through_paths(spec, look) {
            return Some(if is_relative(spec) {
                found
            } else {
                real(found)
            });
        }
        if is_relative(spec) {
            return self
                .through_root_dirs(spec, from_dir, look)
                .or_else(|| self.relative(spec, from_dir, look));
        }
        // One place after the other, until one of them has an answer.
        let mut found = Found::No;
        if self.options.resolve_package_json_imports && spec.starts_with('#') {
            found = self.package_imports(spec, from_dir, look);
        }
        if let Found::No = found {
            found = self.self_name(spec, from_dir, look);
        }
        if let Found::No = found {
            // What looks like a URI is in no package.
            if spec.contains(':') {
                return None;
            }
            found = self.node_modules(spec, from_dir, look);
        }
        if let Found::No = found
            && look.declarations
        {
            found = Found::of(self.in_type_roots(spec, look.for_declarations()));
        }
        found.file().map(real)
    }

    /// `loadModuleFromSelfNameReference`: a package can import what it exports, by its own name.
    fn self_name(&self, spec: &str, from_dir: &str, look: Look) -> Found {
        let Some((dir, package)) = self.package_scope(from_dir) else {
            return Found::No;
        };
        let Some(exports) = package.json.get("exports").filter(|e| !is_falsy(e)) else {
            return Found::No;
        };
        let Some(name) = package.json.get("name").and_then(Json::as_str) else {
            return Found::No;
        };
        // Part by part, and a slash at the end counts for nothing (`GetPathComponents`).
        let Some(rest) = spec.strip_suffix('/').unwrap_or(spec).strip_prefix(name) else {
            return Found::No;
        };
        let key = match rest.strip_prefix('/') {
            Some(subpath) => format!("./{subpath}"),
            None if rest.is_empty() => ".".to_owned(),
            None => return Found::No,
        };
        // With `allowJs`, what a project exports may be its own JavaScript, which then goes before the declarations made from it.
        if self.options.allow_js && !from_dir.contains("/node_modules/") {
            return self.exports(dir, exports, &key, look);
        }
        // Otherwise as in `node_modules`: all of it for types, and only then for the rest.
        match self.exports(dir, exports, &key, look.for_types()) {
            Found::No => self.exports(dir, exports, &key, look.for_the_rest()),
            found => found,
        }
    }

    /// What the `package.json` nearest to `path` says its `.js` files are: `Import` for `"type": "module"`, `Require` for
    /// `"type": "commonjs"`.
    fn package_type(&self, path: &str) -> ResolutionMode {
        match self.package_scope(parent_dir(path)) {
            Some((_, package)) => match package.json.get("type").and_then(Json::as_str) {
                Some("module") => ResolutionMode::Import,
                Some("commonjs") => ResolutionMode::Require,
                _ => ResolutionMode::None,
            },
            None => ResolutionMode::None,
        }
    }

    /// Under `module: node16` and later: whether the file at `path` is an ECMAScript module, going by its extension, or else by
    /// the `package.json` nearest to it.
    pub fn is_ecmascript_module(&self, path: &str) -> bool {
        if path.ends_with(".mts") || path.ends_with(".mjs") {
            return true;
        }
        if path.ends_with(".cts") || path.ends_with(".cjs") {
            return false;
        }
        self.package_type(path) == ResolutionMode::Import
    }

    /// `GetImpliedNodeFormatForEmitWorker` over `loadSourceFileMetaData`: what the file at `path` is emitted as, where its name or its
    /// package settles that. Under `module: node16` and later they always do, but for JSON.
    pub fn implied_format(&self, path: &str) -> ResolutionMode {
        if path.ends_with(".mts") || path.ends_with(".mjs") {
            return ResolutionMode::Import;
        }
        if path.ends_with(".cts") || path.ends_with(".cjs") {
            return ResolutionMode::Require;
        }
        if ![".ts", ".tsx", ".js", ".jsx"]
            .iter()
            .any(|e| path.ends_with(e))
        {
            return ResolutionMode::None;
        }
        // The package is only asked when modules are resolved like Node does, and about what is installed.
        let package_type = if self.options.resolves_like_node || path.contains("/node_modules/") {
            self.package_type(path)
        } else {
            ResolutionMode::None
        };
        if self.options.module.is_node() && package_type != ResolutionMode::Import {
            return ResolutionMode::Require;
        }
        package_type
    }

    /// How a plain `import` in the file at `path` is resolved.
    pub fn default_mode(&self, path: &str) -> ResolutionMode {
        self.options.default_mode(self.implied_format(path))
    }

    /// `name@version/path/in/package` for a file of a package: two copies of one version of a package are one.
    pub fn package_id(&self, path: &str) -> Option<String> {
        let marker = "/node_modules/";
        let at = path.rfind(marker)? + marker.len();
        let (name, subpath) = split_package_name(&path[at..]);
        let package = self.package(&path[..at + name.len()])?;
        let version = package.json.get("version")?.as_str()?;
        let declared = package.json.get("name")?.as_str()?;
        Some(format!("{declared}@{version}/{subpath}"))
    }

    /// `ResolveTypeReferenceDirective`: `/// <reference types="name" />` in a file in `from_dir`, resolved in `mode`; with
    /// `is_automatic`, an entry of `compilerOptions.types`.
    pub fn resolve_type_reference(
        &self,
        name: &str,
        from_dir: &str,
        mode: ResolutionMode,
        is_automatic: bool,
    ) -> Option<String> {
        // `ResolvedTypeReferenceDirective` has no `ResolvedUsingTsExtension`.
        let ignored = Cell::new(false);
        let look = self.look(mode, false, &ignored, &ignored);
        let has_roots = self.options.type_roots.is_some();
        // First where types are kept, wherever the reference is written.
        let primary = if has_roots {
            self.in_type_roots(name, look)
        } else {
            self.types_package(name, &self.options.base_dir, look)
        };
        let found = primary.or_else(|| {
            // Then like a module, from where it is written. What `types` names is only looked for where `typeRoots` says.
            if is_automatic && has_roots {
                None
            } else if is_relative(name) {
                self.relative(name, from_dir, look)
            } else {
                self.node_modules(name, from_dir, look).file()
            }
        })?;
        // `createResolvedTypeReferenceDirective`: `typesVersions` can name any file, and only TypeScript will do.
        if ![".ts", ".tsx", ".mts", ".cts"]
            .iter()
            .any(|e| found.ends_with(e))
        {
            return None;
        }
        Some(if self.options.preserve_symlinks {
            found
        } else {
            self.host.realpath(&found)
        })
    }

    /// In the `node_modules/@types` of `from_dir` and of all that is around it.
    fn types_package(&self, name: &str, from_dir: &str, look: Look) -> Option<String> {
        let mut dir = from_dir;
        loop {
            let candidate = format!("{dir}/node_modules/@types/{}", mangle_scoped(name));
            if self.is_dir(&candidate)
                && let Some(found) = self.package_entry(&candidate, look)
            {
                return Some(found);
            }
            if dir == "/" || dir.is_empty() {
                break;
            }
            dir = parent_dir(dir);
        }
        None
    }

    /// `resolveFromTypeRoot`: in what `typeRoots` names, a file or a directory. Nothing if it is not said.
    fn in_type_roots(&self, name: &str, look: Look) -> Option<String> {
        for root in self.options.type_roots.as_deref().unwrap_or(&[]) {
            if !self.is_dir(root) {
                continue;
            }
            // `getCandidateFromTypeRoot`
            let candidate = if root.ends_with("/node_modules/@types") {
                format!("{root}/{}", mangle_scoped(name))
            } else {
                format!("{root}/{name}")
            };
            if let Some(found) = self
                .file(&candidate, look)
                .or_else(|| self.package_entry(&candidate, look))
            {
                return Some(found);
            }
        }
        None
    }

    /// `tryLoadModuleUsingPaths` with `compilerOptions.paths`.
    fn through_paths(&self, spec: &str, look: Look) -> Option<String> {
        let (targets, matched) = best_pattern(self.options.paths.as_slice(), spec)?;
        targets.iter().find_map(|target| {
            let base = if self.options.paths_base_dir.is_empty() {
                &self.options.base_dir
            } else {
                &self.options.paths_base_dir
            };
            let path = join(base, &target.replacen('*', matched, 1));
            let look = Look {
                ending_from_config: look.ending_from_config || !known_extension(target).is_empty(),
                ..look
            };
            self.very_file(target, &path)
                .or_else(|| self.file_or_directory(&path, look))
        })
    }

    /// In `tryLoadModuleUsingPaths`: a substitution that is `written` with an extension may name the file at `path` itself, which
    /// then is the answer, whatever kind of file is wanted, before anything is made of the extension.
    fn very_file(&self, written: &str, path: &str) -> Option<String> {
        match known_extension(written) {
            "" => None,
            // Without `resolveJsonModule` a JSON file is of no use (`GetResolutionDiagnostic`): it is not found.
            ".json" if !self.options.resolve_json_module => None,
            _ => self.try_file(path),
        }
    }

    /// `tryLoadModuleUsingRootDirs`: what is in one of `rootDirs` is looked for there, and then at the same place in each of the others.
    fn through_root_dirs(&self, spec: &str, from_dir: &str, look: Look) -> Option<String> {
        if self.options.root_dirs.is_empty() {
            return None;
        }
        let candidate = join(from_dir, spec);
        // The longest of them that it is in, and of those the first.
        let mut matched: Option<&str> = None;
        for root in &self.options.root_dirs {
            if candidate
                .strip_prefix(root.as_str())
                .is_some_and(|rest| rest.starts_with('/'))
                && matched.is_none_or(|m| m.len() < root.len())
            {
                matched = Some(root.as_str());
            }
        }
        let matched = matched?;
        let rest = &candidate[matched.len()..];
        let load = |path: &str| {
            if spec.ends_with('/') {
                self.directory(path, look)
            } else {
                self.file_or_directory(path, look)
            }
        };
        let others = self
            .options
            .root_dirs
            .iter()
            .filter(|root| root.as_str() != matched);
        load(&candidate).or_else(|| {
            others
                .map(|root| format!("{root}{rest}"))
                .find_map(|path| load(&path))
        })
    }

    /// `tryLoadModuleUsingPaths` with the `typesVersions` of `package`, which is in `dir`: what they make of `name`, a path in the
    /// package, found by `load`. The second argument of `load` tells whether the substitution has an extension
    /// (`candidateEndingIsFromConfig`).
    fn through_types_versions(
        &self,
        package: &Package,
        dir: &str,
        name: &str,
        load: &dyn Fn(&str, bool) -> Option<String>,
    ) -> Option<String> {
        let versions = package.json.get("typesVersions")?.as_object()?;
        // `GetVersionPaths`: the first range that has the compiler's version in it, and no other.
        let (_, mapping) = versions
            .iter()
            .find(|(range, _)| version_in_range(TYPESCRIPT_VERSION, range))?;
        let (targets, matched) = best_pattern(mapping.as_object()?, name)?;
        targets
            .as_array()?
            .iter()
            .filter_map(Json::as_str)
            .find_map(|target| {
                let path = join(dir, &target.replacen('*', matched, 1));
                self.very_file(target, &path)
                    .or_else(|| load(&path, !known_extension(target).is_empty()))
            })
    }

    /// What `spec`, which says where a file is, names in `from_dir`.
    fn relative(&self, spec: &str, from_dir: &str, look: Look) -> Option<String> {
        let path = join(from_dir, spec);
        // `normalizePathForCJSResolution`: what ends in a slash or in dots is a directory and nothing else.
        let is_directory = spec.ends_with('/')
            || spec == "."
            || spec == ".."
            || spec.ends_with("/.")
            || spec.ends_with("/..");
        if is_directory {
            self.directory(&path, look)
        } else {
            self.file_or_directory(&path, look)
        }
    }

    /// `nodeLoadModuleByRelativeName`
    fn file_or_directory(&self, path: &str, look: Look) -> Option<String> {
        if let Some(found) = self.file(path, look) {
            return Some(found);
        }
        self.directory(path, look)
    }

    /// To Node's `import` a directory is nothing.
    fn directory(&self, path: &str, look: Look) -> Option<String> {
        if !look.esm && self.is_dir(path) {
            self.package_entry(path, look)
        } else {
            None
        }
    }

    /// `tryFile`: `path`, if it is a file. With `moduleSuffixes`, the first that is one of `path` with each of them before its extension.
    fn try_file(&self, path: &str) -> Option<String> {
        if self.options.module_suffixes.is_empty() {
            return self.is_file(path).then(|| path.to_owned());
        }
        let extension = known_extension(path);
        let stem = &path[..path.len() - extension.len()];
        self.options
            .module_suffixes
            .iter()
            .map(|suffix| format!("{stem}{suffix}{extension}"))
            .find(|c| self.is_file(c))
    }

    /// The first of `stem` with each of `extensions` that is a file.
    fn first_file(&self, stem: &str, extensions: &[&str]) -> Option<String> {
        extensions
            .iter()
            .find_map(|e| self.try_file(&format!("{stem}{e}")))
    }

    /// `loadModuleFromFile`: what stands for `path` as it is written, or else `path` with an extension added.
    fn file(&self, path: &str, look: Look) -> Option<String> {
        if let Some(found) = self.file_as_written(path, look) {
            return Some(found);
        }
        // To Node's `import` nothing is added.
        if look.esm {
            return None;
        }
        self.with_extensions(path, "", look)
    }

    /// `loadModuleFromFileNoImplicitExtensions`: the extension that is written comes off, and those it stands for are tried in its place.
    fn file_as_written(&self, path: &str, look: Look) -> Option<String> {
        let name = &path[path.rfind('/').map_or(0, |i| i + 1)..];
        let dot = name.rfind('.')?;
        // `RemoveFileExtension`: `.d.ts` comes off as a whole.
        let extension = [".d.ts", ".d.mts", ".d.cts"]
            .into_iter()
            .find(|e| name.ends_with(*e))
            .unwrap_or(&name[dot..]);
        self.with_extensions(&path[..path.len() - extension.len()], extension, look)
    }

    /// `tryAddingExtensions`: `stem` with each of the extensions that `written` stands for, in a fixed order: TypeScript, declaration,
    /// JavaScript or JSON, each kind only if `look` has it. What is written does not go first.
    fn with_extensions(&self, stem: &str, written: &str, look: Look) -> Option<String> {
        let (typescript, declaration, rest): (&[&str], &str, &[&str]) = match written {
            ".ts" | ".d.ts" | ".js" | "" => (&[".ts", ".tsx"], ".d.ts", &[".js", ".jsx"]),
            ".tsx" | ".jsx" => (&[".tsx", ".ts"], ".d.ts", &[".jsx", ".js"]),
            ".mts" | ".d.mts" | ".mjs" => (&[".mts"], ".d.mts", &[".mjs"]),
            ".cts" | ".d.cts" | ".cjs" => (&[".cts"], ".d.cts", &[".cjs"]),
            // The file itself only with `resolveJsonModule`.
            ".json" if self.options.resolve_json_module => (&[], ".d.json.ts", &[".json"]),
            ".json" => (&[], ".d.json.ts", &[]),
            // `./a.css` is declared by `a.d.css.ts`.
            _ => {
                return if look.declarations {
                    let found = self.try_file(&format!("{stem}.d{written}.ts"))?;
                    look.arbitrary_extension.set(true);
                    Some(found)
                } else {
                    None
                };
            }
        };
        let typed = if look.typescript {
            self.first_file(stem, typescript)
        } else {
            None
        };
        let typed = typed.or_else(|| {
            if look.declarations {
                self.try_file(&format!("{stem}{declaration}"))
            } else {
                None
            }
        });
        if let Some(found) = typed {
            // `tryExtension`
            let is_ts_extension = matches!(
                written,
                ".ts" | ".d.ts" | ".tsx" | ".mts" | ".d.mts" | ".cts" | ".d.cts"
            );
            look.using_ts_extension
                .set(!look.ending_from_config && is_ts_extension);
            // `.d.json.ts`
            look.arbitrary_extension.set(written == ".json");
            return Some(found);
        }
        if look.js {
            self.first_file(stem, rest)
        } else {
            None
        }
    }

    /// `loadFileNameFromPackageJSONField`: the file at `path`, which a `package.json` names. A TypeScript or declaration file name
    /// resolves to exactly that file or to nothing, if `look` has its kind. The extension of any other name is replaced as it is in a
    /// specifier, and none is added. `package_json_value` is the value as the `package.json` has it, before a `*` in it is replaced.
    fn named_file(&self, path: &str, package_json_value: &str, look: Look) -> Option<String> {
        let is_declaration = is_declaration_file_name(path);
        let is_implementation = !is_declaration
            && [".ts", ".tsx", ".mts", ".cts"]
                .iter()
                .any(|e| path.ends_with(e));
        if look.typescript && is_implementation || look.declarations && is_declaration {
            let found = self.try_file(path)?;
            // A `*` at the end stands for a part of the specifier that includes the extension.
            look.using_ts_extension
                .set(package_json_value.ends_with('*'));
            return Some(found);
        }
        self.file_as_written(path, look)
    }

    /// `loadNodeModuleFromDirectory`: what the directory `dir` resolves to, going by its own `package.json`.
    fn package_entry(&self, dir: &str, look: Look) -> Option<String> {
        let package = self.package(dir);
        self.directory_entry(dir, package.as_deref(), true, look)
    }

    /// `loadNodeModuleFromDirectoryWorker`: what the directory `dir` resolves to: the file its `package.json` names, or its `index`.
    /// `package` is the `package.json` of `dir` if `is_package_dir`. Otherwise it is that of the package around `dir`, and only its
    /// `typesVersions` apply.
    fn directory_entry(
        &self,
        dir: &str,
        package: Option<&Package>,
        is_package_dir: bool,
        look: Look,
    ) -> Option<String> {
        if let Some(package) = package {
            // `getPackageFile`: the first of these fields that has a value, and no other.
            let fields: &[&str] = match (is_package_dir, look.declarations) {
                (false, _) => &[],
                (true, true) => &["typings", "types", "main"],
                (true, false) => &["main"],
            };
            let entry = fields.iter().find_map(|field| {
                package
                    .json
                    .get(field)
                    .and_then(Json::as_str)
                    .filter(|e| !e.is_empty())
            });
            let entry = entry.map(|e| join(dir, e));
            let package_file = entry.as_deref().unwrap_or("");
            let inner = Look {
                // What a package that is not `"type": "module"` names may leave its extension out, whoever asks.
                esm: look.esm && package.json.get("type").and_then(Json::as_str) == Some("module"),
                // `expandedExtensions`: `types` may name a `.ts` file even where only declaration files are looked for.
                typescript: look.typescript || look.declarations && !look.js,
                ending_from_config: true,
                ..look
            };
            let load = |path: &str, has_extension_from_config: bool| -> Option<String> {
                let as_named = Look {
                    ending_from_config: look.ending_from_config || has_extension_from_config,
                    ..look
                };
                if let Some(found) = self
                    .named_file(path, package_file, as_named)
                    .or_else(|| self.file(path, inner))
                {
                    return Some(found);
                }
                if !inner.esm && self.is_dir(path) {
                    self.file(&format!("{path}/index"), inner)
                } else {
                    None
                }
            };
            // `typesVersions` are about the entry too, if it is in the package, and about `index` if there is none.
            let in_package = match &entry {
                Some(entry) => entry
                    .strip_prefix(dir)
                    .and_then(|rest| rest.strip_prefix('/')),
                None => Some("index"),
            };
            if let Some(name) = in_package
                && let Some(found) = self.through_types_versions(package, dir, name, &load)
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
            self.file(&format!("{dir}/index"), look)
        }
    }

    /// `loadModuleFromNearestNodeModulesDirectory`: types, however far out they are, go before JavaScript, however near. What the
    /// search for types is told is nothing is not looked for again.
    fn node_modules(&self, spec: &str, from_dir: &str, look: Look) -> Found {
        if look.typescript || look.declarations {
            match self.node_modules_once(spec, from_dir, look.for_types()) {
                Found::No => {}
                found => return found,
            }
        }
        if look.js {
            self.node_modules_once(spec, from_dir, look.for_the_rest())
        } else {
            Found::No
        }
    }

    /// `loadModuleFromNearestNodeModulesDirectoryWorker`: in each `node_modules` from `from_dir` outwards, the package and then, for
    /// types, its `@types`.
    fn node_modules_once(&self, spec: &str, from_dir: &str, look: Look) -> Found {
        let mut dir = from_dir;
        loop {
            if !dir.ends_with("/node_modules") {
                let modules = format!("{dir}/node_modules");
                if self.is_dir(&modules) {
                    match self.in_modules(&modules, spec, look) {
                        Found::No => {}
                        found => return found,
                    }
                    let types = format!("{modules}/@types");
                    if look.declarations && self.is_dir(&types) {
                        match self.in_modules(&types, &mangle_scoped(spec), look.for_declarations())
                        {
                            Found::No => {}
                            found => return found,
                        }
                    }
                }
            }
            if dir == "/" || dir.is_empty() {
                return Found::No;
            }
            dir = parent_dir(dir);
        }
    }

    /// `loadModuleFromSpecificNodeModulesDirectory`: `spec` in `modules`, which is a `node_modules` or the `@types` in one.
    fn in_modules(&self, modules: &str, spec: &str, look: Look) -> Found {
        let spec = spec.strip_suffix('/').unwrap_or(spec);
        let (name, rest) = split_package_name(spec);
        let candidate = format!("{modules}/{spec}");
        let package_dir = format!("{modules}/{name}");
        let package = self.package(&package_dir);
        let exports = package
            .as_ref()
            .and_then(|p| p.json.get("exports"))
            .filter(|_| self.options.resolve_package_json_exports);
        // A directory in a package that has a `package.json` of its own goes by that, unless the package says what it exports.
        if !rest.is_empty()
            && exports.is_none()
            && self.package(&candidate).is_some()
            && let Some(found) = self
                .file(&candidate, look)
                .or_else(|| self.package_entry(&candidate, look))
        {
            return Found::File(found);
        }
        // What a package exports is all there is to it: no file, no directory, no `typesVersions`. `"exports": null` says nothing.
        if let Some(exports) = exports
            && !is_falsy(exports)
        {
            let key = if rest.is_empty() {
                ".".to_owned()
            } else {
                format!("./{rest}")
            };
            return self.exports(&package_dir, exports, &key, look);
        }
        let load = |candidate: &str, has_extension_from_config: bool| -> Option<String> {
            let look = Look {
                ending_from_config: look.ending_from_config || has_extension_from_config,
                ..look
            };
            if (!rest.is_empty() || !look.esm)
                && let Some(found) = self.file(candidate, look)
            {
                return Some(found);
            }
            // The `package.json` of the package also goes with the directories inside the package.
            if let Some(found) = self.directory_entry(
                candidate,
                package.as_deref(),
                candidate == package_dir,
                look,
            ) {
                return Some(found);
            }
            // To Node's `import`, a package that names no entry and says nothing of `exports` still has `index.js`.
            let is_silent = rest.is_empty()
                && package
                    .as_ref()
                    .is_some_and(|p| matches!(p.json.get("exports"), None | Some(Json::Null)));
            if look.esm && is_silent {
                self.file(&format!("{candidate}/index.js"), look)
            } else {
                None
            }
        };
        if !rest.is_empty()
            && let Some(package) = &package
            && let Some(found) = self.through_types_versions(package, &package_dir, rest, &load)
        {
            return Found::File(found);
        }
        Found::of(load(&candidate, false))
    }

    /// `loadModuleFromExports`: what the `exports` of the package in `package_dir` make of `key`, which is `.` or `./sub/path`.
    fn exports(&self, package_dir: &str, exports: &Json, key: &str, look: Look) -> Found {
        // `IsConditions`, `IsSubpaths`: none of the keys starts with a dot, or all of them do.
        fn dotted(entries: &[(String, Json)]) -> usize {
            entries.iter().filter(|e| e.0.starts_with('.')).count()
        }
        if key == "." {
            let main = match exports {
                Json::String(_) | Json::Array(_) => Some(exports),
                Json::Object(entries) if dotted(entries) == 0 => Some(exports),
                Json::Object(entries) => entries.iter().find(|e| e.0 == ".").map(|e| &e.1),
                _ => None,
            };
            return match main {
                Some(main) => self.export_target(package_dir, main, "", false, false, look),
                None => Found::No,
            };
        }
        match exports {
            Json::Object(entries) if dotted(entries) == entries.len() => {
                self.lookup_table(package_dir, entries, key, false, look)
            }
            _ => Found::No,
        }
    }

    /// `loadModuleFromExportsOrImports`: what `table`, the `exports` or the `imports` of the `package.json` in `package_dir`, has for `name`.
    fn lookup_table(
        &self,
        package_dir: &str,
        table: &[(String, Json)],
        name: &str,
        is_imports: bool,
        look: Look,
    ) -> Found {
        if !name.ends_with('/')
            && !name.contains('*')
            && let Some((_, target)) = table.iter().find(|e| e.0 == name)
        {
            return self.export_target(package_dir, target, "", false, is_imports, look);
        }
        // The keys that stand for many names: those with one `*`, and those that end in a slash.
        let mut keys: Vec<&(String, Json)> = table
            .iter()
            .filter(|e| e.0.matches('*').count() == 1 || e.0.ends_with('/'))
            .collect();
        keys.sort_by(|a, b| compare_pattern_keys(&a.0, &b.0));
        // The first that fits has it, whatever its target comes to.
        for (key, target) in keys {
            if let Some(matched) = match_pattern(key, name) {
                return self.export_target(package_dir, target, matched, true, is_imports, look);
            }
            if let Some(rest) = name.strip_prefix(key.as_str()) {
                return self.export_target(package_dir, target, rest, false, is_imports, look);
            }
        }
        Found::No
    }

    /// `loadModuleFromTargetExportOrImport`. `subpath`: what the `*` of the key stands for if `is_pattern`, or else what follows the key.
    fn export_target(
        &self,
        package_dir: &str,
        target: &Json,
        subpath: &str,
        is_pattern: bool,
        is_imports: bool,
        look: Look,
    ) -> Found {
        match target {
            Json::String(path) => {
                // Only to a directory can something be added.
                if !is_pattern && !subpath.is_empty() && !path.ends_with('/') {
                    return Found::No;
                }
                let filled = if is_pattern {
                    path.replace('*', subpath)
                } else {
                    format!("{path}{subpath}")
                };
                if !path.starts_with("./") {
                    // In `imports` it may be the name of a module, which is looked for from where the `package.json` is.
                    if is_imports
                        && !path.starts_with("../")
                        && !path.starts_with('/')
                        && look.depth < 8
                    {
                        let look = Look {
                            depth: look.depth + 1,
                            ..look
                        };
                        return Found::of(self.resolve_with(
                            &filled,
                            &format!("{package_dir}/package.json"),
                            look,
                        ));
                    }
                    return Found::No;
                }
                // It stays in the package, and out of the packages in it.
                let leads_away = |part: &str| matches!(part, ".." | "." | "node_modules");
                if path.split('/').skip(1).any(leads_away) || subpath.split('/').any(leads_away) {
                    return Found::No;
                }
                Found::of(self.named_file(&join(package_dir, &filled), path, look))
            }
            // The first condition that holds and has an answer.
            Json::Object(conditions) => {
                for (condition, target) in conditions {
                    if self.condition_matches(condition, look) {
                        match self.export_target(
                            package_dir,
                            target,
                            subpath,
                            is_pattern,
                            is_imports,
                            look,
                        ) {
                            Found::No => {}
                            found => return found,
                        }
                    }
                }
                Found::No
            }
            Json::Array(targets) => {
                for target in targets {
                    match self.export_target(
                        package_dir,
                        target,
                        subpath,
                        is_pattern,
                        is_imports,
                        look,
                    ) {
                        Found::No => {}
                        found => return found,
                    }
                }
                Found::No
            }
            Json::Null => Found::Blocked,
            _ => Found::No,
        }
    }

    /// `conditionMatches`, of what `GetConditions` gives. (See `version_in_range` for `types@<range>`.)
    fn condition_matches(&self, condition: &str, look: Look) -> bool {
        let by_mode = if look.import { "import" } else { "require" };
        condition == "default"
            || condition == "types"
            || condition == by_mode
            || condition == "node" && self.options.resolves_like_node
            || self
                .options
                .custom_conditions
                .iter()
                .any(|c| c == condition)
            || condition
                .strip_prefix("types@")
                .is_some_and(|range| version_in_range(TYPESCRIPT_VERSION, range))
    }

    /// `loadModuleFromImports`: `#name`, through the `imports` of the nearest `package.json`.
    fn package_imports(&self, spec: &str, from_dir: &str, look: Look) -> Found {
        if spec == "#" || spec.starts_with("#/") && self.options.resolves_like_node16 {
            return Found::No;
        }
        let Some((dir, package)) = self.package_scope(from_dir) else {
            return Found::No;
        };
        match package.json.get("imports").and_then(Json::as_object) {
            Some(imports) => self.lookup_table(dir, imports, spec, true, look),
            None => Found::No,
        }
    }
}

/// `IsFalsy`, of a value in a `package.json`.
fn is_falsy(json: &Json) -> bool {
    match json {
        Json::Null | Json::Bool(false) => true,
        Json::String(text) => text.is_empty(),
        Json::Number(n) => *n == 0.0,
        _ => false,
    }
}

/// `MatchPatternOrExact`: what `table` has for `name`: under that very name, or else under the pattern that fits it with the longest
/// prefix, the first of those. With it, what the `*` stands for.
pub(crate) fn best_pattern<'t, 'n, T>(
    table: &'t [(String, T)],
    name: &'n str,
) -> Option<(&'t T, &'n str)> {
    if let Some((_, exact)) = table.iter().find(|e| e.0 == name && !e.0.contains('*')) {
        return Some((exact, ""));
    }
    let mut best: Option<(&'t T, &'n str, usize)> = None;
    for (pattern, value) in table {
        // `TryParsePattern`: with more than one `*` it is no pattern.
        let Some(star) = pattern.find('*') else {
            continue;
        };
        if !pattern[star + 1..].contains('*')
            && best.is_none_or(|b| star > b.2)
            && let Some(matched) = match_pattern(pattern, name)
        {
            best = Some((value, matched, star));
        }
    }
    best.map(|b| (b.0, b.1))
}

/// `ComparePatternKeys`: the longer part up to the `*` goes first, then a key with a `*`, then the longer key.
fn compare_pattern_keys(a: &str, b: &str) -> Ordering {
    let (star_a, star_b) = (a.find('*'), b.find('*'));
    let (base_a, base_b) = (
        star_a.map_or(a.len(), |i| i + 1),
        star_b.map_or(b.len(), |i| i + 1),
    );
    base_b
        .cmp(&base_a)
        .then(star_a.is_none().cmp(&star_b.is_none()))
        .then(b.len().cmp(&a.len()))
}

fn match_pattern<'a>(pattern: &str, text: &'a str) -> Option<&'a str> {
    let star = pattern.find('*')?;
    let (prefix, suffix) = (&pattern[..star], &pattern[star + 1..]);
    if text.len() >= prefix.len() + suffix.len()
        && text.starts_with(prefix)
        && text.ends_with(suffix)
    {
        return Some(&text[prefix.len()..text.len() - suffix.len()]);
    }
    None
}

/// `@scope/name/sub/path` is (`@scope/name`, `sub/path`).
fn split_package_name(spec: &str) -> (&str, &str) {
    let mut slash = spec.find('/');
    if spec.starts_with('@')
        && let Some(first) = slash
    {
        slash = spec[first + 1..].find('/').map(|i| first + 1 + i);
    }
    match slash {
        Some(i) => (&spec[..i], &spec[i + 1..]),
        None => (spec, ""),
    }
}

/// `@scope/name` has its types in `@types/scope__name`.
fn mangle_scoped(name: &str) -> String {
    match name.strip_prefix('@') {
        Some(rest) => rest.replacen('/', "__", 1),
        None => name.to_owned(),
    }
}

/// The version of TypeScript whose answers are wanted, for packages that ship different declarations for different ones.
const TYPESCRIPT_VERSION: [u32; 3] = [7, 0, 2];

/// Whether `version` is in the semver range `range`: `>=4.2`, `<=5.0`, `>3.1 <5`, `4.x || >=6`, `*`.
fn version_in_range(version: [u32; 3], range: &str) -> bool {
    range.split("||").any(|alternative| {
        alternative.split_whitespace().all(|comparator| {
            let digits = comparator
                .find(|c: char| c.is_ascii_digit() || matches!(c, '*' | 'x' | 'X'))
                .unwrap_or(comparator.len());
            let (op, text) = comparator.split_at(digits);
            // What is left out or `x` stands for anything.
            let mut given: Vec<u32> = Vec::new();
            for part in text.split(['-', '+']).next().unwrap_or("").split('.') {
                match part.parse() {
                    Ok(n) => given.push(n),
                    Err(_) => break,
                }
            }
            if given.is_empty() {
                return true;
            }
            given.truncate(3);
            let mut low = [0; 3];
            low[..given.len()].copy_from_slice(&given);
            // The first version past those that start with what is given, or with its first `keep` numbers.
            let past = |keep: usize| {
                let mut v = [0; 3];
                v[..keep].copy_from_slice(&low[..keep]);
                v[keep - 1] += 1;
                v
            };
            let is_partial = given.len() < 3;
            match op {
                ">=" => version >= low,
                ">" => {
                    if is_partial {
                        version >= past(given.len())
                    } else {
                        version > low
                    }
                }
                "<" => version < low,
                "<=" => {
                    if is_partial {
                        version < past(given.len())
                    } else {
                        version <= low
                    }
                }
                "~" => version >= low && version < past(given.len().min(2)),
                "^" => {
                    version >= low
                        && version
                            < past(if low[0] > 0 || given.len() == 1 {
                                1
                            } else if low[1] > 0 || given.len() == 2 {
                                2
                            } else {
                                3
                            })
                }
                _ => {
                    if is_partial {
                        version >= low && version < past(given.len())
                    } else {
                        version == low
                    }
                }
            }
        })
    })
}

/// `UnprefixedNodeCoreModules`: what comes with Node, with or without `node:` in front.
const NODE_CORE_MODULES: &[&str] = &[
    "assert",
    "assert/strict",
    "async_hooks",
    "buffer",
    "child_process",
    "cluster",
    "console",
    "constants",
    "crypto",
    "dgram",
    "diagnostics_channel",
    "dns",
    "dns/promises",
    "domain",
    "events",
    "fs",
    "fs/promises",
    "http",
    "http2",
    "https",
    "inspector",
    "inspector/promises",
    "module",
    "net",
    "os",
    "path",
    "path/posix",
    "path/win32",
    "perf_hooks",
    "process",
    "punycode",
    "querystring",
    "readline",
    "readline/promises",
    "repl",
    "stream",
    "stream/consumers",
    "stream/promises",
    "stream/web",
    "string_decoder",
    "sys",
    "timers",
    "timers/promises",
    "tls",
    "trace_events",
    "tty",
    "url",
    "util",
    "util/types",
    "v8",
    "vm",
    "wasi",
    "worker_threads",
    "zlib",
];
/// `ExclusivelyPrefixedNodeCoreModules`
const PREFIXED_NODE_CORE_MODULES: &[&str] = &[
    "node:quic",
    "node:sea",
    "node:sqlite",
    "node:test",
    "node:test/reporters",
];

pub fn is_node_core_module(spec: &str) -> bool {
    NODE_CORE_MODULES.contains(&spec.strip_prefix("node:").unwrap_or(spec))
        || PREFIXED_NODE_CORE_MODULES.contains(&spec)
}

#[cfg(test)]
mod tests {
    #[test]
    fn version_ranges() {
        use super::version_in_range as within;
        let v = [6, 0, 0];
        assert!(!within(v, "<=5.0"));
        assert!(within([5, 0, 4], "<=5.0"));
        assert!(!within([5, 1, 0], "<=5.0"));
        assert!(within(v, ">=4.2"));
        assert!(within(v, "*"));
        assert!(within(v, ">3.1 <7"));
        assert!(!within(v, ">3.1 <5"));
        assert!(within(v, "4.x || >=6"));
        assert!(!within(v, ">6.0"));
        assert!(within(v, "^6.0"));
        assert!(!within(v, "~5.9"));
        assert!(within(v, "6"));
    }

    use super::*;

    #[test]
    fn paths_are_normalized() {
        assert_eq!(join("/a/b", "../c/./d.ts"), "/a/c/d.ts");
        assert_eq!(split_package_name("@s/n/x/y"), ("@s/n", "x/y"));
        assert_eq!(split_package_name("n"), ("n", ""));
        assert_eq!(mangle_scoped("@s/n"), "s__n");
        assert_eq!(match_pattern("./a/*.js", "./a/b/c.js"), Some("b/c"));
    }

    #[test]
    fn pattern_keys_are_ordered() {
        let mut keys = ["./a/", "./*", "./a/*", "./a/b/*.js", "./a/*.js"];
        keys.sort_by(|a, b| compare_pattern_keys(a, b));
        assert_eq!(keys, ["./a/b/*.js", "./a/*.js", "./a/*", "./a/", "./*"]);
    }

    /// Files, by their paths, and what is in them.
    struct Fake(&'static [(&'static str, &'static str)]);

    impl Host for Fake {
        fn read(&self, path: &str) -> Option<Cow<'static, [u8]>> {
            self.0
                .iter()
                .find(|f| f.0 == path)
                .map(|f| Cow::Borrowed(f.1.as_bytes()))
        }
        fn is_file(&self, path: &str) -> bool {
            self.0.iter().any(|f| f.0 == path)
        }
        fn is_dir(&self, path: &str) -> bool {
            self.0.iter().any(|f| {
                f.0.strip_prefix(path)
                    .is_some_and(|rest| rest.starts_with('/'))
            })
        }
        fn realpath(&self, path: &str) -> String {
            path.to_owned()
        }
        fn list_dir(&self, _: &str) -> Vec<String> {
            Vec::new()
        }
        fn parse(
            &self,
            _: &str,
            _: &[u8],
            _: &crate::atom::Interner,
            _: &Options,
        ) -> crate::hir::File {
            crate::hir::File::default()
        }
        fn parallel(&self, count: usize, work: &(dyn Fn(usize) + Sync)) {
            (0..count).for_each(work);
        }
    }

    fn like_node() -> Options {
        Options {
            base_dir: "/p".to_owned(),
            resolves_like_node: true,
            resolve_package_json_exports: true,
            resolve_package_json_imports: true,
            resolve_json_module: true,
            ..Default::default()
        }
    }

    #[test]
    fn javascript_is_found_where_types_are_not() {
        let host = Fake(&[
            ("/p/src/x.js", ""),
            ("/p/src/x/index.ts", ""),
            ("/p/src/y.js", ""),
            ("/p/src/typed.js", ""),
            ("/p/src/typed.d.ts", ""),
            ("/p/src/tags.jsx", ""),
            ("/p/src/tags.js", ""),
            ("/p/src/node_modules/far/index.js", ""),
            ("/p/node_modules/@types/far/index.d.ts", ""),
            (
                "/p/node_modules/exported/package.json",
                r#"{ "exports": { "./foo": "./dist/foo.js", "./typed": { "types": "./typed.d.ts", "default": "./dist/foo.js" } } }"#,
            ),
            ("/p/node_modules/exported/dist/foo.js", ""),
            ("/p/node_modules/exported/typed.d.ts", ""),
            ("/p/node_modules/exported/hidden.js", ""),
            (
                "/p/node_modules/blocked/package.json",
                r#"{ "exports": { ".": { "require": "./x.js", "default": null }, "./list": ["./x.js", null] } }"#,
            ),
            ("/p/node_modules/blocked/x.js", ""),
            (
                "/p/node_modules/declared/package.json",
                r#"{ "exports": { ".": "./types/foo.d.ts" } }"#,
            ),
            ("/p/node_modules/declared/types/foo.js", ""),
            (
                "/p/node_modules/versions/package.json",
                r#"{ "typesVersions": { "*": { "sub": ["./lib/sub.js"] } } }"#,
            ),
            ("/p/node_modules/versions/lib/sub.js", ""),
            ("/p/node_modules/versions/lib/sub.d.ts", ""),
            ("/p/node_modules/mjs/package.json", "{}"),
            ("/p/node_modules/mjs/index.mjs", ""),
            ("/p/node_modules/mjs/sub.mjs", ""),
            (
                "/p/node_modules/types-js/package.json",
                r#"{ "types": "foo.js" }"#,
            ),
            ("/p/node_modules/types-js/foo.js", ""),
            (
                "/p/node_modules/main-js/package.json",
                r#"{ "types": "nope.d.ts", "main": "foo.js" }"#,
            ),
            ("/p/node_modules/main-js/foo.js", ""),
            ("/p/node_modules/data/d.json", "{}"),
        ]);
        let options = like_node();
        let resolver = Resolver::new(&host, &options);
        let find =
            |spec: &str| resolver.resolve_module(spec, "/p/src/a.cts", ResolutionMode::Require);
        // What says where a file is: everything is tried in one place before the next.
        assert_eq!(find("./x").as_deref(), Some("/p/src/x.js"));
        assert_eq!(find("./y.ts").as_deref(), Some("/p/src/y.js"));
        assert_eq!(find("./typed").as_deref(), Some("/p/src/typed.d.ts"));
        assert_eq!(find("./tags").as_deref(), Some("/p/src/tags.js"));
        assert_eq!(find("./tags.jsx").as_deref(), Some("/p/src/tags.jsx"));
        // In packages: types everywhere, then the rest everywhere.
        assert_eq!(
            find("far").as_deref(),
            Some("/p/node_modules/@types/far/index.d.ts")
        );
        assert_eq!(
            find("exported/foo").as_deref(),
            Some("/p/node_modules/exported/dist/foo.js")
        );
        assert_eq!(
            find("exported/typed").as_deref(),
            Some("/p/node_modules/exported/typed.d.ts")
        );
        assert_eq!(find("exported/hidden"), None);
        assert_eq!(find("blocked"), None);
        assert_eq!(find("blocked/list"), None);
        assert_eq!(
            find("declared").as_deref(),
            Some("/p/node_modules/declared/types/foo.js")
        );
        assert_eq!(
            find("versions/sub").as_deref(),
            Some("/p/node_modules/versions/lib/sub.js")
        );
        assert_eq!(find("mjs"), None);
        assert_eq!(find("mjs/sub"), None);
        assert_eq!(find("types-js"), None);
        assert_eq!(
            find("main-js").as_deref(),
            Some("/p/node_modules/main-js/foo.js")
        );
        assert_eq!(
            find("data/d.json").as_deref(),
            Some("/p/node_modules/data/d.json")
        );
        // Only what has types is handed to those who ask for them.
        assert_eq!(
            resolver.resolve_as("exported/foo", "/p/src/a.cts", ResolutionMode::Require),
            None
        );
        assert_eq!(
            resolver.resolve_type_reference(
                "versions/sub",
                "/p/src",
                ResolutionMode::Require,
                false
            ),
            None
        );
        // To Node's `import` no extension is added.
        assert_eq!(
            resolver.resolve_module("./y", "/p/src/a.mts", ResolutionMode::Import),
            None
        );
        assert_eq!(
            resolver
                .resolve_module("./y.js", "/p/src/a.mts", ResolutionMode::Import)
                .as_deref(),
            Some("/p/src/y.js")
        );
    }

    #[test]
    fn resolved_using_ts_extension() {
        let host = Fake(&[
            (
                "/p/package.json",
                r##"{
                    "name": "pkg",
                    "type": "module",
                    "imports": {
                        "#foo.ts": "./src/internal/foo.ts",
                        "#internal/*": "./src/internal/*",
                        "#x/*.ts": "./src/internal/*.ts",
                        "#c/*": { "types": "./src/internal/*" },
                        "#d/*": "pkg/*"
                    },
                    "exports": { "./*": "./src/internal/*" }
                }"##,
            ),
            ("/p/src/a.ts", ""),
            ("/p/src/internal/foo.ts", ""),
        ]);
        let options = Options {
            paths: vec![
                ("@/*".to_owned(), vec!["./src/internal/*".to_owned()]),
                ("@y/*".to_owned(), vec!["./src/internal/*.ts".to_owned()]),
            ],
            ..like_node()
        };
        let resolver = Resolver::new(&host, &options);
        let flag = |spec: &str| {
            resolver
                .resolve_module_name(spec, "/p/src/a.ts", ResolutionMode::Import)
                .map(|resolved| resolved.1)
        };
        for spec in [
            "./internal/foo.ts",
            "#internal/foo.ts",
            "#c/foo.ts",
            "#d/foo.ts",
            "pkg/foo.ts",
            "@/foo.ts",
        ] {
            assert_eq!(flag(spec), Some(true), "{spec}");
        }
        for spec in ["./internal/foo.js", "#foo.ts", "#x/foo.ts", "@y/foo"] {
            assert_eq!(flag(spec), Some(false), "{spec}");
        }
    }

    #[test]
    fn declaration_files_only() {
        let host = Fake(&[
            ("/p/node_modules/impl/index.ts", ""),
            ("/p/node_modules/decl/index.d.ts", ""),
            ("/p/node_modules/@types/impl2/index.ts", ""),
            (
                "/p/node_modules/@types/named/package.json",
                r#"{ "types": "main" }"#,
            ),
            ("/p/node_modules/@types/named/main.ts", ""),
            (
                "/p/node_modules/versions/package.json",
                r#"{ "typesVersions": { "*": { "index": ["v7/index"] } } }"#,
            ),
            ("/p/node_modules/versions/sub/index.d.ts", ""),
            ("/p/node_modules/versions/sub/v7/index.d.ts", ""),
        ]);
        let options = like_node();
        let resolver = Resolver::new(&host, &options);
        let reference = |name: &str| {
            resolver.resolve_type_reference(name, "/p/src", ResolutionMode::Require, false)
        };
        assert_eq!(reference("impl"), None);
        assert_eq!(reference("impl2"), None);
        assert_eq!(
            reference("decl").as_deref(),
            Some("/p/node_modules/decl/index.d.ts")
        );
        // What `types` names may be a `.ts` file.
        assert_eq!(
            reference("named").as_deref(),
            Some("/p/node_modules/@types/named/main.ts")
        );
        let module =
            |spec: &str| resolver.resolve_module(spec, "/p/src/a.cts", ResolutionMode::Require);
        assert_eq!(
            module("impl").as_deref(),
            Some("/p/node_modules/impl/index.ts")
        );
        assert_eq!(module("impl2"), None);
        // The `typesVersions` of the package apply to the `index` of a directory inside it.
        assert_eq!(
            module("versions/sub").as_deref(),
            Some("/p/node_modules/versions/sub/v7/index.d.ts")
        );
    }

    #[test]
    fn root_dirs_and_module_suffixes() {
        let host = Fake(&[
            ("/p/src/a.ts", ""),
            ("/p/src/m.ts", ""),
            ("/p/src/m.ios.ts", ""),
            ("/p/src/only.ts", ""),
            ("/p/gen/g.ts", ""),
            ("/p/gen/sub/index.ts", ""),
            ("/p/gen/j.js", ""),
            (
                "/p/node_modules/named/package.json",
                r#"{ "types": "t.d.ts" }"#,
            ),
            ("/p/node_modules/named/t.d.ts", ""),
            ("/p/node_modules/named/t.ios.d.ts", ""),
        ]);
        let options = Options {
            root_dirs: vec!["/p/src".to_owned(), "/p/gen".to_owned()],
            module_suffixes: vec![".ios".to_owned(), String::new()],
            ..like_node()
        };
        let resolver = Resolver::new(&host, &options);
        let find =
            |spec: &str| resolver.resolve_module(spec, "/p/src/a.ts", ResolutionMode::Require);
        assert_eq!(find("./g").as_deref(), Some("/p/gen/g.ts"));
        assert_eq!(find("./sub").as_deref(), Some("/p/gen/sub/index.ts"));
        assert_eq!(find("./sub/").as_deref(), Some("/p/gen/sub/index.ts"));
        assert_eq!(find("./j").as_deref(), Some("/p/gen/j.js"));
        assert_eq!(find("./none"), None);
        assert_eq!(find("./m").as_deref(), Some("/p/src/m.ios.ts"));
        assert_eq!(find("./m.js").as_deref(), Some("/p/src/m.ios.ts"));
        assert_eq!(find("./only").as_deref(), Some("/p/src/only.ts"));
        assert_eq!(
            find("named").as_deref(),
            Some("/p/node_modules/named/t.ios.d.ts")
        );
    }
}
