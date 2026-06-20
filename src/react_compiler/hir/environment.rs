use std::collections::HashMap;
use std::collections::HashSet;

use crate::diagnostics::CompilerDiagnostic;
use crate::diagnostics::CompilerError;
use crate::diagnostics::CompilerErrorDetail;
use crate::diagnostics::ErrorCategory;

use crate::hir::default_module_type_provider::default_module_type_provider;
use crate::hir::environment_config::EnvironmentConfig;
use crate::hir::globals::Global;
use crate::hir::globals::GlobalRegistry;
use crate::hir::globals::{self};
use crate::hir::object_shape::BUILT_IN_MIXED_READONLY_ID;
use crate::hir::object_shape::FunctionSignature;
use crate::hir::object_shape::HookKind;
use crate::hir::object_shape::HookSignatureBuilder;
use crate::hir::object_shape::ShapeRegistry;
use crate::hir::object_shape::add_hook;
use crate::hir::object_shape::default_mutating_hook;
use crate::hir::object_shape::default_nonmutating_hook;
use crate::hir::*;

/// A variable rename from lowering: the binding at `declaration_start` position
/// was renamed from `original` to `renamed`.
#[derive(Debug, Clone, Copy)]
pub struct BindingRename {
    pub original: StoreStr,
    pub renamed: StoreStr,
    pub declaration_start: u32,
}

/// Output mode for the compiler, mirrored from the entrypoint's CompilerOutputMode.
/// Stored on Environment so pipeline passes can access it.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum OutputMode {
    Ssr,
    Client,
    Lint,
}

pub struct Environment {
    // Counters
    pub next_block_id_counter: u32,
    pub next_scope_id_counter: u32,
    next_mutable_range_id_counter: u32,

    // Arenas (use direct field access for sliced borrows)
    pub identifiers: HirVec<Identifier>,
    pub types: HirVec<Type>,
    pub scopes: HirVec<ReactiveScope>,
    pub functions: HirVec<HirFunction>,

    // Error accumulation
    pub errors: CompilerError,

    // Function type classification (Component, Hook, Other)
    pub fn_type: ReactFunctionType,

    // Output mode (Client, Ssr, Lint)
    pub output_mode: OutputMode,

    // Source file code (for fast refresh hash computation)
    pub code: Option<StoreStr>,

    // Source file name (for instrumentation)
    pub filename: Option<StoreStr>,

    // Pre-resolved import local names for instrumentation/hook guards.
    // Set by the program-level code before compilation.
    pub instrument_fn_name: Option<StoreStr>,
    pub instrument_gating_name: Option<StoreStr>,
    pub hook_guard_name: Option<StoreStr>,

    // Renames: tracks variable renames from lowering (original_name → new_name)
    // keyed by binding declaration position, for applying back to the Babel AST.
    pub renames: HirVec<BindingRename>,

    // Node IDs of identifiers that are actual references to bindings.
    // Used by codegen to filter type annotation renames — only rename identifiers
    // whose node_id is in this set (type labels like ObjectTypeIndexer params
    // are NOT in this set and should keep their original names).
    pub reference_node_ids: HashSet<u32>,

    // Hoisted identifiers: tracks which bindings have already been hoisted
    // via DeclareContext to avoid duplicate hoisting.
    // Uses u32 to avoid depending on react_compiler_ast types.
    hoisted_identifiers: HashSet<u32>,

    // Config flags for validation passes (kept for backwards compat with existing pipeline code)
    pub validate_preserve_existing_memoization_guarantees: bool,
    pub validate_no_set_state_in_render: bool,
    pub enable_preserve_existing_memoization_guarantees: bool,

    // Type system registries
    globals: GlobalRegistry,
    pub shapes: ShapeRegistry,
    module_types: HashMap<StoreStr, Option<Global>>,
    module_type_errors: HashMap<StoreStr, Vec<String>>,

    // Environment configuration (feature flags, custom hooks, etc.)
    pub config: EnvironmentConfig,

    // Cached default hook types (lazily initialized)
    default_nonmutating_hook: Option<Global>,
    default_mutating_hook: Option<Global>,

    // Outlined functions: functions extracted from the component during outlining passes
    outlined_functions: HirVec<OutlinedFunctionEntry>,

    // Known names for collision-aware UID generation. Lazily populated from
    // identifiers on first use, then updated with each generated name.
    // Matches Babel's generateUid behavior of checking hasBinding/hasReference.
    uid_known_names: Option<HashSet<StoreStr>>,
}

/// An outlined function entry, stored on Environment during compilation.
/// Corresponds to TS `{ fn: HIRFunction, type: ReactFunctionType | null }`.
#[derive(Debug, Clone)]
pub struct OutlinedFunctionEntry {
    pub func: HirFunction,
    pub fn_type: Option<ReactFunctionType>,
}

impl Environment {
    pub fn new() -> Self {
        Self::with_config(EnvironmentConfig::default())
    }

