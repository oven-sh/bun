// Scratch stand-in for what steps 6 to 8 and the data model call in the other steps of the checker: upstream's names and the shapes that the callers in the tree use, bodies that do as little as the tests need.
use crate::ast::{
    Arg, Ast, DiagnosticId, NodeId, SourceFiles, SymbolFlags, SymbolId, SymbolTableId,
};
use crate::checker::{
    Checker, IndexInfoId, InferenceContextId, InferenceInfoId, LiteralValue, ObjectFlags, Program,
    SignatureId, SignatureKind, StructuredType, SymbolFormatFlags, Type, TypeData, TypeFlags,
    TypeId, TypeMapperId, TypeResolution, TypeSystemEntity, TypeSystemPropertyName,
};
use crate::core::{List, LiveList, ResolutionMode};
use crate::diagnostics::MessageId;

// c30_type_keys.rs (step 3)
#[derive(Clone, Copy, PartialEq, Eq, Hash, PartialOrd, Ord, Default, Debug)]
pub struct CacheHashKey(pub u128);
impl CacheHashKey {
    pub fn of(bytes: &[u8]) -> Self {
        let mut hash: u128 = 0;
        for &b in bytes {
            hash = hash.wrapping_mul(257).wrapping_add(u128::from(b) + 1);
        }
        CacheHashKey(hash)
    }
}

