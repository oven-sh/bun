// internal/core/compileroptions.go
use crate::collections::ordered_map::OrderedMap;
use crate::core::tristate::Tristate;
use crate::stringutil::util::strings;
use crate::tspath::extension::is_declaration_file_name;
use crate::tspath::path::{combine_paths, for_each_ancestor_directory, get_directory_path};
use std::sync::OnceLock;

// CompilerOptions contains the compiler options exposed by the API.
#[derive(Clone, Default, Debug)]
pub struct CompilerOptions {
    pub allow_js: Tristate,
    pub allow_arbitrary_extensions: Tristate,
    pub allow_importing_ts_extensions: Tristate,
    pub allow_non_ts_extensions: Tristate,
    pub allow_umd_global_access: Tristate,
    pub allow_unreachable_code: Tristate,
    pub allow_unused_labels: Tristate,
    pub assume_changes_only_affect_direct_dependencies: Tristate,
    pub check_js: Tristate,
    pub custom_conditions: Option<Vec<Vec<u8>>>,
    pub composite: Tristate,
    pub emit_declaration_only: Tristate,
    pub emit_bom: Tristate,
    pub emit_decorator_metadata: Tristate,
    pub declaration: Tristate,
    pub declaration_dir: Vec<u8>,
    pub declaration_map: Tristate,
    pub deduplicate_packages: Tristate,
    pub disable_size_limit: Tristate,
    pub disable_source_of_project_reference_redirect: Tristate,
    pub disable_solution_searching: Tristate,
    pub disable_referenced_project_load: Tristate,
    pub erasable_syntax_only: Tristate,
    pub exact_optional_property_types: Tristate,
    pub experimental_decorators: Tristate,
    pub force_consistent_casing_in_file_names: Tristate,
    pub isolated_modules: Tristate,
    pub isolated_declarations: Tristate,
    pub ignore_config: Tristate,
    pub ignore_deprecations: Vec<u8>,
    pub import_helpers: Tristate,
    pub inline_source_map: Tristate,
    pub inline_sources: Tristate,
    pub init: Tristate,
    pub incremental: Tristate,
    pub jsx: JsxEmit,
    pub jsx_factory: Vec<u8>,
    pub jsx_fragment_factory: Vec<u8>,
    pub jsx_import_source: Vec<u8>,
    pub lib: Option<Vec<Vec<u8>>>,
    pub lib_replacement: Tristate,
    pub locale: Vec<u8>,
    pub map_root: Vec<u8>,
    pub module: ModuleKind,
    pub module_resolution: ModuleResolutionKind,
    pub module_suffixes: Option<Vec<Vec<u8>>>,
    pub module_detection: ModuleDetectionKind,
    pub new_line: NewLineKind,
    pub no_emit: Tristate,
    pub no_check: Tristate,
    pub no_error_truncation: Tristate,
    pub no_fallthrough_cases_in_switch: Tristate,
    pub no_implicit_any: Tristate,
    pub no_implicit_this: Tristate,
    pub no_implicit_returns: Tristate,
    pub no_emit_helpers: Tristate,
    pub no_lib: Tristate,
    pub no_property_access_from_index_signature: Tristate,
    pub no_unchecked_indexed_access: Tristate,
    pub no_emit_on_error: Tristate,
    pub no_unused_locals: Tristate,
    pub no_unused_parameters: Tristate,
    pub no_resolve: Tristate,
    pub no_implicit_override: Tristate,
    pub no_unchecked_side_effect_imports: Tristate,
    pub out_dir: Vec<u8>,
    pub paths: Option<OrderedMap<Vec<u8>, Vec<Vec<u8>>>>,
    pub preserve_const_enums: Tristate,
    pub preserve_symlinks: Tristate,
    pub project: Vec<u8>,
    pub resolve_json_module: Tristate,
    pub resolve_package_json_exports: Tristate,
    pub resolve_package_json_imports: Tristate,
    pub remove_comments: Tristate,
    pub rewrite_relative_import_extensions: Tristate,
    pub react_namespace: Vec<u8>,
    pub root_dir: Vec<u8>,
    pub root_dirs: Option<Vec<Vec<u8>>>,
    pub skip_lib_check: Tristate,
    pub stable_type_ordering: Tristate,
    pub strict: Tristate,
    pub strict_bind_call_apply: Tristate,
    pub strict_builtin_iterator_return: Tristate,
    pub strict_function_types: Tristate,
    pub strict_null_checks: Tristate,
    pub strict_property_initialization: Tristate,
    pub strip_internal: Tristate,
    pub skip_default_lib_check: Tristate,
    pub source_map: Tristate,
    pub source_root: Vec<u8>,
    pub suppress_output_path_check: Tristate,
    pub target: ScriptTarget,
    pub trace_resolution: Tristate,
    pub ts_build_info_file: Vec<u8>,
    pub type_roots: Option<Vec<Vec<u8>>>,
    pub types: Option<Vec<Vec<u8>>>,
    pub use_define_for_class_fields: Tristate,
    pub use_unknown_in_catch_variables: Tristate,
    pub verbatim_module_syntax: Tristate,
    pub max_node_module_js_depth: Option<isize>,