    /// Create a new Environment with the given configuration.
    ///
    /// Initializes the shape and global registries, registers custom hooks,
    /// and sets up the module type cache.
    pub fn with_config(config: EnvironmentConfig) -> Self {
        let mut shapes = ShapeRegistry::with_base(globals::base_shapes());
        let mut global_registry = GlobalRegistry::with_base();

        // Register custom hooks from config
        for (hook_name, hook) in &config.custom_hooks {
            // Don't overwrite existing globals (matches TS invariant)
            if global_registry.contains_key(hook_name) {
                continue;
            }
            let return_type = if hook.transitive_mixed_data {
                Type::Object {
                    shape_id: Some(BUILT_IN_MIXED_READONLY_ID),
                }
            } else {
                Type::Poly
            };
            let hook_type = add_hook(
                &mut shapes,
                HookSignatureBuilder {
                    rest_param: Some(hook.effect_kind),
                    return_type,
                    return_value_kind: hook.value_kind,
                    hook_kind: HookKind::Custom,
                    no_alias: hook.no_alias,
                    ..Default::default()
                },
                None,
            );
            global_registry.insert(hook_name.clone(), hook_type);
        }

        // Register reanimated module type when enabled
        let mut module_types: HashMap<StoreStr, Option<Global>> = HashMap::new();
        if config.enable_custom_type_definition_for_reanimated {
            let reanimated_module_type = globals::get_reanimated_module_type(&mut shapes);
            module_types.insert(
                StoreStr::new(b"react-native-reanimated"),
                Some(reanimated_module_type),
            );
        }

        Self {
            next_block_id_counter: 0,
            next_scope_id_counter: 0,
            next_mutable_range_id_counter: 0,
            identifiers: AstAlloc::vec(),
            types: AstAlloc::vec(),
            scopes: AstAlloc::vec(),
            functions: AstAlloc::vec(),
            errors: CompilerError::new(),
            fn_type: ReactFunctionType::Other,
            output_mode: OutputMode::Client,
            code: None,
            filename: None,
            instrument_fn_name: None,
            instrument_gating_name: None,
            hook_guard_name: None,
            renames: AstAlloc::vec(),
            reference_node_ids: HashSet::new(),
            hoisted_identifiers: HashSet::new(),
            validate_preserve_existing_memoization_guarantees: config
                .validate_preserve_existing_memoization_guarantees,
            validate_no_set_state_in_render: config.validate_no_set_state_in_render,
            enable_preserve_existing_memoization_guarantees: config
                .enable_preserve_existing_memoization_guarantees,
            globals: global_registry,
            shapes,
            module_types,
            module_type_errors: HashMap::new(),
            default_nonmutating_hook: None,
            default_mutating_hook: None,
            outlined_functions: AstAlloc::vec(),
            uid_known_names: None,
            config,
        }
    }

    /// Create a child Environment for compiling an outlined function.
    ///
    /// The child shares the same config, globals, and shapes, and receives copies of
    /// all arenas (identifiers, types, scopes, functions) so that references from
    /// the outlined HIR remain valid. Block/scope counters start past the cloned
    /// data to avoid ID conflicts.
    pub fn for_outlined_fn(&self, fn_type: ReactFunctionType) -> Self {
        Self {
            // Start block counter past any existing blocks in the outlined function.
            // The outlined function has BlockId(0), parent may have more. Use parent's
            // counter which is guaranteed to be > any block ID in the outlined function.
            next_block_id_counter: self.next_block_id_counter,
            // Scope counter must be consistent with scopes vec length
            next_scope_id_counter: self.scopes.len() as u32,
            next_mutable_range_id_counter: self.next_mutable_range_id_counter,
            identifiers: self.identifiers.clone(),
            types: self.types.clone(),
            scopes: self.scopes.clone(),
            functions: self.functions.clone(),
            errors: CompilerError::new(),
            fn_type,
            output_mode: self.output_mode,
            code: self.code,
            filename: self.filename,
            instrument_fn_name: self.instrument_fn_name,
            instrument_gating_name: self.instrument_gating_name,
            hook_guard_name: self.hook_guard_name,
            renames: AstAlloc::vec(),
            reference_node_ids: HashSet::new(),
            hoisted_identifiers: HashSet::new(),
            validate_preserve_existing_memoization_guarantees: self
                .validate_preserve_existing_memoization_guarantees,
            validate_no_set_state_in_render: self.validate_no_set_state_in_render,
            enable_preserve_existing_memoization_guarantees: self
                .enable_preserve_existing_memoization_guarantees,
            globals: self.globals.clone(),
            shapes: self.shapes.clone(),
            module_types: self.module_types.clone(),
            module_type_errors: self.module_type_errors.clone(),
            config: self.config.clone(),
            default_nonmutating_hook: self.default_nonmutating_hook.clone(),
            default_mutating_hook: self.default_mutating_hook.clone(),
            outlined_functions: AstAlloc::vec(),
            uid_known_names: self.uid_known_names.clone(),
        }
    }

    pub fn next_block_id(&mut self) -> BlockId {
        let id = BlockId(self.next_block_id_counter);
        self.next_block_id_counter += 1;
        id
    }

    /// Create a new MutableRange with a unique ID.
    /// Use this when creating a logically new range (not copying an existing one).
    /// To copy a range preserving its identity, use `.clone()` instead.
    pub fn new_mutable_range(
        &mut self,
        start: EvaluationOrder,
        end: EvaluationOrder,
    ) -> MutableRange {
        let id = MutableRangeId(self.next_mutable_range_id_counter);
        self.next_mutable_range_id_counter += 1;
        MutableRange { id, start, end }
    }