// utilities.go, inference.go and checker.go 23603 (steps 2, 12 and 25)
pub fn is_tuple_type(_c: &Checker<'_>, _t: TypeId) -> bool { false }
pub fn value_to_string(_value: &LiteralValue<'_>) -> Vec<u8> { Vec::new() }
pub fn clear_cached_inferences(_c: &mut Checker<'_>, _inferences: LiveList<'_, InferenceInfoId>) {}
pub fn is_this_type_parameter(_c: &Checker<'_>, _t: TypeId) -> bool { false }

// c21 (step 5): what the diagnostics read of a file.
pub struct ProgramFiles<'a> {
    pub ast: Ast<'a>,
}
impl SourceFiles for ProgramFiles<'_> {
    fn file_name(&self, file: NodeId) -> &[u8] { self.ast.as_source_file(file).file_name() }
}

// utilities.go 1777
pub struct DiagnosticDetails {
    pub message: MessageId,
    pub args: Vec<Vec<u8>>,
}

impl<'a> Checker<'a> {
    // D-SINK (step 5)
    pub fn add_diagnostic(&mut self, diagnostic: DiagnosticId) -> DiagnosticId {
        // DiagnosticsCollection.Add: an equal diagnostic that is already there is the answer.
        for &existing in &self.diagnostics.added {
            let (a, b) = (&self.diagnostic_store[existing], &self.diagnostic_store[diagnostic]);
            if a.node == b.node && a.message == b.message && a.args == b.args { return existing; }
        }
        self.diagnostics.added.push(diagnostic);
        diagnostic
    }
    pub fn error(&mut self, location: NodeId, message: MessageId, args: &[Arg<'_>]) -> DiagnosticId {
        let diagnostic = self.new_diagnostic_for_node(location, message, args);
        self.add_diagnostic(diagnostic)
    }
    pub fn add_error_or_suggestion(&mut self, is_error: bool, diagnostic: DiagnosticId) {
        if is_error { self.add_diagnostic(diagnostic); }
    }
    pub fn is_deprecated_symbol(&mut self, _symbol: SymbolId) -> bool { false }
    pub fn add_deprecated_suggestion(&mut self, _location: NodeId, _declarations: List<'a, NodeId>, _deprecated_entity: &[u8]) -> DiagnosticId { self.stand_in("addDeprecatedSuggestion") }
    // UTIL (step 2)
    pub fn new_diagnostic_for_node(&mut self, node: NodeId, message: MessageId, args: &[Arg<'_>]) -> DiagnosticId {
        self.diagnostic_store.new_for_node(node, message, args, DiagnosticId::NIL)
    }
    pub fn new_diagnostic_chain_for_node(&mut self, chain: DiagnosticId, node: NodeId, message: MessageId, args: &[Arg<'_>]) -> DiagnosticId {
        self.diagnostic_store.new_for_node(node, message, args, chain)
    }
    // T-RSTACK (step 4), as far as aliases need it
    pub fn push_type_resolution(&mut self, target: TypeSystemEntity, property_name: TypeSystemPropertyName) -> bool {
        let start = self.find_resolution_cycle_start_index(target, property_name);
        if start >= 0 {
            for resolution in self.type_resolutions.iter_mut().skip(start as usize) { resolution.result = false; }
            return false;
        }
        self.type_resolutions.push(TypeResolution { target, property_name, result: true });
        true
    }
    pub fn pop_type_resolution(&mut self) -> bool {
        match self.type_resolutions.pop() {
            Some(resolution) => resolution.result,
            None => self.fail("index out of range [-1]"),
        }
    }
    pub fn find_resolution_cycle_start_index(&mut self, target: TypeSystemEntity, property_name: TypeSystemPropertyName) -> isize {
        let mut i = self.type_resolutions.len() as isize - 1;
        while i >= self.resolution_start {
            let (t, p) = (self.type_resolutions[i as usize].target, self.type_resolutions[i as usize].property_name);
            if p == TypeSystemPropertyName::AliasTarget {
                if let TypeSystemEntity::Symbol(s) = t {
                    let links = self.alias_symbol_links.get(s);
                    if !self.alias_symbol_links[links].alias_target.is_nil() { return -1; }
                }
            }
            if t == target && p == property_name { return i; }
            i -= 1;
        }
        -1
    }
    // checker.go 971: c.resolveName = c.createNameResolver().Resolve (step 5). The hooks of steps 6 to 8 are the real functions.
    pub fn resolve_name(&mut self, location: NodeId, name: &[u8], meaning: SymbolFlags, name_not_found_message: MessageId, is_use: bool, exclude_globals: bool) -> SymbolId {
        let mut resolver = crate::binder::NameResolver::<Checker<'a>> {
            compiler_options: self.compiler_options,
            get_symbol_of_declaration: Some(Checker::get_symbol_of_declaration),
            error: Some(Checker::error),
            globals: self.globals,
            arguments_symbol: self.arguments_symbol,
            require_symbol: self.require_symbol,
            lookup: Some(Checker::get_symbol),
            symbol_referenced: None,
            set_requires_scope_change_cache: None,
            get_requires_scope_change_cache: None,
            on_property_with_invalid_initializer: None,
            on_failed_to_resolve_symbol: None,
            on_successfully_resolved_symbol: None,
        };
        let a = self.ast;
        resolver.resolve(a, self, location, name, meaning, name_not_found_message, is_use, exclude_globals)
    }
    // checker.go 2161: getImmediateAliasedSymbol (N-DIAG, step 5).
    pub fn get_immediate_aliased_symbol(&mut self, symbol: SymbolId) -> SymbolId {
        let links = self.alias_symbol_links.get(symbol);
        if self.alias_symbol_links[links].immediate_target.is_nil() {
            let node = self.get_declaration_of_alias_symbol(symbol);
            let target = self.get_target_of_alias_declaration(node);
            self.alias_symbol_links[links].immediate_target = target;
        }
        self.alias_symbol_links[links].immediate_target
    }
    // checker.go 2139: getTypeOnlyAliasDeclaration (N-DIAG, step 5).
    pub fn get_type_only_alias_declaration(&mut self, symbol: SymbolId) -> NodeId {
        if self.ast.sym(symbol).flags.intersects(SymbolFlags::ALIAS) {
            self.resolve_alias(symbol);
            let links = self.alias_symbol_links.get(symbol);
            return self.alias_symbol_links[links].type_only_declaration;
        }
        NodeId::NIL
    }
    pub fn get_spelling_suggestion_for_name(&mut self, _name: &[u8], _symbols: &[SymbolId], _meaning: SymbolFlags) -> SymbolId { SymbolId::NIL }
    // Later steps. The scratch knows one late-bindable name: every computed property name has the unique symbol type that `scripted_unique_symbol_type` names.
    pub fn check_computed_property_name(&mut self, _node: NodeId) -> TypeId { scripted(self).unique_symbol_type }
    pub fn check_expression_cached(&mut self, _node: NodeId) -> TypeId { self.stand_in("checkExpressionCached") }
    pub fn get_property_of_type(&mut self, _t: TypeId, _name: &[u8]) -> SymbolId { SymbolId::NIL }
    pub fn get_property_of_type_ex(&mut self, _t: TypeId, name: &[u8], _skip_object_function_property_augment: bool, _include_type_only_members: bool) -> SymbolId {
        if name == b"default" { return scripted(self).default_property; }
        SymbolId::NIL
    }
    pub fn get_signatures_of_structured_type(&mut self, _t: TypeId, _kind: SignatureKind) -> List<'a, SignatureId> { List::NIL }
    pub fn get_spread_type(&mut self, _left: TypeId, _right: TypeId, _symbol: SymbolId, _object_flags: ObjectFlags, _readonly: bool) -> TypeId { self.stand_in("getSpreadType") }
    pub fn get_string_literal_type(&mut self, _value: &[u8]) -> TypeId { self.any_type }
    pub fn get_type_from_type_node(&mut self, _node: NodeId) -> TypeId { self.stand_in("getTypeFromTypeNode") }
    pub fn get_type_of_symbol(&mut self, _symbol: SymbolId) -> TypeId {
        let t = scripted(self).type_of_symbol;
        if !t.is_nil() { return t; }
        self.error_type
    }
    pub fn has_late_bindable_index_signature(&mut self, _node: NodeId) -> bool { false }
    pub fn has_late_bindable_name(&mut self, node: NodeId) -> bool {
        let name = self.ast.name(node);
        !name.is_nil() && self.ast.kind(name) == crate::ast::Kind::ComputedPropertyName
    }
    pub fn is_error_type(&self, t: TypeId) -> bool { t == self.error_type }
    pub fn is_valid_spread_type(&mut self, _t: TypeId) -> bool { false }
    // newAnonymousType (step 3): an object type with the members and the index infos.
    pub fn new_anonymous_type(&mut self, symbol: SymbolId, members: SymbolTableId, _call_signatures: List<'a, SignatureId>, _construct_signatures: List<'a, SignatureId>, index_infos: List<'a, IndexInfoId>) -> TypeId {
        let t = self.types.alloc(Type {
            flags: TypeFlags::OBJECT,
            object_flags: ObjectFlags::ANONYMOUS,
            symbol,
            data: TypeData::Object(Box::default()),
            ..Type::default()
        });
        let structured = self.as_structured_type_mut(t);
        structured.members = members;
        structured.index_infos = index_infos;
        t
    }
    pub fn resolve_structured_type_members(&mut self, t: TypeId) -> TypeId { t }
    pub fn symbol_to_string(&mut self, symbol: SymbolId) -> Vec<u8> {
        self.symbol_to_string_ex(symbol, NodeId::NIL, SymbolFlags::ALL, SymbolFormatFlags::ALLOW_ANY_NODE_KIND)
    }
    pub fn symbol_to_string_ex(&mut self, symbol: SymbolId, _enclosing_declaration: NodeId, _meaning: SymbolFlags, _flags: SymbolFormatFlags) -> Vec<u8> { self.ast.sym(symbol).name.to_vec() }
    // inference.go, for mapper.rs of the data model
    pub fn infer_from_intra_expression_sites(&mut self, _n: InferenceContextId) {}
    pub fn get_inferred_type(&mut self, _n: InferenceContextId, _index: isize) -> TypeId { self.stand_in("getInferredType") }
    pub fn instantiate_type(&mut self, t: TypeId, _m: TypeMapperId) -> TypeId { t }
    pub fn get_effective_type_argument_at_index(&mut self, _node: NodeId, _type_parameters: List<'a, TypeId>, _index: isize) -> TypeId { self.stand_in("getEffectiveTypeArgumentAtIndex") }
    pub fn get_unique_literal_type_for_type_parameter(&mut self, t: TypeId) -> TypeId { t }
    pub fn report_unreliable_worker(&mut self, t: TypeId) -> TypeId { t }
    pub fn report_unmeasurable_worker(&mut self, t: TypeId) -> TypeId { t }
    pub fn restrictive_mapper_worker(&mut self, t: TypeId) -> TypeId { t }
    pub fn permissive_mapper_worker(&mut self, t: TypeId) -> TypeId { t }
}

// What the tests script for the lookups of later steps, kept beside the checker because the record of the tree has no field for it.
#[derive(Clone, Copy, Default)]
pub struct Scripted {
    pub type_of_symbol: TypeId,
    pub default_property: SymbolId,
    pub unique_symbol_type: TypeId,
}
thread_local! {
    pub static SCRIPTED: std::cell::Cell<Scripted> = const { std::cell::Cell::new(Scripted { type_of_symbol: TypeId::NIL, default_property: SymbolId::NIL, unique_symbol_type: TypeId::NIL }) };
}
pub fn scripted(_c: &Checker<'_>) -> Scripted { SCRIPTED.with(|s| s.get()) }
pub fn set_scripted(value: Scripted) { SCRIPTED.with(|s| s.set(value)); }

// utilities.go (step 2)
pub fn find_in_map(a: Ast<'_>, table: SymbolTableId, mut predicate: impl FnMut(SymbolId) -> bool) -> SymbolId {
    let mut position = 0;
    while let Some((_, symbol)) = a.table_entry_at(table, position) {
        position += 1;
        if predicate(symbol) { return symbol; }
    }
    SymbolId::NIL
}
pub fn get_external_module_require_argument(_a: Ast<'_>, _node: NodeId) -> NodeId { NodeId::NIL }
pub fn has_export_assignment_symbol(a: Ast<'_>, module_symbol: SymbolId) -> bool {
    !a.table_get(a.sym(module_symbol).exports, crate::ast::INTERNAL_SYMBOL_NAME_EXPORT_EQUALS).is_nil()
}
pub fn is_contained_by_namespace(_a: Ast<'_>, _node: NodeId) -> bool { false }
pub fn is_shorthand_ambient_module_symbol(a: Ast<'_>, module_symbol: SymbolId) -> bool {
    let node = a.sym(module_symbol).value_declaration;
    !node.is_nil() && a.kind(node) == crate::ast::Kind::ModuleDeclaration && a.body(node).is_nil()
}
pub fn is_syntactic_default(_a: Ast<'_>, _node: NodeId) -> bool { false }
pub fn is_side_effect_import(a: Ast<'_>, node: NodeId) -> bool {
    let ancestor = crate::ast::find_ancestor(a, node, |n| crate::ast::is_import_declaration(a, n));
    !ancestor.is_nil() && a.import_clause(ancestor).is_nil()
}
pub fn entity_name_to_string(_a: Ast<'_>, _name: NodeId) -> Vec<u8> { Vec::new() }
pub fn get_alias_declaration_from_name(a: Ast<'_>, node: NodeId) -> NodeId {
    use crate::ast::Kind;
    match a.kind(a.parent(node)) {
        Kind::ImportClause | Kind::ImportSpecifier | Kind::NamespaceImport | Kind::ExportSpecifier | Kind::ExportAssignment | Kind::ImportEqualsDeclaration | Kind::NamespaceExport => a.parent(node),
        Kind::QualifiedName => get_alias_declaration_from_name(a, a.parent(node)),
        _ => NodeId::NIL,
    }
}
pub fn get_containing_qualified_name_node(a: Ast<'_>, node: NodeId) -> NodeId {
    let mut node = node;
    while crate::ast::is_qualified_name(a, a.parent(node)) { node = a.parent(node); }
    node
}
pub fn get_members_of_declaration<'a>(a: Ast<'a>, node: NodeId) -> List<'a, NodeId> { a.members(node) }
pub fn get_property_name_from_type(_c: &Checker<'_>, _t: TypeId) -> Vec<u8> { b"\xFE@k@7".to_vec() }
pub fn is_type_usable_as_property_name(c: &Checker<'_>, t: TypeId) -> bool { c.types[t].flags.intersects(TypeFlags::UNIQUE_ES_SYMBOL) }
pub fn create_module_not_found_chain(_program: &dyn Program<'_>, _file: NodeId, _module_reference: &[u8], _mode: ResolutionMode, _package_name: &[u8]) -> DiagnosticDetails {
    DiagnosticDetails { message: MessageId::NIL, args: Vec::new() }
}
pub fn create_mode_mismatch_details(_a: Ast<'_>, _program: &dyn Program<'_>, _file: NodeId) -> DiagnosticDetails {
    DiagnosticDetails { message: MessageId::NIL, args: Vec::new() }
}

// A StructuredType is read by the files of steps 6 to 8 through `as_structured_type`.
pub fn members_of(c: &Checker<'_>, t: TypeId) -> SymbolTableId {
    let structured: &StructuredType<'_> = c.as_structured_type(t);
    structured.members
}

// A program over resolved inputs for the tests: the modules that resolve, and the files that exist.
pub struct ScratchProgram<'p> {
    pub options: &'p crate::core::CompilerOptions,
    // The module reference, the resolved module, and its file in the program (nil for none).
    pub modules: Vec<(&'p [u8], crate::module::ResolvedModule<'p>, NodeId)>,
    pub existing: Vec<&'p [u8]>,
}
impl<'p> Program<'p> for ScratchProgram<'p> {
    fn options(&self) -> &'p crate::core::CompilerOptions { self.options }
    fn source_files(&self) -> &'p [NodeId] { &[] }
    fn bind_source_files(&self) {}
    fn file_exists(&self, file_name: &[u8]) -> bool { self.existing.contains(&file_name) }
    fn get_source_file(&self, file_name: &[u8]) -> NodeId { self.get_source_file_for_resolved_module(file_name) }
    fn get_source_file_for_resolved_module(&self, file_name: &[u8]) -> NodeId {
        self.modules.iter().find(|m| m.1.resolved_file_name == file_name).map_or(NodeId::NIL, |m| m.2)
    }
    fn get_emit_module_format_of_file(&self, _source_file: NodeId) -> crate::core::ModuleKind { crate::core::ModuleKind::NONE }
    fn get_emit_syntax_for_usage_location(&self, _source_file: NodeId, _usage_location: NodeId) -> ResolutionMode { crate::core::ModuleKind::NONE }
    fn get_implied_node_format_for_emit(&self, _source_file: NodeId) -> crate::core::ModuleKind { crate::core::ModuleKind::NONE }
    fn get_resolved_module(&self, _current_source_file: NodeId, module_reference: &[u8], _mode: ResolutionMode) -> Option<crate::module::ResolvedModule<'p>> {
        self.modules.iter().find(|m| m.0 == module_reference).map(|m| m.1)
    }
    fn for_each_resolved_module(&self, f: &mut dyn FnMut(&crate::module::ResolvedModule<'p>)) {
        for module in &self.modules { f(&module.1); }
    }
    fn get_packages_map_entry(&self, _package_name: &[u8]) -> Option<bool> { None }
    fn get_source_file_meta_data(&self, _file: NodeId) -> crate::ast::SourceFileMetaData { crate::ast::SourceFileMetaData::default() }
    fn get_jsx_runtime_import_specifier(&self, _file: NodeId) -> (&'p [u8], NodeId) { (b"", NodeId::NIL) }
    fn get_import_helpers_import_specifier(&self, _file: NodeId) -> NodeId { NodeId::NIL }
    fn source_file_may_be_emitted(&self, _source_file: NodeId, _force_dts_emit: bool) -> bool { false }
    fn is_source_file_default_library(&self, _file: NodeId) -> bool { false }
    fn get_project_reference_from_output_dts(&self, _file: NodeId) -> Option<crate::checker::SourceOutputAndProjectReference<'p>> { None }
    fn get_redirect_for_resolution(&self, _file: NodeId) -> Option<&'p crate::checker::ParsedCommandLine> { None }
    fn common_source_directory(&self) -> &'p [u8] { b"" }
    fn use_case_sensitive_file_names(&self) -> bool { true }
    fn get_current_directory(&self) -> &'p [u8] { b"/" }
    fn get_project_reference_from_source(&self, _path: &crate::tspath::Path) -> Option<crate::checker::SourceOutputAndProjectReference<'p>> { None }
    fn get_default_resolution_mode_for_file(&self, _file: NodeId) -> ResolutionMode { crate::core::ModuleKind::NONE }
    fn get_mode_for_usage_location(&self, _file: NodeId, _usage_location: NodeId) -> ResolutionMode { crate::core::ModuleKind::NONE }
}

// What NewChecker (step 5) sets of the fields that steps 6 to 8 read, on the record of the tree.
pub fn scratch_checker<'a>(ast: Ast<'a>, lists: &'a crate::checker::CheckerArena<'a>, program: &'a dyn Program<'a>, compiler_options: &'a crate::core::CompilerOptions) -> Checker<'a> {
    let mut c = Checker::zero(ast, lists, program, compiler_options);
    c.module_kind = compiler_options.get_emit_module_kind();
    c.module_resolution_kind = compiler_options.get_module_resolution_kind();
    c.globals = ast.new_table();
    c.cached_types = crate::core::Map::make();
    c.merged_symbols = crate::core::Map::make();
    c.any_type = c.types.alloc(Type::default());
    c.error_type = c.types.alloc(Type::default());
    let unique_symbol_type = c.types.alloc(Type { flags: TypeFlags::UNIQUE_ES_SYMBOL, ..Type::default() });
    set_scripted(Scripted { unique_symbol_type, ..Scripted::default() });
    c.require_symbol = c.new_symbol(SymbolFlags::PROPERTY, b"require");
    c.unknown_symbol = c.new_symbol(SymbolFlags::PROPERTY, b"unknown");
    c.global_this_symbol = c.new_symbol_ex(SymbolFlags::MODULE, b"globalThis", crate::ast::CheckFlags::READONLY);
    c
}