    // Deprecated: Do not use outside of options parsing and validation.
    pub allow_synthetic_default_imports: Tristate,
    // Deprecated: Do not use outside of options parsing and validation.
    pub always_strict: Tristate,
    // Deprecated: Do not use outside of options parsing and validation.
    pub base_url: Vec<u8>,
    // Deprecated: Do not use outside of options parsing and validation.
    pub downlevel_iteration: Tristate,
    // Deprecated: Do not use outside of options parsing and validation.
    pub es_module_interop: Tristate,
    // Deprecated: Do not use outside of options parsing and validation.
    pub out_file: Vec<u8>,

    // Internal fields. configFilePath is internal, but intentionally exposed via API.
    pub config_file_path: Vec<u8>,
    pub no_dts_resolution: Tristate,
    pub paths_base_path: Vec<u8>,
    pub diagnostics: Tristate,
    pub extended_diagnostics: Tristate,
    pub generate_cpu_profile: Vec<u8>,
    pub generate_trace: Vec<u8>,
    pub list_emitted_files: Tristate,
    pub list_files: Tristate,
    pub explain_files: Tristate,
    pub list_files_only: Tristate,
    pub no_emit_for_js_files: Tristate,
    pub preserve_watch_output: Tristate,
    pub pretty: Tristate,
    pub version: Tristate,
    pub watch: Tristate,
    pub show_config: Tristate,
    pub build: Tristate,
    pub help: Tristate,
    pub all: Tristate,
    pub run_external_code: Tristate,

    pub pprof_dir: Vec<u8>,
    pub single_threaded: Tristate,
    pub quiet: Tristate,
    pub checkers: Option<isize>,
}

static EMPTY_COMPILER_OPTIONS: OnceLock<CompilerOptions> = OnceLock::new();

// `EmptyCompilerOptions` of upstream: one shared value with no option set.
pub fn empty_compiler_options() -> &'static CompilerOptions {
    EMPTY_COMPILER_OPTIONS.get_or_init(CompilerOptions::default)
}

impl CompilerOptions {
    pub fn get_emit_script_target(&self) -> ScriptTarget {
        if self.target != ScriptTarget::NONE {
            return self.target;
        }
        ScriptTarget::LATEST_STANDARD
    }

    pub fn get_emit_module_kind(&self) -> ModuleKind {
        if self.module != ModuleKind::NONE {
            return self.module;
        }

        let target = self.get_emit_script_target();
        if target == ScriptTarget::ES_NEXT {
            return ModuleKind::ES_NEXT;
        }
        if target >= ScriptTarget::ES2022 {
            return ModuleKind::ES2022;
        }
        if target >= ScriptTarget::ES2020 {
            return ModuleKind::ES2020;
        }
        if target >= ScriptTarget::ES2015 {
            return ModuleKind::ES2015;
        }
        ModuleKind::COMMON_JS
    }

    pub fn get_module_resolution_kind(&self) -> ModuleResolutionKind {
        match self.module_resolution {
            ModuleResolutionKind::UNKNOWN
            | ModuleResolutionKind::CLASSIC
            | ModuleResolutionKind::NODE10 => match self.get_emit_module_kind() {
                ModuleKind::NODE16 | ModuleKind::NODE18 | ModuleKind::NODE20 => {
                    ModuleResolutionKind::NODE16
                }
                ModuleKind::NODE_NEXT => ModuleResolutionKind::NODE_NEXT,
                _ => ModuleResolutionKind::BUNDLER,
            },
            _ => self.module_resolution,
        }
    }

    pub fn get_emit_module_detection_kind(&self) -> ModuleDetectionKind {
        if self.module_detection != ModuleDetectionKind::NONE {
            return self.module_detection;
        }
        let module_kind = self.get_emit_module_kind();
        if ModuleKind::NODE16 <= module_kind && module_kind <= ModuleKind::NODE_NEXT {
            return ModuleDetectionKind::FORCE;
        }
        ModuleDetectionKind::AUTO
    }