    /// Allocate a new Identifier in the arena with default values,
    /// returns its IdentifierId.
    pub fn next_identifier_id(&mut self) -> IdentifierId {
        let id = IdentifierId(self.identifiers.len() as u32);
        let type_id = self.make_type();
        let mutable_range = self.new_mutable_range(EvaluationOrder(0), EvaluationOrder(0));
        self.identifiers.push(Identifier {
            id,
            declaration_id: DeclarationId(id.0),
            name: None,
            mutable_range,
            scope: None,
            type_: type_id,
            loc: None,
        });
        id
    }

    /// Allocate a new ReactiveScope in the arena, returns its ScopeId.
    pub fn next_scope_id(&mut self) -> ScopeId {
        let id = ScopeId(self.next_scope_id_counter);
        self.next_scope_id_counter += 1;
        let range = self.new_mutable_range(EvaluationOrder(0), EvaluationOrder(0));
        self.scopes.push(ReactiveScope {
            id,
            range,
            dependencies: AstAlloc::vec(),
            declarations: AstAlloc::vec(),
            reassignments: AstAlloc::vec(),
            early_return_value: None,
            merged: AstAlloc::vec(),
            loc: None,
        });
        id
    }

    /// Allocate a new Type in the arena, returns its TypeId.
    pub fn next_type_id(&mut self) -> TypeId {
        let id = TypeId(self.types.len() as u32);
        self.types.push(Type::TypeVar { id });
        id
    }

    /// Allocate a new Type (TypeVar) in the arena, returns its TypeId.
    pub fn make_type(&mut self) -> TypeId {
        self.next_type_id()
    }

    pub fn add_function(&mut self, func: HirFunction) -> FunctionId {
        let id = FunctionId(self.functions.len() as u32);
        self.functions.push(func);
        id
    }

    pub fn record_error(&mut self, detail: CompilerErrorDetail) -> Result<(), CompilerError> {
        if detail.category == ErrorCategory::Invariant {
            let detail_clone = detail.clone();
            self.errors.push_error_detail(detail);
            let mut err = CompilerError::new();
            err.push_error_detail(detail_clone);
            return Err(err);
        }
        self.errors.push_error_detail(detail);
        Ok(())
    }

    pub fn record_diagnostic(&mut self, diagnostic: CompilerDiagnostic) {
        self.errors.push_diagnostic(diagnostic);
    }

    pub fn has_errors(&self) -> bool {
        self.errors.has_any_errors()
    }

    pub fn error_count(&self) -> usize {
        self.errors.details.len()
    }

    /// Check if any recorded errors have Invariant category.
    /// In TS, Invariant errors throw immediately from recordError(),
    /// which aborts the current operation.
    pub fn has_invariant_errors(&self) -> bool {
        self.errors.has_invariant_errors()
    }

    pub fn errors(&self) -> &CompilerError {
        &self.errors
    }

    pub fn take_errors(&mut self) -> CompilerError {
        let mut errors = std::mem::take(&mut self.errors);
        // Mark as not thrown — these are accumulated errors returned at the end
        // of the pipeline, not errors thrown by a pass.
        errors.is_thrown = false;
        errors
    }

    /// Take errors added after position `since_count`, leaving earlier errors in place.
    /// Used to detect new errors added by a specific pass.
    pub fn take_errors_since(&mut self, since_count: usize) -> CompilerError {
        let mut taken = CompilerError::new();
        if self.errors.details.len() > since_count {
            taken.details = self.errors.details.split_off(since_count);
        }
        taken
    }

    /// Take only the Invariant errors, leaving non-Invariant errors in place.
    /// In TS, Invariant errors throw as a separate CompilerError, so only
    /// the Invariant error is surfaced.
    pub fn take_invariant_errors(&mut self) -> CompilerError {
        let mut invariant = CompilerError::new();
        let mut remaining = CompilerError::new();
        let old = std::mem::take(&mut self.errors);
        for detail in old.details {
            let is_invariant = match &detail {
                crate::diagnostics::CompilerErrorOrDiagnostic::Diagnostic(d) => {
                    d.category == crate::diagnostics::ErrorCategory::Invariant
                }
                crate::diagnostics::CompilerErrorOrDiagnostic::ErrorDetail(d) => {
                    d.category == crate::diagnostics::ErrorCategory::Invariant
                }
            };
            if is_invariant {
                invariant.details.push(detail);
            } else {
                remaining.details.push(detail);
            }
        }
        self.errors = remaining;
        invariant
    }

    /// Check if any recorded errors have Todo category.
    /// In TS, Todo errors throw immediately via CompilerError.throwTodo().
    pub fn has_todo_errors(&self) -> bool {
        self.errors.details.iter().any(|d| match d {
            crate::diagnostics::CompilerErrorOrDiagnostic::Diagnostic(d) => {
                d.category == crate::diagnostics::ErrorCategory::Todo
            }
            crate::diagnostics::CompilerErrorOrDiagnostic::ErrorDetail(d) => {
                d.category == crate::diagnostics::ErrorCategory::Todo
            }
        })
    }

    /// Take errors that would have been thrown in TS (Invariant and Todo),
    /// leaving other accumulated errors in place.
    pub fn take_thrown_errors(&mut self) -> CompilerError {
        let mut thrown = CompilerError::new();
        let mut remaining = CompilerError::new();
        let old = std::mem::take(&mut self.errors);
        for detail in old.details {
            let is_thrown = match &detail {
                crate::diagnostics::CompilerErrorOrDiagnostic::Diagnostic(d) => {
                    d.category == crate::diagnostics::ErrorCategory::Invariant
                        || d.category == crate::diagnostics::ErrorCategory::Todo
                }
                crate::diagnostics::CompilerErrorOrDiagnostic::ErrorDetail(d) => {
                    d.category == crate::diagnostics::ErrorCategory::Invariant
                        || d.category == crate::diagnostics::ErrorCategory::Todo
                }
            };
            if is_thrown {
                thrown.details.push(detail);
            } else {
                remaining.details.push(detail);
            }
        }
        self.errors = remaining;
        thrown
    }

    /// Check if a binding has been hoisted (via DeclareContext) already.
    pub fn is_hoisted_identifier(&self, binding_id: u32) -> bool {
        self.hoisted_identifiers.contains(&binding_id)
    }

    /// Mark a binding as hoisted.
    pub fn add_hoisted_identifier(&mut self, binding_id: u32) {
        self.hoisted_identifiers.insert(binding_id);
    }

    // =========================================================================
    // Type resolution methods (ported from Environment.ts)
    // =========================================================================

    /// Resolve a non-local binding to its type. Ported from TS `getGlobalDeclaration`.
    ///
    /// The `loc` parameter is used for error diagnostics when validating module type
    /// configurations. Pass `None` if no source location is available.
    pub fn get_global_declaration(
        &mut self,
        binding: &NonLocalBinding,
        loc: Option<SourceLocation>,
    ) -> Result<Option<Global>, CompilerError> {
        match &binding.kind {
            NonLocalKind::BunOpaque(_) => Ok(None),
            NonLocalKind::ModuleLocal { name, .. } => {
                if is_hook_name(name) {
                    Ok(Some(self.get_custom_hook_type()))
                } else {
                    Ok(None)
                }
            }
            NonLocalKind::Global { name, .. } => {
                if let Some(ty) = core::str::from_utf8(name)
                    .ok()
                    .and_then(|s| self.globals.get(s))
                {
                    return Ok(Some(ty.clone()));
                }
                if is_hook_name(name) {
                    Ok(Some(self.get_custom_hook_type()))
                } else {
                    Ok(None)
                }
            }
            NonLocalKind::ImportSpecifier {
                name,
                module,
                imported,
            } => {
                if self.is_known_react_module(module) {
                    if let Some(ty) = core::str::from_utf8(imported)
                        .ok()
                        .and_then(|s| self.globals.get(s))
                    {
                        return Ok(Some(ty.clone()));
                    }
                    if is_hook_name(imported) || is_hook_name(name) {
                        return Ok(Some(self.get_custom_hook_type()));
                    }
                    return Ok(None);
                }

                // Try module type provider. We resolve first, then do property
                // lookup on the cloned result to avoid double-borrow of self.
                let module_type = self.resolve_module_type(*module);

                // Check for module type validation errors (hook-name vs hook-type mismatches)
                if let Some(errors) = self.module_type_errors.remove(module) {
                    if let Some(first_error) = errors.into_iter().next() {
                        self.record_error(
                            CompilerErrorDetail::new(
                                ErrorCategory::Config,
                                "Invalid type configuration for module",
                            )
                            .with_description(first_error)
                            .with_loc(loc),
                        )?;
                    }
                }

                if let Some(module_type) = module_type {
                    if let Some(imported_type) =
                        Self::get_property_type_from_shapes(&self.shapes, &module_type, imported)
                    {
                        return Ok(Some(imported_type));
                    }
                }

                if is_hook_name(imported) || is_hook_name(name) {
                    Ok(Some(self.get_custom_hook_type()))
                } else {
                    Ok(None)
                }
            }
            NonLocalKind::ImportDefault { name, module }
            | NonLocalKind::ImportNamespace { name, module } => {
                let is_default = matches!(binding.kind, NonLocalKind::ImportDefault { .. });

                if self.is_known_react_module(module) {
                    if let Some(ty) = core::str::from_utf8(name)
                        .ok()
                        .and_then(|s| self.globals.get(s))
                    {
                        return Ok(Some(ty.clone()));
                    }
                    if is_hook_name(name) {
                        return Ok(Some(self.get_custom_hook_type()));
                    }
                    return Ok(None);
                }

                let module_type = self.resolve_module_type(*module);

                // Check for module type validation errors (hook-name vs hook-type mismatches)
                if let Some(errors) = self.module_type_errors.remove(module) {
                    if let Some(first_error) = errors.into_iter().next() {
                        self.record_error(
                            CompilerErrorDetail::new(
                                ErrorCategory::Config,
                                "Invalid type configuration for module",
                            )
                            .with_description(first_error)
                            .with_loc(loc),
                        )?;
                    }
                }

                if let Some(module_type) = module_type {
                    let imported_type = if is_default {
                        Self::get_property_type_from_shapes(&self.shapes, &module_type, b"default")
                    } else {
                        Some(module_type)
                    };
                    if let Some(imported_type) = imported_type {
                        // Validate hook-name vs hook-type consistency for module name
                        let expect_hook = is_hook_name(module);
                        let is_hook = self
                            .get_hook_kind_for_type(&imported_type)
                            .ok()
                            .flatten()
                            .is_some();
                        if expect_hook != is_hook {
                            self.record_error(
                                CompilerErrorDetail::new(
                                    ErrorCategory::Config,
                                    "Invalid type configuration for module",
                                )
                                .with_description(format!(
                                    "Expected type for `import ... from '{}'` {} based on the module name",
                                    bun_core::BStr::new(module.slice()),
                                    if expect_hook { "to be a hook" } else { "not to be a hook" }
                                ))
                                .with_loc(loc),
                            )?;
                        }
                        return Ok(Some(imported_type));
                    }
                }

                if is_hook_name(name) {
                    Ok(Some(self.get_custom_hook_type()))
                } else {
                    Ok(None)
                }
            }
        }
    }