    pub fn get_resolve_package_json_exports(&self) -> bool {
        self.resolve_package_json_exports.is_true_or_unknown()
    }

    pub fn get_resolve_package_json_imports(&self) -> bool {
        self.resolve_package_json_imports.is_true_or_unknown()
    }

    pub fn get_allow_importing_ts_extensions(&self) -> bool {
        self.allow_importing_ts_extensions.is_true()
            || self.rewrite_relative_import_extensions.is_true()
    }

    pub fn allow_importing_ts_extensions_from(&self, file_name: &[u8]) -> bool {
        self.get_allow_importing_ts_extensions() || is_declaration_file_name(file_name)
    }

    pub fn get_resolve_json_module(&self) -> bool {
        if self.resolve_json_module != Tristate::UNKNOWN {
            return self.resolve_json_module == Tristate::TRUE;
        }
        if matches!(
            self.get_emit_module_kind(),
            ModuleKind::NODE20 | ModuleKind::NODE_NEXT
        ) {
            return true;
        }
        self.get_module_resolution_kind() == ModuleResolutionKind::BUNDLER
    }

    pub fn should_preserve_const_enums(&self) -> bool {
        self.preserve_const_enums == Tristate::TRUE || self.get_isolated_modules()
    }

    pub fn get_allow_js(&self) -> bool {
        if self.allow_js != Tristate::UNKNOWN {
            return self.allow_js == Tristate::TRUE;
        }
        self.check_js == Tristate::TRUE
    }

    pub fn get_jsx_transform_enabled(&self) -> bool {
        let jsx = self.jsx;
        jsx == JsxEmit::REACT || jsx == JsxEmit::REACT_JSX || jsx == JsxEmit::REACT_JSX_DEV
    }

    pub fn get_strict_option_value(&self, value: Tristate) -> bool {
        if value != Tristate::UNKNOWN {
            return value == Tristate::TRUE;
        }
        self.strict != Tristate::FALSE
    }

    // The type roots and whether they come from the configuration. Err is upstream's panic with its message.
    pub fn get_effective_type_roots(
        &self,
        current_directory: &[u8],
    ) -> Result<(Vec<Vec<u8>>, bool), &'static str> {
        if let Some(type_roots) = &self.type_roots {
            return Ok((type_roots.clone(), true));
        }
        let base_dir = if !self.config_file_path.is_empty() {
            get_directory_path(&self.config_file_path)
        } else {
            if current_directory.is_empty() {
                // This was accounted for in the TS codebase, but only for third-party API usage where the module resolution host does not provide a getCurrentDirectory().
                return Err(
                    "cannot get effective type roots without a config file path or current directory",
                );
            }
            current_directory.to_vec()
        };

        let capacity = usize::try_from(strings::count(&base_dir, b"/")).unwrap_or(0);
        let mut type_roots: Vec<Vec<u8>> = Vec::with_capacity(capacity);
        for_each_ancestor_directory(&base_dir, |dir| {
            type_roots.push(combine_paths(dir, &[b"node_modules", b"@types"]));
            None::<()>
        });
        Ok((type_roots, false))
    }

    // UsesWildcardTypes returns true if this option's types array includes "*"
    pub fn uses_wildcard_types(&self) -> bool {
        self.types
            .as_ref()
            .is_some_and(|types| types.iter().any(|name| name == b"*"))
    }

    pub fn get_isolated_modules(&self) -> bool {
        self.isolated_modules == Tristate::TRUE || self.verbatim_module_syntax == Tristate::TRUE
    }

    pub fn is_incremental(&self) -> bool {
        self.incremental.is_true() || self.composite.is_true()
    }

    pub fn get_emit_standard_class_fields(&self) -> bool {
        self.use_define_for_class_fields != Tristate::FALSE
            && self.get_emit_script_target() >= ScriptTarget::ES2022
    }

    pub fn get_use_define_for_class_fields(&self) -> bool {
        if self.use_define_for_class_fields == Tristate::UNKNOWN {
            return self.get_emit_script_target() >= ScriptTarget::ES2022;
        }
        self.use_define_for_class_fields == Tristate::TRUE
    }

    pub fn get_emit_declarations(&self) -> bool {
        self.declaration.is_true() || self.composite.is_true()
    }

    pub fn get_are_declaration_maps_enabled(&self) -> bool {
        self.declaration_map == Tristate::TRUE && self.get_emit_declarations()
    }

    pub fn has_json_module_emit_enabled(&self) -> bool {
        !matches!(
            self.get_emit_module_kind(),
            ModuleKind::SYSTEM | ModuleKind::UMD
        )
    }

    pub fn get_paths_base_path<'a>(&'a self, current_directory: &'a [u8]) -> &'a [u8] {
        if self.paths.as_ref().is_none_or(|paths| paths.size() == 0) {
            return b"";
        }
        if !self.paths_base_path.is_empty() {
            return &self.paths_base_path;
        }
        current_directory
    }
}