    /// Static helper: resolve a property type using only the shapes registry.
    /// Used internally to avoid double-borrow of `self`. Includes hook-name
    /// fallback matching TS `getPropertyType`.
    fn get_property_type_from_shapes(
        shapes: &ShapeRegistry,
        receiver: &Type,
        property: &[u8],
    ) -> Option<Type> {
        let shape_id = match receiver {
            Type::Object { shape_id } | Type::Function { shape_id, .. } => shape_id.as_deref(),
            _ => None,
        };
        if let Some(shape_id) = shape_id {
            let shape = shapes.get(shape_id)?;
            if let Some(ty) = core::str::from_utf8(property)
                .ok()
                .and_then(|k| shape.properties.get(k))
            {
                return Some(ty.clone());
            }
            if let Some(ty) = shape.properties.get("*") {
                return Some(ty.clone());
            }
            // Hook-name fallback: callers that need the custom hook type
            // check is_hook_name after this returns None, which produces
            // the same result as the TS getPropertyType hook-name fallback.
        }
        None
    }

    /// Get the type of a named property on a receiver type.
    /// Ported from TS `getPropertyType`.
    pub fn get_property_type(
        &mut self,
        receiver: &Type,
        property: &[u8],
    ) -> Result<Option<Type>, CompilerDiagnostic> {
        let shape_id = match receiver {
            Type::Object { shape_id } | Type::Function { shape_id, .. } => shape_id.as_deref(),
            _ => None,
        };
        if let Some(shape_id) = shape_id {
            let shape = self
                .shapes
                .get(shape_id)
                .ok_or_else(|| shape_not_found(shape_id))?;
            if let Some(ty) = core::str::from_utf8(property)
                .ok()
                .and_then(|k| shape.properties.get(k))
            {
                return Ok(Some(ty.clone()));
            }
            // Fall through to wildcard
            if let Some(ty) = shape.properties.get("*") {
                return Ok(Some(ty.clone()));
            }
            // If property name looks like a hook, return custom hook type
            if is_hook_name(property) {
                return Ok(Some(self.get_custom_hook_type()));
            }
            return Ok(None);
        }
        // No shape ID — if property looks like a hook, return custom hook type
        if is_hook_name(property) {
            return Ok(Some(self.get_custom_hook_type()));
        }
        Ok(None)
    }

    /// Get the type of a numeric property on a receiver type.
    /// Ported from the numeric branch of TS `getPropertyType`.
    pub fn get_property_type_numeric(
        &self,
        receiver: &Type,
    ) -> Result<Option<Type>, CompilerDiagnostic> {
        let shape_id = match receiver {
            Type::Object { shape_id } | Type::Function { shape_id, .. } => shape_id.as_deref(),
            _ => None,
        };
        if let Some(shape_id) = shape_id {
            let shape = self
                .shapes
                .get(shape_id)
                .ok_or_else(|| shape_not_found(shape_id))?;
            return Ok(shape.properties.get("*").cloned());
        }
        Ok(None)
    }

    /// Get the fallthrough (wildcard `*`) property type for computed property access.
    /// Ported from TS `getFallthroughPropertyType`.
    pub fn get_fallthrough_property_type(
        &self,
        receiver: &Type,
    ) -> Result<Option<Type>, CompilerDiagnostic> {
        let shape_id = match receiver {
            Type::Object { shape_id } | Type::Function { shape_id, .. } => shape_id.as_deref(),
            _ => None,
        };
        if let Some(shape_id) = shape_id {
            let shape = self
                .shapes
                .get(shape_id)
                .ok_or_else(|| shape_not_found(shape_id))?;
            return Ok(shape.properties.get("*").cloned());
        }
        Ok(None)
    }

    /// Get the function signature for a function type.
    /// Ported from TS `getFunctionSignature`.
    pub fn get_function_signature(
        &self,
        ty: &Type,
    ) -> Result<Option<&FunctionSignature>, CompilerDiagnostic> {
        let shape_id = match ty {
            Type::Function { shape_id, .. } => shape_id.as_deref(),
            _ => return Ok(None),
        };
        if let Some(shape_id) = shape_id {
            let shape = self
                .shapes
                .get(shape_id)
                .ok_or_else(|| shape_not_found(shape_id))?;
            return Ok(shape.function_type.as_ref());
        }
        Ok(None)
    }

    /// Get the hook kind for a type, if it represents a hook.
    /// Ported from TS `getHookKindForType` in HIR.ts.
    pub fn get_hook_kind_for_type(
        &self,
        ty: &Type,
    ) -> Result<Option<&HookKind>, CompilerDiagnostic> {
        Ok(self
            .get_function_signature(ty)?
            .and_then(|sig| sig.hook_kind.as_ref()))
    }

    /// Resolve the module type provider for a given module name.
    /// Caches results. Checks pre-resolved provider results first, then falls
    /// back to `defaultModuleTypeProvider` (hardcoded).
    fn resolve_module_type(&mut self, module_name: StoreStr) -> Option<Global> {
        if let Some(cached) = self.module_types.get(&module_name) {
            return cached.clone();
        }

        // Check pre-resolved provider results first, then fall back to default
        let module_str = core::str::from_utf8(module_name.slice()).ok();
        let module_config = self
            .config
            .module_type_provider
            .as_ref()
            .and_then(|map| {
                map.iter()
                    .find(|(k, _)| k.as_bytes() == module_name.slice())
                    .map(|(_, v)| v.clone())
            })
            .or_else(|| module_str.and_then(default_module_type_provider));

        let module_type = module_config.map(|config| {
            let mut type_errors: Vec<String> = Vec::new();
            let ty = globals::install_type_config_with_errors(
                &mut self.globals,
                &mut self.shapes,
                &config,
                module_str.unwrap_or_default(),
                (),
                &mut type_errors,
            );
            if !type_errors.is_empty() {
                self.module_type_errors.insert(module_name, type_errors);
            }
            ty
        });
        self.module_types.insert(module_name, module_type.clone());
        module_type
    }

    fn is_known_react_module(&self, module_name: &[u8]) -> bool {
        module_name.eq_ignore_ascii_case(b"react") || module_name.eq_ignore_ascii_case(b"react-dom")
    }

    fn get_custom_hook_type(&mut self) -> Global {
        if self.config.enable_assume_hooks_follow_rules_of_react {
            if self.default_nonmutating_hook.is_none() {
                self.default_nonmutating_hook = Some(default_nonmutating_hook(&mut self.shapes));
            }
            self.default_nonmutating_hook.clone().unwrap()
        } else {
            if self.default_mutating_hook.is_none() {
                self.default_mutating_hook = Some(default_mutating_hook(&mut self.shapes));
            }
            self.default_mutating_hook.clone().unwrap()
        }
    }

    /// Public accessor for the custom hook type, used by InferTypes for
    /// property resolution fallback when a property name looks like a hook.
    pub fn get_custom_hook_type_opt(&mut self) -> Option<Global> {
        Some(self.get_custom_hook_type())
    }

    /// Get a reference to the shapes registry.
    pub fn shapes(&self) -> &ShapeRegistry {
        &self.shapes
    }

    /// Get a reference to the globals registry.
    pub fn globals(&self) -> &GlobalRegistry {
        &self.globals
    }

    /// Generate a globally unique identifier name, analogous to TS
    /// `generateGloballyUniqueIdentifierName` which delegates to Babel's
    /// `scope.generateUidIdentifier`. Matches Babel's naming convention:
    /// first name is `_<name>`, subsequent are `_<name>2`, `_<name>3`, etc.
    /// Also applies Babel's `toIdentifier` sanitization on the input name.
    ///
    /// Like Babel's `generateUid`, checks for collisions against existing
    /// bindings (source-level identifier names) and previously generated UIDs,
    /// rather than using a blind counter.
    pub fn generate_globally_unique_identifier_name(&mut self, name: Option<&[u8]>) -> StoreStr {
        let base = name.unwrap_or(b"temp");
        // Apply Babel's toIdentifier sanitization in a single pass:
        // 1. Replace non-identifier chars with '-'
        // 2. Strip leading '-' and digits
        // 3. CamelCase: replace '-' sequences + optional following char with uppercase of that char
        let mut camel: HirVec<u8> = AstAlloc::vec_with_capacity(base.len());
        let mut iter = base.iter().copied().peekable();
        while let Some(&c) = iter.peek() {
            let is_ident = c.is_ascii_alphanumeric() || c == b'_' || c == b'$';
            if c.is_ascii_digit() || !is_ident {
                iter.next();
            } else {
                break;
            }
        }
        let mut upper_next = false;
        for c in iter {
            if c.is_ascii_alphanumeric() || c == b'_' || c == b'$' {
                if upper_next {
                    camel.push(c.to_ascii_uppercase());
                    upper_next = false;
                } else {
                    camel.push(c);
                }
            } else {
                upper_next = true;
            }
        }
        // Strip leading '_' and trailing digits (Babel's generateUid behavior)
        let camel_ref: &[u8] = if camel.is_empty() { b"temp" } else { &camel };
        let start = camel_ref
            .iter()
            .position(|&c| c != b'_')
            .unwrap_or(camel_ref.len());
        let stripped_lead = &camel_ref[start..];
        let end = stripped_lead
            .iter()
            .rposition(|c| !c.is_ascii_digit())
            .map(|i| i + 1)
            .unwrap_or(0);
        let stripped = &stripped_lead[..end];
        let uid_base: &[u8] = if stripped.is_empty() {
            b"temp"
        } else {
            stripped
        };

        // Lazily build the set of known names from existing identifiers.
        // This approximates Babel's hasBinding/hasGlobal/hasReference checks.
        if self.uid_known_names.is_none() {
            let mut known = HashSet::new();
            for id in &self.identifiers {
                if let Some(name) = &id.name {
                    known.insert(StoreStr::new(name.value()));
                }
            }
            self.uid_known_names = Some(known);
        }

        // Find a name that doesn't collide, matching Babel's generateUid loop.
        // Reuse a single buffer across iterations; HashSet::contains accepts &[u8].
        let known = self.uid_known_names.as_mut().unwrap();
        let mut uid: HirVec<u8> = AstAlloc::vec_with_capacity(uid_base.len() + 4);
        let mut i = 1u32;
        loop {
            uid.clear();
            uid.push(b'_');
            uid.extend_from_slice(uid_base);
            if i > 1 {
                let mut num_buf = [0u8; 10];
                let mut n = i;
                let mut pos = num_buf.len();
                while n > 0 {
                    pos -= 1;
                    num_buf[pos] = b'0' + (n % 10) as u8;
                    n /= 10;
                }
                uid.extend_from_slice(&num_buf[pos..]);
            }
            i += 1;
            if !known.contains(uid.as_slice()) {
                break;
            }
        }

        let result = StoreStr::new(uid.leak());
        known.insert(result);
        result
    }