#[repr(transparent)]
#[derive(Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, Default, Debug)]
pub struct ModuleDetectionKind(pub i32);

impl ModuleDetectionKind {
    pub const NONE: ModuleDetectionKind = ModuleDetectionKind(0);
    pub const AUTO: ModuleDetectionKind = ModuleDetectionKind(1);
    pub const LEGACY: ModuleDetectionKind = ModuleDetectionKind(2);
    pub const FORCE: ModuleDetectionKind = ModuleDetectionKind(3);
}

#[repr(transparent)]
#[derive(Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, Default, Debug)]
pub struct ModuleKind(pub i32);

impl ModuleKind {
    pub const NONE: ModuleKind = ModuleKind(0);
    pub const COMMON_JS: ModuleKind = ModuleKind(1);
    // Deprecated: Do not use outside of options parsing and validation.
    pub const AMD: ModuleKind = ModuleKind(2);
    // Deprecated: Do not use outside of options parsing and validation.
    pub const UMD: ModuleKind = ModuleKind(3);
    // Deprecated: Do not use outside of options parsing and validation.
    pub const SYSTEM: ModuleKind = ModuleKind(4);
    // NOTE: ES module kinds should be contiguous to more easily check whether a module kind is *any* ES module kind. Non-ES module kinds should not come between ES2015 (the earliest ES module kind) and ESNext (the last ES module kind).
    pub const ES2015: ModuleKind = ModuleKind(5);
    pub const ES2020: ModuleKind = ModuleKind(6);
    pub const ES2022: ModuleKind = ModuleKind(7);
    pub const ES_NEXT: ModuleKind = ModuleKind(99);
    // Node16+ is an amalgam of commonjs (albeit updated) and es2022+, and represents a distinct module system from es2020/esnext
    pub const NODE16: ModuleKind = ModuleKind(100);
    pub const NODE18: ModuleKind = ModuleKind(101);
    pub const NODE20: ModuleKind = ModuleKind(102);
    pub const NODE_NEXT: ModuleKind = ModuleKind(199);
    // Emit as written
    pub const PRESERVE: ModuleKind = ModuleKind(200);

    pub fn is_non_node_esm(self) -> bool {
        self >= ModuleKind::ES2015 && self <= ModuleKind::ES_NEXT
    }

    pub fn supports_import_attributes(self) -> bool {
        ModuleKind::NODE18 <= self && self <= ModuleKind::NODE_NEXT
            || self == ModuleKind::PRESERVE
            || self == ModuleKind::ES_NEXT
    }
}

// ModuleKindNone | ModuleKindCommonJS | ModuleKindESNext
pub type ResolutionMode = ModuleKind;

pub const RESOLUTION_MODE_NONE: ResolutionMode = ModuleKind::NONE;
pub const RESOLUTION_MODE_COMMON_JS: ResolutionMode = ModuleKind::COMMON_JS;
pub const RESOLUTION_MODE_ESM: ResolutionMode = ModuleKind::ES_NEXT;

#[repr(transparent)]
#[derive(Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, Default, Debug)]
pub struct ModuleResolutionKind(pub i32);

impl ModuleResolutionKind {
    pub const UNKNOWN: ModuleResolutionKind = ModuleResolutionKind(0);
    // Deprecated: Do not use outside of options parsing and validation.
    pub const CLASSIC: ModuleResolutionKind = ModuleResolutionKind(1);
    // Deprecated: Do not use outside of options parsing and validation.
    pub const NODE10: ModuleResolutionKind = ModuleResolutionKind(2);
    // Starting with node16, node's module resolver has significant departures from traditional cjs resolution to better support ECMAScript modules and their use within node. We offer both a `NodeNext` moving resolution target, and a `Node16` version-anchored resolution target.
    pub const NODE16: ModuleResolutionKind = ModuleResolutionKind(3);
    // Not simply `Node16` so that compiled code linked against TS can use the `Next` value reliably (same as with `ModuleKind`)
    pub const NODE_NEXT: ModuleResolutionKind = ModuleResolutionKind(99);
    pub const BUNDLER: ModuleResolutionKind = ModuleResolutionKind(100);
}