    /// Seed the UID known names set with external names (e.g. from ProgramContext).
    /// This ensures UID generation avoids names generated by previous function compilations,
    /// matching Babel's behavior where the program scope accumulates all generated UIDs.
    pub fn seed_uid_known_names(&mut self, names: &HashSet<StoreStr>) {
        match &mut self.uid_known_names {
            Some(existing) => existing.extend(names.iter().copied()),
            None => self.uid_known_names = Some(names.clone()),
        }
    }

    /// Return the UID known names accumulated during this compilation.
    pub fn take_uid_known_names(&mut self) -> Option<HashSet<StoreStr>> {
        self.uid_known_names.take()
    }

    /// Record an outlined function (extracted during outlineFunctions or outlineJSX).
    /// Corresponds to TS `env.outlineFunction(fn, type)`.
    pub fn outline_function(&mut self, func: HirFunction, fn_type: Option<ReactFunctionType>) {
        self.outlined_functions
            .push(OutlinedFunctionEntry { func, fn_type });
    }

    /// Get the outlined functions accumulated during compilation.
    pub fn get_outlined_functions(&self) -> &[OutlinedFunctionEntry] {
        &self.outlined_functions
    }

    /// Take the outlined functions, leaving the vec empty.
    pub fn take_outlined_functions(&mut self) -> HirVec<OutlinedFunctionEntry> {
        AstAlloc::take(&mut self.outlined_functions)
    }

    /// Whether memoization is enabled for this compilation.
    /// Ported from TS `get enableMemoization()` in Environment.ts.
    /// Returns true for client/lint modes, false for SSR.
    pub fn enable_memoization(&self) -> bool {
        match self.output_mode {
            OutputMode::Client | OutputMode::Lint => true,
            OutputMode::Ssr => false,
        }
    }

    /// Whether validations are enabled for this compilation.
    /// Ported from TS `get enableValidations()` in Environment.ts.
    pub fn enable_validations(&self) -> bool {
        match self.output_mode {
            OutputMode::Client | OutputMode::Lint | OutputMode::Ssr => true,
        }
    }

    // =========================================================================
    // Name resolution helpers
    // =========================================================================

    /// Get the user-visible name for an identifier.
    ///
    /// First checks the identifier's own name. If None, looks for another
    /// identifier with the same `declaration_id` that has a name. This handles
    /// SSA identifiers that don't carry names but share a declaration_id with
    /// the original named identifier from lowering.
    ///
    /// This is analogous to `identifierName` on Babel's SourceLocation,
    /// which the parser sets on every identifier node.
    pub fn identifier_name_for_id(&self, id: IdentifierId) -> Option<StoreStr> {
        let ident = &self.identifiers[id.0 as usize];
        if let Some(name) = &ident.name {
            return Some(StoreStr::new(name.value()));
        }
        // Fall back: find another identifier with the same declaration_id that has a Named name
        let decl_id = ident.declaration_id;
        for other in &self.identifiers {
            if other.declaration_id == decl_id {
                if let Some(IdentifierName::Named(name)) = &other.name {
                    return Some(*name);
                }
            }
        }
        None
    }

    // =========================================================================
    // ID-based type helper methods
    // =========================================================================