// `ModuleKindToModuleResolutionKind[kind]` of upstream: None when the map has no entry.
pub fn module_kind_to_module_resolution_kind(kind: ModuleKind) -> Option<ModuleResolutionKind> {
    match kind {
        ModuleKind::NODE16 => Some(ModuleResolutionKind::NODE16),
        ModuleKind::NODE_NEXT => Some(ModuleResolutionKind::NODE_NEXT),
        _ => None,
    }
}

impl ModuleResolutionKind {
    // These values are user-facing in --traceResolution. Since there's no TS equivalent of `ModuleResolutionKindUnknown`, upstream panics on that case: Err is that panic with its message.
    pub fn string(self) -> Result<&'static [u8], &'static str> {
        match self {
            ModuleResolutionKind::UNKNOWN => {
                Err("should not use zero value of ModuleResolutionKind")
            }
            ModuleResolutionKind::CLASSIC => Ok(b"Classic"),
            ModuleResolutionKind::NODE10 => Ok(b"Node10"),
            ModuleResolutionKind::NODE16 => Ok(b"Node16"),
            ModuleResolutionKind::NODE_NEXT => Ok(b"NodeNext"),
            ModuleResolutionKind::BUNDLER => Ok(b"Bundler"),
            _ => Err("unhandled case in ModuleResolutionKind.String"),
        }
    }
}

#[repr(transparent)]
#[derive(Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, Default, Debug)]
pub struct NewLineKind(pub i32);

impl NewLineKind {
    pub const NONE: NewLineKind = NewLineKind(0);
    pub const CRLF: NewLineKind = NewLineKind(1);
    pub const LF: NewLineKind = NewLineKind(2);
}

pub fn get_new_line_kind(s: &[u8]) -> NewLineKind {
    match s {
        b"\r\n" => NewLineKind::CRLF,
        b"\n" => NewLineKind::LF,
        _ => NewLineKind::NONE,
    }
}

impl NewLineKind {
    pub fn get_new_line_character(self) -> &'static [u8] {
        match self {
            NewLineKind::CRLF => b"\r\n",
            _ => b"\n",
        }
    }
}

#[repr(transparent)]
#[derive(Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, Default, Debug)]
pub struct ScriptTarget(pub i32);

impl ScriptTarget {
    pub const NONE: ScriptTarget = ScriptTarget(0);
    // Deprecated: Do not use outside of options parsing and validation.
    pub const ES5: ScriptTarget = ScriptTarget(1);
    pub const ES2015: ScriptTarget = ScriptTarget(2);
    pub const ES2016: ScriptTarget = ScriptTarget(3);
    pub const ES2017: ScriptTarget = ScriptTarget(4);
    pub const ES2018: ScriptTarget = ScriptTarget(5);
    pub const ES2019: ScriptTarget = ScriptTarget(6);
    pub const ES2020: ScriptTarget = ScriptTarget(7);
    pub const ES2021: ScriptTarget = ScriptTarget(8);
    pub const ES2022: ScriptTarget = ScriptTarget(9);
    pub const ES2023: ScriptTarget = ScriptTarget(10);
    pub const ES2024: ScriptTarget = ScriptTarget(11);
    pub const ES2025: ScriptTarget = ScriptTarget(12);
    pub const ES_NEXT: ScriptTarget = ScriptTarget(99);
    pub const JSON: ScriptTarget = ScriptTarget(100);
    pub const LATEST: ScriptTarget = ScriptTarget::ES_NEXT;
    pub const LATEST_STANDARD: ScriptTarget = ScriptTarget::ES2025;
}

#[repr(transparent)]
#[derive(Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, Default, Debug)]
pub struct JsxEmit(pub i32);

impl JsxEmit {
    pub const NONE: JsxEmit = JsxEmit(0);
    pub const PRESERVE: JsxEmit = JsxEmit(1);
    pub const REACT_NATIVE: JsxEmit = JsxEmit(2);
    pub const REACT: JsxEmit = JsxEmit(3);
    pub const REACT_JSX: JsxEmit = JsxEmit(4);
    pub const REACT_JSX_DEV: JsxEmit = JsxEmit(5);

    // Err is upstream's panic with its message.
    pub fn string(self) -> Result<&'static [u8], &'static str> {
        match self {
            JsxEmit::NONE => Err("should not use zero value of JsxEmit"),
            JsxEmit::PRESERVE => Ok(b"preserve"),
            JsxEmit::REACT_NATIVE => Ok(b"react-native"),
            JsxEmit::REACT => Ok(b"react"),
            JsxEmit::REACT_JSX => Ok(b"react-jsx"),
            JsxEmit::REACT_JSX_DEV => Ok(b"react-jsxdev"),
            _ => Err("unhandled case in JsxEmit.String"),
        }
    }
}