    /// Check whether the function type for an identifier has a noAlias signature.
    /// Looks up the identifier's type and checks its function signature.
    pub fn has_no_alias_signature(&self, identifier_id: IdentifierId) -> bool {
        let ty = &self.types[self.identifiers[identifier_id.0 as usize].type_.0 as usize];
        self.get_function_signature(ty)
            .ok()
            .flatten()
            .map_or(false, |sig| sig.no_alias)
    }

    /// Get the hook kind for an identifier, if its type represents a hook.
    /// Looks up the identifier's type and delegates to `get_hook_kind_for_type`.
    pub fn get_hook_kind_for_id(
        &self,
        identifier_id: IdentifierId,
    ) -> Result<Option<&HookKind>, CompilerDiagnostic> {
        let ty = &self.types[self.identifiers[identifier_id.0 as usize].type_.0 as usize];
        self.get_hook_kind_for_type(ty)
    }
}

impl Default for Environment {
    fn default() -> Self {
        Self::new()
    }
}

#[cold]
#[inline(never)]
fn shape_not_found(shape_id: &str) -> CompilerDiagnostic {
    CompilerDiagnostic::new(
        ErrorCategory::Invariant,
        format!(
            "[HIR] Forget internal error: cannot resolve shape {}",
            shape_id
        ),
        None,
    )
}

/// Check if a name matches the React hook naming convention: `use[A-Z0-9]`.
/// Ported from TS `isHookName` in Environment.ts.
pub fn is_hook_name(name: &[u8]) -> bool {
    if name.len() < 4 {
        return false;
    }
    if !name.starts_with(b"use") {
        return false;
    }
    let fourth_char = name[3];
    fourth_char.is_ascii_uppercase() || fourth_char.is_ascii_digit()
}

/// Returns true if the name follows React naming conventions (component or hook).
/// Components start with an uppercase letter; hooks match `use[A-Z0-9]`.
pub fn is_react_like_name(name: &[u8]) -> bool {
    if name.is_empty() {
        return false;
    }
    let first_char = name[0];
    if first_char.is_ascii_uppercase() {
        return true;
    }
    is_hook_name(name)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_is_hook_name() {
        assert!(is_hook_name(b"useState"));
        assert!(is_hook_name(b"useEffect"));
        assert!(is_hook_name(b"useMyHook"));
        assert!(is_hook_name(b"use3rdParty"));
        assert!(!is_hook_name(b"use"));
        assert!(!is_hook_name(b"used"));
        assert!(!is_hook_name(b"useless"));
        assert!(!is_hook_name(b"User"));
        assert!(!is_hook_name(b"foo"));
    }

    #[test]
    fn test_environment_has_globals() {
        let env = Environment::new();
        assert!(env.globals().contains_key("useState"));
        assert!(env.globals().contains_key("useEffect"));
        assert!(env.globals().contains_key("useRef"));
        assert!(env.globals().contains_key("Math"));
        assert!(env.globals().contains_key("console"));
        assert!(env.globals().contains_key("Array"));
        assert!(env.globals().contains_key("Object"));
    }

    #[test]
    fn test_get_property_type_array() {
        let mut env = Environment::new();
        let array_type = Type::Object {
            shape_id: Some("BuiltInArray"),
        };
        let map_type = env.get_property_type(&array_type, b"map").unwrap();
        assert!(map_type.is_some());
        let push_type = env.get_property_type(&array_type, b"push").unwrap();
        assert!(push_type.is_some());
        let nonexistent = env
            .get_property_type(&array_type, b"nonExistentMethod")
            .unwrap();
        assert!(nonexistent.is_none());
    }

    #[test]
    fn test_get_function_signature() {
        let env = Environment::new();
        let use_state_type = env.globals().get("useState").unwrap();
        let sig = env.get_function_signature(use_state_type).unwrap();
        assert!(sig.is_some());
        let sig = sig.unwrap();
        assert!(sig.hook_kind.is_some());
        assert_eq!(sig.hook_kind.as_ref().unwrap(), &HookKind::UseState);
    }

    #[test]
    fn test_get_global_declaration() {
        let mut env = Environment::new();
        // Global binding
        let binding = NonLocalBinding {
            ref_: bun_ast::Ref::NONE,
            kind: NonLocalKind::Global {
                name: "Math".into(),
            },
        };
        let result = env.get_global_declaration(&binding, None).unwrap();
        assert!(result.is_some());

        // Import from react
        let binding = NonLocalBinding {
            ref_: bun_ast::Ref::NONE,
            kind: NonLocalKind::ImportSpecifier {
                name: "useState".into(),
                module: "react".into(),
                imported: "useState".into(),
            },
        };
        let result = env.get_global_declaration(&binding, None).unwrap();
        assert!(result.is_some());

        // Unknown global
        let binding = NonLocalBinding {
            ref_: bun_ast::Ref::NONE,
            kind: NonLocalKind::Global {
                name: "unknownThing".into(),
            },
        };
        let result = env.get_global_declaration(&binding, None).unwrap();
        assert!(result.is_none());

        // Hook-like name gets default hook type
        let binding = NonLocalBinding {
            ref_: bun_ast::Ref::NONE,
            kind: NonLocalKind::Global {
                name: "useCustom".into(),
            },
        };
        let result = env.get_global_declaration(&binding, None).unwrap();
        assert!(result.is_some());
    }
}
