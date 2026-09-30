// Port of internal/binder/binder.go of typescript-go 89d5d5b.
use crate::ast::{
    self, Arg, Ast, DiagnosticId, DiagnosticStore, File, FlowFlags, FlowListId, FlowNodeId,
    IdAllocator, JSDeclarationKind, Kind, ModifierFlags, ModifierListId, ModuleInstanceState,
    NodeFlags, NodeId, NodeListId, PatternAmbientModule, SymbolFlags, SymbolId, SymbolTableId,
};
use crate::collections::Set;
use crate::core::{self, List, Text};
use crate::diagnostics::{self, MessageId};
use crate::internal::FaultKind;
use crate::scanner;
use crate::tspath;
use bun_core::StackCheck;

#[repr(transparent)]
#[derive(Clone, Copy, PartialEq, Eq, Hash, Default, Debug)]
pub struct ContainerFlags(pub i32);

impl ContainerFlags {
    // The current node is not a container, and no container manipulation should happen before recursing into it.
    pub const NONE: Self = Self(0);
    // The current node is a container. It should be set as the current container (and block-container) before recursing into it. The current node does not have locals. Examples: Classes, ObjectLiterals, TypeLiterals, Interfaces...
    pub const IS_CONTAINER: Self = Self(1 << 0);
    // The current node is a block-scoped-container. It should be set as the current block-container before recursing into it. Examples: Blocks (when not parented by functions), Catch clauses, For/For-in/For-of statements...
    pub const IS_BLOCK_SCOPED_CONTAINER: Self = Self(1 << 1);
    // The current node is the container of a control flow path. The current control flow should be saved and restored, and a new control flow initialized within the container.
    pub const IS_CONTROL_FLOW_CONTAINER: Self = Self(1 << 2);
    pub const IS_FUNCTION_LIKE: Self = Self(1 << 3);
    pub const IS_FUNCTION_EXPRESSION: Self = Self(1 << 4);
    pub const HAS_LOCALS: Self = Self(1 << 5);
    pub const IS_INTERFACE: Self = Self(1 << 6);
    pub const IS_OBJECT_LITERAL_OR_CLASS_EXPRESSION_METHOD_OR_ACCESSOR: Self = Self(1 << 7);
    pub const IS_THIS_CONTAINER: Self = Self(1 << 8);
    pub const PROPAGATES_THIS_KEYWORD: Self = Self(1 << 9);

    #[inline]
    pub const fn intersects(self, other: Self) -> bool {
        self.0 & other.0 != 0
    }
    #[inline]
    pub const fn contains(self, other: Self) -> bool {
        self.0 & other.0 == other.0
    }
}

impl std::ops::BitOr for ContainerFlags {
    type Output = Self;
    #[inline]
    fn bitor(self, rhs: Self) -> Self {
        Self(self.0 | rhs.0)
    }
}

impl std::ops::BitAnd for ContainerFlags {
    type Output = Self;
    #[inline]
    fn bitand(self, rhs: Self) -> Self {
        Self(self.0 & rhs.0)
    }
}

#[derive(Clone, Copy)]
pub struct ExpandoAssignmentInfo {
    node: NodeId,
    container: NodeId,
    block_scope_container: NodeId,
}

// `*ActiveLabel`: the position of the label in `Binder::active_labels` plus one, 0 for nil.
#[derive(Clone, Copy, PartialEq, Eq, Default)]
struct ActiveLabelId(u32);

impl ActiveLabelId {
    const NIL: Self = Self(0);
    const fn is_nil(self) -> bool {
        self.0 == 0
    }
    const fn index(self) -> usize {
        (self.0 as usize).wrapping_sub(1)
    }
}

pub struct Binder<'a> {
    a: Ast<'a>,
    file: NodeId,
    unreachable_flow: FlowNodeId,

    container: NodeId,
    this_container: NodeId,
    block_scope_container: NodeId,
    last_container: NodeId,
    current_flow: FlowNodeId,
    current_break_target: FlowNodeId,
    current_continue_target: FlowNodeId,
    current_return_target: FlowNodeId,
    current_true_target: FlowNodeId,
    current_false_target: FlowNodeId,
    current_exception_target: FlowNodeId,
    pre_switch_case_flow: FlowNodeId,
    active_label_list: ActiveLabelId,
    emit_flags: NodeFlags,
    seen_this_keyword: bool,
    has_explicit_return: bool,
    has_flow_effects: bool,
    in_assignment_pattern: bool,
    seen_parse_error: bool,
    symbol_count: isize,
    not_const_enum_only_modules: Set<SymbolId>,
    expando_assignments: Vec<ExpandoAssignmentInfo>,
    // Upstream's symbol, flow node, flow list and declaration arenas are the open store of `a`. The fields below have no upstream field: the labels behind `active_label_list`, and what upstream writes into the source file while it binds, kept here until the file is bound.
    active_labels: Vec<ActiveLabel<'a>>,
    diagnostic_store: DiagnosticStore,
    bind_diagnostics: Vec<DiagnosticId>,
    pattern_ambient_modules: Vec<PatternAmbientModule>,
    stack_check: StackCheck,
}

pub struct ActiveLabel<'a> {
    next: ActiveLabelId,
    break_target: FlowNodeId,
    continue_target: FlowNodeId,
    name: Text<'a>,
    referenced: bool,
}

impl ActiveLabel<'_> {
    pub fn break_target(&self) -> FlowNodeId {
        self.break_target
    }
    pub fn continue_target(&self) -> FlowNodeId {
        self.continue_target
    }
}

pub fn bind_source_file_exported(file: &File, ids: &IdAllocator) {
    // This is constructed this way to make the compiler "out-line" the function, avoiding most work in the common case where the file has already been bound.
    if file.bound().is_none() {
        bind_source_file(file, ids);
    }
}

// Upstream takes a zeroed binder from a pool. Here every file gets a new one.
fn get_binder(a: Ast<'_>) -> Binder<'_> {
    Binder {
        a,
        file: NodeId::NIL,
        unreachable_flow: FlowNodeId::NIL,
        container: NodeId::NIL,
        this_container: NodeId::NIL,
        block_scope_container: NodeId::NIL,
        last_container: NodeId::NIL,
        current_flow: FlowNodeId::NIL,
        current_break_target: FlowNodeId::NIL,
        current_continue_target: FlowNodeId::NIL,
        current_return_target: FlowNodeId::NIL,
        current_true_target: FlowNodeId::NIL,
        current_false_target: FlowNodeId::NIL,
        current_exception_target: FlowNodeId::NIL,
        pre_switch_case_flow: FlowNodeId::NIL,
        active_label_list: ActiveLabelId::NIL,
        emit_flags: NodeFlags::NONE,
        seen_this_keyword: false,
        has_explicit_return: false,
        has_flow_effects: false,
        in_assignment_pattern: false,
        seen_parse_error: false,
        symbol_count: 0,
        not_const_enum_only_modules: Set::default(),
        expando_assignments: Vec::new(),
        active_labels: Vec::new(),
        diagnostic_store: DiagnosticStore::default(),
        bind_diagnostics: Vec::new(),
        pattern_ambient_modules: Vec::new(),
        stack_check: StackCheck::init(),
    }
}

fn put_binder(b: Binder<'_>) {
    drop(b);
}

fn bind_source_file(file: &File, ids: &IdAllocator) {
    let root = file.source_file.root;
    file.bind_once(ids, |a| {
        let mut b = get_binder(a);
        b.file = root;
        b.unreachable_flow = b.new_flow_node(FlowFlags::UNREACHABLE);
        b.bind(root);
        b.bind_deferred_expando_assignments();
        a.set_symbol_count(root, b.symbol_count);
        a.set_pattern_ambient_modules(root, std::mem::take(&mut b.pattern_ambient_modules));
        a.set_bind_diagnostics(
            root,
            std::mem::take(&mut b.diagnostic_store),
            std::mem::take(&mut b.bind_diagnostics),
        );
        put_binder(b);
    });
}

// Go stacks grow: a recursion that follows the depth of the tree ends with this internal diagnostic when the thread has no stack left.
#[cold]
fn stack_limit(a: Ast<'_>, id: u32) {
    a.fault(FaultKind::StackLimit, "stack limit reached", 0, id);
}

impl<'a> Binder<'a> {
    // A name that the binder builds lives in the open store, as the names of the file live in its text.
    fn text(&self, bytes: &[u8]) -> Text<'a> {
        self.a.open().arena.alloc_slice_copy(bytes)
    }

    // A declaration list is never appended to in place: every change stores a new list.
    fn list_of(&self, items: &[NodeId]) -> List<'a, NodeId> {
        List::from_slice(self.a.open().arena.alloc_slice_copy(items))
    }

    fn new_symbol(&mut self, flags: SymbolFlags, name: Text<'a>) -> SymbolId {
        self.symbol_count += 1;
        self.a.new_symbol(flags, name)
    }

    // Declares a Symbol for the node and adds it to symbols. Reports errors for conflicting identifier names. `symbol_table` is the table the node is added to, `parent` is the node's parent declaration, `includes` are the SymbolFlags that the node has in addition to its declaration type (eg: export, ambient, etc.), `excludes` are the flags which the node cannot be declared alongside in a symbol table, used to report forbidden declarations.
    fn declare_symbol(
        &mut self,
        symbol_table: SymbolTableId,
        parent: SymbolId,
        node: NodeId,
        includes: SymbolFlags,
        excludes: SymbolFlags,
    ) -> SymbolId {
        self.declare_symbol_ex(symbol_table, parent, node, includes, excludes, false, false)
    }

    fn declare_symbol_ex(
        &mut self,
        symbol_table: SymbolTableId,
        parent: SymbolId,
        node: NodeId,
        includes: SymbolFlags,
        excludes: SymbolFlags,
        is_replaceable_by_method: bool,
        is_computed_name: bool,
    ) -> SymbolId {
        let a = self.a;
        if !is_computed_name && ast::has_dynamic_name(a, node) {
            a.fault(
                FaultKind::Assert,
                "Debug failure. False expression.",
                0,
                node.0,
            );
        }
        let is_default_export = ast::has_syntactic_modifier(a, node, ModifierFlags::DEFAULT)
            || (ast::is_export_specifier(a, node)
                && ast::module_export_name_is_default(a, a.as_export_specifier(node).name));
        // The exported symbol for an export default function/class node is always named "default"
        let name: Text<'a> = if is_computed_name {
            ast::INTERNAL_SYMBOL_NAME_COMPUTED
        } else if is_default_export && !parent.is_nil() {
            ast::INTERNAL_SYMBOL_NAME_DEFAULT
        } else {
            self.get_declaration_name(node)
        };
        let mut symbol: SymbolId;
        if name == ast::INTERNAL_SYMBOL_NAME_MISSING {
            symbol = self.new_symbol(SymbolFlags::NONE, ast::INTERNAL_SYMBOL_NAME_MISSING);
        } else {
            // Check and see if the symbol table already has a symbol with this name. If not, create a new symbol with this name and add it to the table. Note that we don't give the new symbol any flags *yet*. This ensures that it will not conflict with the 'excludes' flags we pass in. If we do get an existing symbol, see if it conflicts with the new symbol we're creating. For example, a 'var' symbol and a 'class' symbol will conflict within the same symbol table. If we have a conflict, report the issue on each declaration we have for this symbol, and then create a new symbol for this declaration. Note that when properties declared in Javascript constructors (marked by isReplaceableByMethod) conflict with another symbol, the property loses. Always. This allows the common Javascript pattern of overwriting a prototype method with an bound instance method of the same type: `this.method = this.method.bind(this)`. If we created a new symbol, either because we didn't have a symbol with this name in the symbol table, or we conflicted with an existing symbol, then just add this node as the sole declaration of the new symbol. Otherwise, we'll be merging into a compatible existing symbol (for example when you have multiple 'vars' with the same name in the same container). In this case just add this node into the declarations list of the symbol.
            symbol = a.table_get(symbol_table, name);
            if symbol.is_nil() {
                symbol = self.new_symbol(SymbolFlags::NONE, name);
                a.table_set(symbol_table, name, symbol);
                if is_replaceable_by_method {
                    a.update_symbol(symbol, |s| s.flags |= SymbolFlags::REPLACEABLE_BY_METHOD);
                }
            } else if is_replaceable_by_method
                && !a
                    .sym(symbol)
                    .flags
                    .intersects(SymbolFlags::REPLACEABLE_BY_METHOD)
            {
                // A symbol already exists, so don't add this as a declaration.
                return symbol;
            } else if a.sym(symbol).flags.intersects(excludes) {
                if a.sym(symbol)
                    .flags
                    .intersects(SymbolFlags::REPLACEABLE_BY_METHOD)
                {
                    // Javascript constructor-declared symbols can be discarded in favor of prototype symbols like methods.
                    symbol = self.new_symbol(SymbolFlags::NONE, name);
                    a.table_set(symbol_table, name, symbol);
                } else if !((includes.intersects(SymbolFlags::VARIABLE)
                    && a.sym(symbol).flags.intersects(SymbolFlags::ASSIGNMENT))
                    || (includes.intersects(SymbolFlags::ASSIGNMENT)
                        && a.sym(symbol).flags.intersects(SymbolFlags::VARIABLE)))
                {
                    // Assignment declarations are allowed to merge with variables, no matter what other flags they have. Report errors every position with duplicate declaration. Report errors on previous encountered declarations.
                    let mut message: MessageId = if a
                        .sym(symbol)
                        .flags
                        .intersects(SymbolFlags::BLOCK_SCOPED_VARIABLE)
                    {
                        diagnostics::CANNOT_REDECLARE_BLOCK_SCOPED_VARIABLE_0
                    } else {
                        diagnostics::DUPLICATE_IDENTIFIER_0
                    };
                    let mut message_needs_name = true;
                    if a.sym(symbol).flags.intersects(SymbolFlags::ENUM)
                        || includes.intersects(SymbolFlags::ENUM)
                    {
                        message = diagnostics::ENUM_DECLARATIONS_CAN_ONLY_MERGE_WITH_NAMESPACE_OR_OTHER_ENUM_DECLARATIONS;
                        message_needs_name = false;
                    }
                    let mut multiple_default_exports = false;
                    if a.sym(symbol).declarations.len() != 0 {
                        // If the current node is a default export of some sort, then check if there are any other default exports that we need to error on. We'll know whether we have other default exports depending on if `symbol` already has a declaration list set.
                        if is_default_export {
                            message = diagnostics::A_MODULE_CANNOT_HAVE_MULTIPLE_DEFAULT_EXPORTS;
                            message_needs_name = false;
                            multiple_default_exports = true;
                        } else {
                            // This is to properly report an error in the case "export default { }" is after export default of class declaration or function declaration. Error on multiple export default in the following case: 1. multiple export default of class declaration or function declaration by checking NodeFlags.Default 2. multiple export default of export assignment. This one doesn't have NodeFlags.Default on (as export default doesn't considered as modifiers)
                            if a.sym(symbol).declarations.len() != 0
                                && ast::is_export_assignment(a, node)
                                && !a.as_export_assignment(node).is_export_equals
                            {
                                message =
                                    diagnostics::A_MODULE_CANNOT_HAVE_MULTIPLE_DEFAULT_EXPORTS;
                                message_needs_name = false;
                                multiple_default_exports = true;
                            }
                        }
                    }
                    let mut declaration_name = ast::get_name_of_declaration(a, node);
                    if declaration_name.is_nil() {
                        declaration_name = node;
                    }
                    let diag: DiagnosticId = if message_needs_name {
                        let display_name = self.get_display_name(node);
                        self.create_diagnostic_for_node(
                            declaration_name,
                            message,
                            &[Arg::Str(&display_name)],
                        )
                    } else {
                        self.create_diagnostic_for_node(declaration_name, message, &[])
                    };
                    if ast::is_type_alias_declaration(a, node)
                        && ast::node_is_missing(a, a.type_node(node))
                        && ast::has_syntactic_modifier(a, node, ModifierFlags::EXPORT)
                        && a.sym(symbol).flags.intersects(
                            SymbolFlags::ALIAS | SymbolFlags::TYPE | SymbolFlags::NAMESPACE,
                        )
                    {
                        // export type T; - may have meant export type { T }?
                        let suggestion = [
                            b"export type { ".as_slice(),
                            a.text(a.as_type_alias_declaration(node).name),
                            b" }".as_slice(),
                        ]
                        .concat();
                        let related = self.create_diagnostic_for_node(
                            node,
                            diagnostics::DID_YOU_MEAN_0,
                            &[Arg::Str(&suggestion)],
                        );
                        self.diagnostic_store.add_related_info(diag, related);
                    }
                    let declarations = a.sym(symbol).declarations;
                    for (index, declaration) in declarations.iter().enumerate() {
                        let mut decl = ast::get_name_of_declaration(a, declaration);
                        if decl.is_nil() {
                            decl = declaration;
                        }
                        let d: DiagnosticId = if message_needs_name {
                            let display_name = self.get_display_name(declaration);
                            self.create_diagnostic_for_node(
                                decl,
                                message,
                                &[Arg::Str(&display_name)],
                            )
                        } else {
                            self.create_diagnostic_for_node(decl, message, &[])
                        };
                        if multiple_default_exports {
                            let related = self.create_diagnostic_for_node(
                                declaration_name,
                                if index == 0 {
                                    diagnostics::ANOTHER_EXPORT_DEFAULT_IS_HERE
                                } else {
                                    diagnostics::X_AND_HERE
                                },
                                &[],
                            );
                            self.diagnostic_store.add_related_info(d, related);
                        }
                        self.add_diagnostic(d);
                        if multiple_default_exports {
                            let related = self.create_diagnostic_for_node(
                                decl,
                                diagnostics::THE_FIRST_EXPORT_DEFAULT_IS_HERE,
                                &[],
                            );
                            self.diagnostic_store.add_related_info(diag, related);
                        }
                    }
                    self.add_diagnostic(diag);
                    // When get or set accessor conflicts with a non-accessor or an accessor of a different kind, we mark the symbol as a full accessor such that all subsequent declarations are considered conflicting. This for example ensures that a get accessor followed by a non-accessor followed by a set accessor with the same name are all marked as duplicates.
                    let flags = a.sym(symbol).flags;
                    if flags.intersects(SymbolFlags::ACCESSOR)
                        && (flags & SymbolFlags::ACCESSOR) != (includes & SymbolFlags::ACCESSOR)
                    {
                        a.update_symbol(symbol, |s| s.flags |= SymbolFlags::ACCESSOR);
                    }
                    symbol = self.new_symbol(SymbolFlags::NONE, name);
                }
            }
        }
        self.add_declaration_to_symbol(symbol, node, includes);
        let symbol_parent = a.sym(symbol).parent;
        if symbol_parent.is_nil() {
            a.update_symbol(symbol, |s| s.parent = parent);
        } else if symbol_parent != parent {
            a.fault(
                FaultKind::Panic,
                "Existing symbol parent should match new one",
                0,
                node.0,
            );
        }
        symbol
    }

    // Should not be called on a declaration with a computed property name, unless it is a well known Symbol.
    fn get_declaration_name(&mut self, node: NodeId) -> Text<'a> {
        let a = self.a;
        if ast::is_export_assignment(a, node) {
            return if a.as_export_assignment(node).is_export_equals {
                ast::INTERNAL_SYMBOL_NAME_EXPORT_EQUALS
            } else {
                ast::INTERNAL_SYMBOL_NAME_DEFAULT
            };
        }
        let name = ast::get_name_of_declaration(a, node);
        if !name.is_nil() {
            if ast::is_ambient_module(a, node) {
                let module_name = a.text(name);
                if ast::is_global_scope_augmentation(a, node) {
                    return ast::INTERNAL_SYMBOL_NAME_GLOBAL;
                }
                return self.text(&[b"\"".as_slice(), module_name, b"\"".as_slice()].concat());
            }
            if ast::is_private_identifier(a, name) {
                // containingClass exists because private names only allowed inside classes
                let containing_class = ast::get_containing_class(a, node);
                if containing_class.is_nil() {
                    // we can get here in cases where there is already a parse error.
                    return ast::INTERNAL_SYMBOL_NAME_MISSING;
                }
                return get_symbol_name_for_private_identifier(
                    a,
                    a.symbol(containing_class),
                    a.text(name),
                );
            }
            if ast::is_property_name_literal(a, name) || ast::is_jsx_namespaced_name(a, name) {
                return a.text(name);
            }
            if ast::is_computed_property_name(a, name) {
                let name_expression = a.expression(name);
                // treat computed property names where expression is string/numeric literal as just string/numeric literal
                if ast::is_string_or_numeric_literal_like(a, name_expression) {
                    return a.text(name_expression);
                }
                if ast::is_signed_numeric_literal(a, name_expression) {
                    let unary_expression = a.as_prefix_unary_expression(name_expression);
                    return self.text(
                        &[
                            scanner::token_to_string(unary_expression.operator),
                            a.text(unary_expression.operand),
                        ]
                        .concat(),
                    );
                }
                a.fault(
                    FaultKind::Panic,
                    "Only computed properties with literal names have declaration names",
                    0,
                    node.0,
                );
            }
            return ast::INTERNAL_SYMBOL_NAME_MISSING;
        }
        match a.kind(node) {
            Kind::Constructor => ast::INTERNAL_SYMBOL_NAME_CONSTRUCTOR,
            Kind::FunctionType | Kind::CallSignature => ast::INTERNAL_SYMBOL_NAME_CALL,
            Kind::ConstructorType | Kind::ConstructSignature => ast::INTERNAL_SYMBOL_NAME_NEW,
            Kind::IndexSignature => ast::INTERNAL_SYMBOL_NAME_INDEX,
            Kind::ExportDeclaration => ast::INTERNAL_SYMBOL_NAME_EXPORT_STAR,
            Kind::SourceFile | Kind::BinaryExpression => ast::INTERNAL_SYMBOL_NAME_EXPORT_EQUALS,
            _ => ast::INTERNAL_SYMBOL_NAME_MISSING,
        }
    }

    fn get_display_name(&mut self, node: NodeId) -> Vec<u8> {
        let name_node = self.a.name(node);
        if !name_node.is_nil() {
            return scanner::declaration_name_to_string(self.a, name_node);
        }
        let name = self.get_declaration_name(node);
        if name != ast::INTERNAL_SYMBOL_NAME_MISSING {
            return name.to_vec();
        }
        b"(Missing)".to_vec()
    }
}

pub fn get_symbol_name_for_private_identifier<'a>(
    a: Ast<'a>,
    containing_class_symbol: SymbolId,
    description: &[u8],
) -> Text<'a> {
    let mut name = Vec::new();
    name.extend_from_slice(ast::INTERNAL_SYMBOL_NAME_PREFIX);
    name.push(b'#');
    name.extend_from_slice(
        ast::get_symbol_id(a, containing_class_symbol)
            .to_string()
            .as_bytes(),
    );
    name.push(b'@');
    name.extend_from_slice(description);
    a.open().arena.alloc_slice_copy(&name)
}

impl<'a> Binder<'a> {
    fn declare_module_member(
        &mut self,
        node: NodeId,
        symbol_flags: SymbolFlags,
        symbol_excludes: SymbolFlags,
    ) -> SymbolId {
        let a = self.a;
        let container = self.container;
        let has_export_modifier = ast::get_combined_modifier_flags(a, node)
            .intersects(ModifierFlags::EXPORT)
            || ast::is_implicitly_exported_jsdoc_declaration(a, node);
        if symbol_flags.intersects(SymbolFlags::ALIAS) {
            if a.kind(node) == Kind::ExportSpecifier
                || (a.kind(node) == Kind::ImportEqualsDeclaration && has_export_modifier)
            {
                return self.declare_symbol(
                    ast::get_exports(a, a.symbol(container)),
                    a.symbol(container),
                    node,
                    symbol_flags,
                    symbol_excludes,
                );
            }
            return self.declare_symbol(
                ast::get_locals(a, container),
                SymbolId::NIL,
                node,
                symbol_flags,
                symbol_excludes,
            );
        }
        // Exported module members are given 2 symbols: A local symbol that is classified with an ExportValue flag, and an associated export symbol with all the correct flags set on it. There are 2 main reasons: 1. We treat locals and exports of the same name as mutually exclusive within a container. That means the binder will issue a Duplicate Identifier error if you mix locals and exports with the same name in the same container. 2. When we checkIdentifier in the checker, we set its resolved symbol to the local symbol, but return the export symbol (by calling getExportSymbolOfValueSymbolIfExported). That way when the emitter comes back to it, it knows not to qualify the name if it was found in a containing scope. NOTE: Nested ambient modules always should go to to 'locals' table to prevent their automatic merge during global merging in the checker. Why? The only case when ambient module is permitted inside another module is module augmentation and this case is specially handled. Module augmentations should only be merged with original module definition and should never be merged directly with other augmentation, and the latter case would be possible if automatic merge is allowed.
        if !ast::is_ambient_module(a, node)
            && (has_export_modifier || a.flags(container).intersects(NodeFlags::EXPORT_CONTEXT))
        {
            if !ast::is_locals_container(a, container)
                || (ast::has_syntactic_modifier(a, node, ModifierFlags::DEFAULT)
                    && self.get_declaration_name(node) == ast::INTERNAL_SYMBOL_NAME_MISSING)
            {
                // No local symbol for an unnamed default!
                return self.declare_symbol(
                    ast::get_exports(a, a.symbol(container)),
                    a.symbol(container),
                    node,
                    symbol_flags,
                    symbol_excludes,
                );
            }
            let export_kind = if symbol_flags.intersects(SymbolFlags::VALUE) {
                SymbolFlags::EXPORT_VALUE
            } else {
                SymbolFlags::NONE
            };
            let local = self.declare_symbol(
                ast::get_locals(a, container),
                SymbolId::NIL,
                node,
                export_kind,
                symbol_excludes,
            );
            let export_symbol = self.declare_symbol(
                ast::get_exports(a, a.symbol(container)),
                a.symbol(container),
                node,
                symbol_flags,
                symbol_excludes,
            );
            a.update_symbol(local, |s| s.export_symbol = export_symbol);
            a.set_local_symbol(node, local);
            return local;
        }
        self.declare_symbol(
            ast::get_locals(a, container),
            SymbolId::NIL,
            node,
            symbol_flags,
            symbol_excludes,
        )
    }

    fn declare_class_member(
        &mut self,
        node: NodeId,
        symbol_flags: SymbolFlags,
        symbol_excludes: SymbolFlags,
    ) -> SymbolId {
        let a = self.a;
        let container_symbol = a.symbol(self.container);
        if ast::is_static(a, node) {
            return self.declare_symbol(
                ast::get_exports(a, container_symbol),
                container_symbol,
                node,
                symbol_flags,
                symbol_excludes,
            );
        }
        self.declare_symbol(
            ast::get_members(a, container_symbol),
            container_symbol,
            node,
            symbol_flags,
            symbol_excludes,
        )
    }

    fn declare_source_file_member(
        &mut self,
        node: NodeId,
        symbol_flags: SymbolFlags,
        symbol_excludes: SymbolFlags,
    ) -> SymbolId {
        let a = self.a;
        if ast::is_external_module(a, self.file) {
            return self.declare_module_member(node, symbol_flags, symbol_excludes);
        }
        self.declare_symbol(
            ast::get_locals(a, self.file),
            SymbolId::NIL,
            node,
            symbol_flags,
            symbol_excludes,
        )
    }

    fn declare_symbol_and_add_to_symbol_table(
        &mut self,
        node: NodeId,
        symbol_flags: SymbolFlags,
        symbol_excludes: SymbolFlags,
    ) -> SymbolId {
        let a = self.a;
        let container = self.container;
        match a.kind(container) {
            Kind::ModuleDeclaration => {
                self.declare_module_member(node, symbol_flags, symbol_excludes)
            }
            Kind::SourceFile => {
                self.declare_source_file_member(node, symbol_flags, symbol_excludes)
            }
            Kind::ClassExpression | Kind::ClassDeclaration => {
                self.declare_class_member(node, symbol_flags, symbol_excludes)
            }
            Kind::EnumDeclaration => self.declare_symbol(
                ast::get_exports(a, a.symbol(container)),
                a.symbol(container),
                node,
                symbol_flags,
                symbol_excludes,
            ),
            Kind::TypeLiteral
            | Kind::ObjectLiteralExpression
            | Kind::InterfaceDeclaration
            | Kind::JsxAttributes => self.declare_symbol(
                ast::get_members(a, a.symbol(container)),
                a.symbol(container),
                node,
                symbol_flags,
                symbol_excludes,
            ),
            Kind::FunctionType
            | Kind::ConstructorType
            | Kind::CallSignature
            | Kind::ConstructSignature
            | Kind::IndexSignature
            | Kind::MethodDeclaration
            | Kind::MethodSignature
            | Kind::Constructor
            | Kind::GetAccessor
            | Kind::SetAccessor
            | Kind::FunctionDeclaration
            | Kind::FunctionExpression
            | Kind::ArrowFunction
            | Kind::ClassStaticBlockDeclaration
            | Kind::TypeAliasDeclaration
            | Kind::JSTypeAliasDeclaration
            | Kind::MappedType => self.declare_symbol(
                ast::get_locals(a, container),
                SymbolId::NIL,
                node,
                symbol_flags,
                symbol_excludes,
            ),
            _ => a.unhandled(
                "Unhandled case in declareSymbolAndAddToSymbolTable",
                container,
            ),
        }
    }

    fn new_flow_node(&mut self, flags: FlowFlags) -> FlowNodeId {
        self.a.new_flow_node(flags, NodeId::NIL, FlowNodeId::NIL)
    }

    fn new_flow_node_ex(
        &mut self,
        flags: FlowFlags,
        node: NodeId,
        antecedent: FlowNodeId,
    ) -> FlowNodeId {
        let result = self.new_flow_node(flags);
        self.a.update_flow(result, |f| {
            f.node = node;
            f.antecedent = antecedent;
        });
        result
    }

    fn create_loop_label(&mut self) -> FlowNodeId {
        self.new_flow_node(FlowFlags::LOOP_LABEL)
    }

    fn create_branch_label(&mut self) -> FlowNodeId {
        self.new_flow_node(FlowFlags::BRANCH_LABEL)
    }

    fn create_reduce_label(
        &mut self,
        target: FlowNodeId,
        antecedents: FlowListId,
        antecedent: FlowNodeId,
    ) -> FlowNodeId {
        let data = ast::new_flow_reduce_label_data(self.a, target, antecedents);
        self.new_flow_node_ex(FlowFlags::REDUCE_LABEL, data, antecedent)
    }

    fn create_flow_condition(
        &mut self,
        flags: FlowFlags,
        antecedent: FlowNodeId,
        expression: NodeId,
    ) -> FlowNodeId {
        let a = self.a;
        if a.flow(antecedent).flags.intersects(FlowFlags::UNREACHABLE) {
            return antecedent;
        }
        if expression.is_nil() {
            if flags.intersects(FlowFlags::TRUE_CONDITION) {
                return antecedent;
            }
            return self.unreachable_flow;
        }
        if ((a.kind(expression) == Kind::TrueKeyword
            && flags.intersects(FlowFlags::FALSE_CONDITION))
            || (a.kind(expression) == Kind::FalseKeyword
                && flags.intersects(FlowFlags::TRUE_CONDITION)))
            && !ast::is_expression_of_optional_chain_root(a, expression)
            && !ast::is_nullish_coalesce(a, a.parent(expression))
        {
            return self.unreachable_flow;
        }
        if !is_narrowing_expression(a, self.stack_check, expression) {
            return antecedent;
        }
        set_flow_node_referenced(a, antecedent);
        self.new_flow_node_ex(flags, expression, antecedent)
    }

    fn create_flow_mutation(
        &mut self,
        flags: FlowFlags,
        antecedent: FlowNodeId,
        node: NodeId,
    ) -> FlowNodeId {
        set_flow_node_referenced(self.a, antecedent);
        self.has_flow_effects = true;
        let result = self.new_flow_node_ex(flags, node, antecedent);
        if !self.current_exception_target.is_nil() {
            self.add_antecedent(self.current_exception_target, result);
        }
        result
    }

    fn create_flow_switch_clause(
        &mut self,
        antecedent: FlowNodeId,
        switch_statement: NodeId,
        clause_start: isize,
        clause_end: isize,
    ) -> FlowNodeId {
        set_flow_node_referenced(self.a, antecedent);
        let data =
            ast::new_flow_switch_clause_data(self.a, switch_statement, clause_start, clause_end);
        self.new_flow_node_ex(FlowFlags::SWITCH_CLAUSE, data, antecedent)
    }

    fn create_flow_call(&mut self, antecedent: FlowNodeId, node: NodeId) -> FlowNodeId {
        set_flow_node_referenced(self.a, antecedent);
        self.has_flow_effects = true;
        self.new_flow_node_ex(FlowFlags::CALL, node, antecedent)
    }

    fn new_flow_list(&mut self, head: FlowNodeId, tail: FlowListId) -> FlowListId {
        self.a.new_flow_list(head, tail)
    }

    fn combine_flow_lists(&mut self, head: FlowListId, tail: FlowListId) -> FlowListId {
        if head.is_nil() {
            return tail;
        }
        if !self.stack_check.is_safe_to_recurse() {
            stack_limit(self.a, head.0);
            return tail;
        }
        let list = self.a.flow_list(head);
        let rest = self.combine_flow_lists(list.next, tail);
        self.new_flow_list(list.flow, rest)
    }

    fn new_single_declaration(&mut self, declaration: NodeId) -> List<'a, NodeId> {
        self.list_of(&[declaration])
    }
}

fn set_flow_node_referenced(a: Ast<'_>, flow: FlowNodeId) {
    // On first reference we set the Referenced flag, thereafter we set the Shared flag
    if !a.flow(flow).flags.intersects(FlowFlags::REFERENCED) {
        a.update_flow(flow, |f| f.flags |= FlowFlags::REFERENCED);
    } else {
        a.update_flow(flow, |f| f.flags |= FlowFlags::SHARED);
    }
}

impl<'a> Binder<'a> {
    fn add_antecedent(&mut self, label: FlowNodeId, antecedent: FlowNodeId) {
        let a = self.a;
        if a.flow(antecedent).flags.intersects(FlowFlags::UNREACHABLE) {
            return;
        }
        // If antecedent isn't already on the Antecedents list, add it to the end of the list
        let mut last = FlowListId::NIL;
        let mut list = a.flow(label).antecedents;
        while !list.is_nil() {
            if a.flow_list(list).flow == antecedent {
                return;
            }
            last = list;
            list = a.flow_list(list).next;
        }
        if last.is_nil() {
            let antecedents = self.new_flow_list(antecedent, FlowListId::NIL);
            a.update_flow(label, |f| f.antecedents = antecedents);
        } else {
            let next = self.new_flow_list(antecedent, FlowListId::NIL);
            a.update_flow_list(last, |l| l.next = next);
        }
        set_flow_node_referenced(a, antecedent);
    }

    fn finish_flow_label(&mut self, label: FlowNodeId) -> FlowNodeId {
        let a = self.a;
        let antecedents = a.flow(label).antecedents;
        if antecedents.is_nil() {
            return self.unreachable_flow;
        }
        if a.flow_list(antecedents).next.is_nil() {
            return a.flow_list(antecedents).flow;
        }
        label
    }

    fn bind(&mut self, node: NodeId) -> bool {
        if node.is_nil() {
            return false;
        }
        let a = self.a;
        if !self.stack_check.is_safe_to_recurse() {
            stack_limit(a, node.0);
            return false;
        }
        // Even though in the AST the jsdoc @typedef node belongs to the current node, its symbol might be in the same scope with the current node's symbol. Consider `/** @typedef {string | number} MyType */ function foo();`. Here the current node is "foo", which is a container, but the scope of "MyType" should not be inside "foo". Therefore we always bind @typedef before bind the parent node, and skip binding this tag later when binding all the other jsdoc tags.

        // First we bind declaration nodes to a symbol if possible. We'll both create a symbol and then potentially add the symbol to an appropriate symbol table. Possible destination symbol tables are: 1) The 'exports' table of the current container's symbol. 2) The 'members' table of the current container's symbol. 3) The 'locals' table of the current container. However, not all symbols will end up in any of these tables. 'Anonymous' symbols (like TypeLiterals for example) will not be put in any table.
        let kind = a.kind(node);
        match kind {
            Kind::Identifier => {
                a.set_flow_node(node, self.current_flow);
                self.check_contextual_identifier(node);
            }
            Kind::ThisKeyword | Kind::SuperKeyword => {
                if kind == Kind::ThisKeyword {
                    self.seen_this_keyword = true;
                }
                a.set_flow_node(node, self.current_flow);
            }
            Kind::QualifiedName => {
                if !self.current_flow.is_nil() && ast::is_part_of_type_query(a, node) {
                    a.set_flow_node(node, self.current_flow);
                }
            }
            Kind::MetaProperty => {
                a.set_flow_node(node, self.current_flow);
            }
            Kind::PrivateIdentifier => {
                self.check_private_identifier(node);
            }
            Kind::PropertyAccessExpression | Kind::ElementAccessExpression => {
                if !self.current_flow.is_nil() && is_narrowable_reference(a, self.stack_check, node)
                {
                    set_flow_node(a, node, self.current_flow);
                }
            }
            Kind::BinaryExpression => {
                match ast::get_assignment_declaration_kind(a, node) {
                    JSDeclarationKind::MODULE_EXPORTS => self.bind_module_exports_assignment(node),
                    JSDeclarationKind::EXPORTS_PROPERTY => {
                        self.bind_exports_or_object_define_property(node)
                    }
                    JSDeclarationKind::PROPERTY => self.bind_expando_property_assignment(node),
                    JSDeclarationKind::THIS_PROPERTY => self.bind_this_property_assignment(node),
                    _ => {}
                }
                self.check_strict_mode_binary_expression(node);
            }
            Kind::CatchClause => {
                self.check_strict_mode_catch_clause(node);
            }
            Kind::DeleteExpression => {
                self.check_strict_mode_delete_expression(node);
            }
            Kind::PostfixUnaryExpression => {
                self.check_strict_mode_postfix_unary_expression(node);
            }
            Kind::PrefixUnaryExpression => {
                self.check_strict_mode_prefix_unary_expression(node);
            }
            Kind::WithStatement => {
                self.check_strict_mode_with_statement(node);
            }
            Kind::LabeledStatement => {
                self.check_strict_mode_labeled_statement(node);
            }
            Kind::ThisType => {
                self.seen_this_keyword = true;
            }
            Kind::TypeParameter => {
                self.bind_type_parameter(node);
            }
            Kind::Parameter => {
                self.bind_parameter(node);
            }
            Kind::VariableDeclaration => {
                self.bind_variable_declaration_or_binding_element(node);
            }
            Kind::BindingElement => {
                a.set_flow_node(node, self.current_flow);
                self.bind_variable_declaration_or_binding_element(node);
            }
            Kind::PropertyDeclaration | Kind::PropertySignature => {
                self.bind_property_worker(node);
            }
            Kind::PropertyAssignment | Kind::ShorthandPropertyAssignment => {
                self.bind_property_or_method_or_accessor(
                    node,
                    SymbolFlags::PROPERTY,
                    SymbolFlags::PROPERTY_EXCLUDES,
                );
            }
            Kind::EnumMember => {
                self.bind_property_or_method_or_accessor(
                    node,
                    SymbolFlags::ENUM_MEMBER,
                    SymbolFlags::ENUM_MEMBER_EXCLUDES,
                );
            }
            Kind::CallSignature | Kind::ConstructSignature | Kind::IndexSignature => {
                self.declare_symbol_and_add_to_symbol_table(
                    node,
                    SymbolFlags::SIGNATURE,
                    SymbolFlags::NONE,
                );
            }
            Kind::MethodDeclaration | Kind::MethodSignature => {
                self.bind_property_or_method_or_accessor(
                    node,
                    SymbolFlags::METHOD | get_optional_symbol_flag_for_node(a, node),
                    if ast::is_object_literal_method(a, node) {
                        SymbolFlags::VALUE
                    } else {
                        SymbolFlags::METHOD_EXCLUDES
                    },
                );
            }
            Kind::FunctionDeclaration => {
                self.bind_function_declaration(node);
            }
            Kind::Constructor => {
                self.declare_symbol_and_add_to_symbol_table(
                    node,
                    SymbolFlags::CONSTRUCTOR,
                    SymbolFlags::NONE,
                );
            }
            Kind::GetAccessor => {
                self.bind_property_or_method_or_accessor(
                    node,
                    SymbolFlags::GET_ACCESSOR,
                    SymbolFlags::GET_ACCESSOR_EXCLUDES,
                );
            }
            Kind::SetAccessor => {
                self.bind_property_or_method_or_accessor(
                    node,
                    SymbolFlags::SET_ACCESSOR,
                    SymbolFlags::SET_ACCESSOR_EXCLUDES,
                );
            }
            Kind::FunctionType | Kind::ConstructorType => {
                self.bind_function_or_constructor_type(node);
            }
            Kind::TypeLiteral | Kind::MappedType => {
                self.bind_anonymous_declaration(
                    node,
                    SymbolFlags::TYPE_LITERAL,
                    ast::INTERNAL_SYMBOL_NAME_TYPE,
                );
            }
            Kind::ObjectLiteralExpression => {
                self.bind_anonymous_declaration(
                    node,
                    SymbolFlags::OBJECT_LITERAL,
                    ast::INTERNAL_SYMBOL_NAME_OBJECT,
                );
            }
            Kind::FunctionExpression | Kind::ArrowFunction => {
                self.bind_function_expression(node);
            }
            Kind::ClassExpression | Kind::ClassDeclaration => {
                self.bind_class_like_declaration(node);
            }
            Kind::InterfaceDeclaration => {
                self.bind_block_scoped_declaration(
                    node,
                    SymbolFlags::INTERFACE,
                    SymbolFlags::INTERFACE_EXCLUDES,
                );
            }
            Kind::CallExpression => {
                match ast::get_assignment_declaration_kind(a, node) {
                    JSDeclarationKind::OBJECT_DEFINE_PROPERTY_VALUE => {
                        self.bind_expando_property_assignment(node)
                    }
                    JSDeclarationKind::OBJECT_DEFINE_PROPERTY_EXPORTS => {
                        self.bind_exports_or_object_define_property(node)
                    }
                    _ => {}
                }
                if ast::is_in_js_file(a, node) {
                    self.bind_call_expression(node);
                }
            }
            Kind::TypeAliasDeclaration => {
                self.bind_block_scoped_declaration(
                    node,
                    SymbolFlags::TYPE_ALIAS,
                    SymbolFlags::TYPE_ALIAS_EXCLUDES,
                );
            }
            Kind::JSTypeAliasDeclaration => {
                // Top-level JSTypeAliasDeclaration nodes are processed in bindContainer
                if !ast::is_source_file(a, self.block_scope_container) {
                    self.bind_block_scoped_declaration(
                        node,
                        SymbolFlags::TYPE_ALIAS,
                        SymbolFlags::TYPE_ALIAS_EXCLUDES,
                    );
                }
            }
            Kind::EnumDeclaration => {
                self.bind_enum_declaration(node);
            }
            Kind::ModuleDeclaration => {
                self.bind_module_declaration(node);
            }
            Kind::ImportEqualsDeclaration
            | Kind::NamespaceImport
            | Kind::ImportSpecifier
            | Kind::ExportSpecifier => {
                self.declare_symbol_and_add_to_symbol_table(
                    node,
                    SymbolFlags::ALIAS,
                    SymbolFlags::ALIAS_EXCLUDES,
                );
            }
            Kind::NamespaceExportDeclaration => {
                self.bind_namespace_export_declaration(node);
            }
            Kind::ImportClause => {
                self.bind_import_clause(node);
            }
            Kind::ExportDeclaration => {
                self.bind_export_declaration(node);
            }
            Kind::ExportAssignment => {
                self.bind_export_assignment(node);
            }
            Kind::SourceFile => {
                self.bind_source_file_if_external_module();
            }
            Kind::JsxAttributes => {
                self.bind_jsx_attributes(node);
            }
            Kind::JsxAttribute => {
                self.bind_jsx_attribute(
                    node,
                    SymbolFlags::PROPERTY,
                    SymbolFlags::PROPERTY_EXCLUDES,
                );
            }
            _ => {}
        }
        // Then we recurse into the children of the node to bind them as well. For certain symbols we do specialized work when we recurse. For example, we'll keep track of the current 'container' node when it changes. This helps us know which symbol table a local should go into for example. Since terminal nodes are known not to have children, as an optimization we don't process those.
        let mut this_node_or_any_subnodes_has_error =
            a.flags(node).intersects(NodeFlags::THIS_NODE_HAS_ERROR);
        if kind > Kind::LAST_TOKEN {
            let save_seen_parse_error = self.seen_parse_error;
            self.seen_parse_error = false;
            let container_flags = get_container_flags(a, node);
            if container_flags == ContainerFlags::NONE {
                self.bind_children(node);
            } else {
                self.bind_container(node, container_flags);
            }
            if self.seen_parse_error {
                this_node_or_any_subnodes_has_error = true;
            }
            self.seen_parse_error = save_seen_parse_error;
        }
        if this_node_or_any_subnodes_has_error {
            a.set_flags(
                node,
                a.flags(node) | NodeFlags::THIS_NODE_OR_ANY_SUB_NODES_HAS_ERROR,
            );
            self.seen_parse_error = true;
        }
        false
    }

    fn bind_property_worker(&mut self, node: NodeId) {
        let a = self.a;
        let is_auto_accessor = ast::is_auto_accessor_property_declaration(a, node);
        let includes = if is_auto_accessor {
            SymbolFlags::ACCESSOR
        } else {
            SymbolFlags::PROPERTY
        };
        let excludes = if is_auto_accessor {
            SymbolFlags::ACCESSOR_EXCLUDES
        } else {
            SymbolFlags::PROPERTY_EXCLUDES
        };
        self.bind_property_or_method_or_accessor(
            node,
            includes | get_optional_symbol_flag_for_node(a, node),
            excludes,
        );
    }

    fn bind_source_file_if_external_module(&mut self) {
        let a = self.a;
        self.set_export_context_flag(self.file);
        if ast::is_external_or_common_js_module(a, self.file) {
            self.bind_source_file_as_external_module();
        } else if ast::is_json_source_file(a, self.file) {
            self.bind_source_file_as_external_module();
            // Create symbol equivalent for the module.exports = {}
            let original_symbol = a.symbol(self.file);
            self.declare_symbol(
                ast::get_exports(a, original_symbol),
                original_symbol,
                self.file,
                SymbolFlags::PROPERTY,
                SymbolFlags::ALL,
            );
            a.set_symbol(self.file, original_symbol);
        }
    }

    fn bind_source_file_as_external_module(&mut self) {
        let a = self.a;
        let name = self.text(
            &[
                b"\"".as_slice(),
                tspath::remove_file_extension(a.as_source_file(self.file).file_name()),
                b"\"".as_slice(),
            ]
            .concat(),
        );
        self.bind_anonymous_declaration(self.file, SymbolFlags::VALUE_MODULE, name);
    }

    fn bind_module_declaration(&mut self, node: NodeId) {
        let a = self.a;
        self.set_export_context_flag(node);
        if ast::is_ambient_module(a, node) {
            if ast::has_syntactic_modifier(a, node, ModifierFlags::EXPORT) {
                self.error_on_first_token(node, diagnostics::X_EXPORT_MODIFIER_CANNOT_BE_APPLIED_TO_AMBIENT_MODULES_AND_MODULE_AUGMENTATIONS_SINCE_THEY_ARE_ALWAYS_VISIBLE, &[]);
            }
            if ast::is_module_augmentation_external(a, node) {
                self.declare_module_symbol(node);
            } else {
                let name = a.as_module_declaration(node).name;
                let symbol = self.declare_symbol_and_add_to_symbol_table(
                    node,
                    SymbolFlags::VALUE_MODULE,
                    SymbolFlags::VALUE_MODULE_EXCLUDES,
                );

                if ast::is_string_literal(a, name) {
                    let pattern = core::try_parse_pattern(a.text(name));
                    if !pattern.is_valid() {
                        // An invalid pattern - must have multiple wildcards.
                        self.error_on_first_token(
                            name,
                            diagnostics::PATTERN_0_CAN_HAVE_AT_MOST_ONE_ASTERISK_CHARACTER,
                            &[Arg::Str(a.text(name))],
                        );
                    } else if pattern.star_index >= 0 {
                        self.pattern_ambient_modules
                            .push(PatternAmbientModule { pattern, symbol });
                    }
                }
            }
        } else {
            let state = self.declare_module_symbol(node);
            if state != ModuleInstanceState::NON_INSTANTIATED {
                let symbol = a.symbol(node);
                // if module was already merged with some function, class or non-const enum, treat it as non-const-enum-only
                let const_enum_only_module = !a.sym(symbol).flags.intersects(
                    SymbolFlags::FUNCTION | SymbolFlags::CLASS | SymbolFlags::REGULAR_ENUM,
                )
                    // Current must be `const enum` only
                    && state == ModuleInstanceState::CONST_ENUM_ONLY
                    // Can't have been set to 'false' in a previous merged symbol. ('undefined' OK)
                    && !self.not_const_enum_only_modules.has(&symbol);
                if const_enum_only_module {
                    a.update_symbol(symbol, |s| s.flags |= SymbolFlags::CONST_ENUM_ONLY_MODULE);
                } else {
                    a.update_symbol(symbol, |s| {
                        s.flags = s.flags.without(SymbolFlags::CONST_ENUM_ONLY_MODULE);
                    });
                    self.not_const_enum_only_modules.add(symbol);
                }
            }
        }
    }

    fn declare_module_symbol(&mut self, node: NodeId) -> ModuleInstanceState {
        let state = ast::get_module_instance_state_exported(self.a, node);
        let instantiated = state != ModuleInstanceState::NON_INSTANTIATED;
        self.declare_symbol_and_add_to_symbol_table(
            node,
            if instantiated {
                SymbolFlags::VALUE_MODULE
            } else {
                SymbolFlags::NAMESPACE_MODULE
            },
            if instantiated {
                SymbolFlags::VALUE_MODULE_EXCLUDES
            } else {
                SymbolFlags::NAMESPACE_MODULE_EXCLUDES
            },
        );
        state
    }

    fn bind_namespace_export_declaration(&mut self, node: NodeId) {
        let a = self.a;
        if !a.modifiers(node).is_nil() {
            self.error_on_node(node, diagnostics::MODIFIERS_CANNOT_APPEAR_HERE, &[]);
        }
        if !ast::is_source_file(a, a.parent(node)) {
            self.error_on_node(
                node,
                diagnostics::GLOBAL_MODULE_EXPORTS_MAY_ONLY_APPEAR_AT_TOP_LEVEL,
                &[],
            );
        } else if !ast::is_external_module(a, a.parent(node)) {
            self.error_on_node(
                node,
                diagnostics::GLOBAL_MODULE_EXPORTS_MAY_ONLY_APPEAR_IN_MODULE_FILES,
                &[],
            );
        } else if !a.as_source_file(a.parent(node)).is_declaration_file {
            self.error_on_node(
                node,
                diagnostics::GLOBAL_MODULE_EXPORTS_MAY_ONLY_APPEAR_IN_DECLARATION_FILES,
                &[],
            );
        } else {
            let mut global_exports = a.as_source_file(self.file).global_exports;
            if global_exports.is_nil() {
                let table = ast::get_symbol_table(a, &mut global_exports);
                a.set_global_exports(self.file, table);
            }
            self.declare_symbol(
                global_exports,
                a.symbol(self.file),
                node,
                SymbolFlags::ALIAS,
                SymbolFlags::ALIAS_EXCLUDES,
            );
        }
    }

    fn bind_import_clause(&mut self, node: NodeId) {
        if !self.a.as_import_clause(node).name.is_nil() {
            self.declare_symbol_and_add_to_symbol_table(
                node,
                SymbolFlags::ALIAS,
                SymbolFlags::ALIAS_EXCLUDES,
            );
        }
    }

    fn bind_export_declaration(&mut self, node: NodeId) {
        let a = self.a;
        let decl = a.as_export_declaration(node);
        let container_symbol = a.symbol(self.container);
        if container_symbol.is_nil() {
            // Export * in some sort of block construct
            let name = self.get_declaration_name(node);
            self.bind_anonymous_declaration(node, SymbolFlags::EXPORT_STAR, name);
        } else if decl.export_clause.is_nil() {
            // All export * declarations are collected in an __export symbol
            self.declare_symbol(
                ast::get_exports(a, container_symbol),
                container_symbol,
                node,
                SymbolFlags::EXPORT_STAR,
                SymbolFlags::NONE,
            );
        } else if ast::is_namespace_export(a, decl.export_clause) {
            self.declare_symbol(
                ast::get_exports(a, container_symbol),
                container_symbol,
                decl.export_clause,
                SymbolFlags::ALIAS,
                SymbolFlags::ALIAS_EXCLUDES,
            );
        }
    }

    fn bind_export_assignment(&mut self, node: NodeId) {
        let a = self.a;
        let container = self.container;
        if a.symbol(container).is_nil() && ast::is_export_assignment(a, node) {
            // Incorrect export assignment in some sort of block construct
            let name = self.get_declaration_name(node);
            self.bind_anonymous_declaration(node, SymbolFlags::VALUE, name);
        } else {
            // If there is an `export default x;` alias declaration, can't `export default` anything else. (In contrast, you can still have `export default function f() {}` and `export default interface I {}`.)
            let flags = if ast::expression_is_alias(a, a.expression(node)) {
                SymbolFlags::ALIAS
            } else {
                SymbolFlags::PROPERTY
            };
            let symbol = self.declare_symbol(
                ast::get_exports(a, a.symbol(container)),
                a.symbol(container),
                node,
                flags,
                SymbolFlags::ALL,
            );
            if a.as_export_assignment(node).is_export_equals {
                // Ensure export assignments have a ValueDeclaration set.
                set_value_declaration(a, symbol, node);
            }
        }
    }

    fn bind_jsx_attributes(&mut self, node: NodeId) {
        self.bind_anonymous_declaration(
            node,
            SymbolFlags::OBJECT_LITERAL,
            ast::INTERNAL_SYMBOL_NAME_JSX_ATTRIBUTES,
        );
    }

    fn bind_jsx_attribute(
        &mut self,
        node: NodeId,
        symbol_flags: SymbolFlags,
        symbol_excludes: SymbolFlags,
    ) {
        self.declare_symbol_and_add_to_symbol_table(node, symbol_flags, symbol_excludes);
    }

    fn set_export_context_flag(&mut self, node: NodeId) {
        let a = self.a;
        // A declaration source file or ambient module declaration that contains no export declarations (but possibly regular declarations with export modifiers) is an export context in which declarations are implicitly exported.
        if a.flags(node).intersects(NodeFlags::AMBIENT) && !self.has_export_declarations(node) {
            a.set_flags(node, a.flags(node) | NodeFlags::EXPORT_CONTEXT);
        } else {
            a.set_flags(node, a.flags(node).without(NodeFlags::EXPORT_CONTEXT));
        }
    }

    fn has_export_declarations(&self, node: NodeId) -> bool {
        let a = self.a;
        let mut statements: List<'a, NodeId> = List::NIL;
        match a.kind(node) {
            Kind::SourceFile => {
                statements = a.statements(node);
            }
            Kind::ModuleDeclaration => {
                let body = a.body(node);
                if !body.is_nil() && ast::is_module_block(a, body) {
                    statements = a.statements(body);
                }
            }
            _ => {}
        }
        core::some(statements.as_slice(), |s| {
            ast::is_export_declaration(a, s) || ast::is_export_assignment(a, s)
        })
    }

    fn bind_function_expression(&mut self, node: NodeId) {
        let a = self.a;
        if !a.as_source_file(self.file).is_declaration_file
            && !a.flags(node).intersects(NodeFlags::AMBIENT)
            && ast::is_async_function(a, node)
        {
            self.emit_flags |= NodeFlags::HAS_ASYNC_FUNCTIONS;
        }
        set_flow_node(a, node, self.current_flow);
        let mut binding_name = ast::INTERNAL_SYMBOL_NAME_FUNCTION;
        if ast::is_function_expression(a, node) && !a.as_function_expression(node).name.is_nil() {
            self.check_strict_mode_function_name(node);
            binding_name = a.text(a.as_function_expression(node).name);
        }
        self.bind_anonymous_declaration(node, SymbolFlags::FUNCTION, binding_name);
    }

    fn bind_call_expression(&mut self, node: NodeId) {
        let a = self.a;
        // We're only inspecting call expressions to detect CommonJS modules, so we can skip this check if we've already seen the module indicator
        if a.as_source_file(self.file)
            .common_js_module_indicator
            .is_nil()
            && ast::is_require_call(a, node, false)
        {
            self.set_common_js_module_indicator(node);
        }
    }

    fn set_common_js_module_indicator(&mut self, node: NodeId) -> bool {
        let a = self.a;
        let external_module_indicator = a.as_source_file(self.file).external_module_indicator;
        if !external_module_indicator.is_nil() && external_module_indicator != self.file {
            return false;
        }
        if a.as_source_file(self.file)
            .common_js_module_indicator
            .is_nil()
        {
            a.set_common_js_module_indicator(self.file, node);
            if external_module_indicator.is_nil() {
                self.bind_source_file_as_external_module();
            }
        }
        true
    }

    fn bind_class_like_declaration(&mut self, node: NodeId) {
        let a = self.a;
        let name = a.name(node);
        match a.kind(node) {
            Kind::ClassDeclaration => {
                self.bind_block_scoped_declaration(
                    node,
                    SymbolFlags::CLASS,
                    SymbolFlags::CLASS_EXCLUDES,
                );
            }
            Kind::ClassExpression => {
                let mut name_text = ast::INTERNAL_SYMBOL_NAME_CLASS;
                if !name.is_nil() {
                    name_text = a.text(name);
                }
                self.bind_anonymous_declaration(node, SymbolFlags::CLASS, name_text);
            }
            _ => {}
        }
        let symbol = a.symbol(node);
        // TypeScript 1.0 spec (April 2014): 8.4 Every class automatically contains a static property member named 'prototype', the type of which is an instantiation of the class type with type Any supplied as a type argument for each type parameter. It is an error to explicitly declare a static property member with the name 'prototype'. Note: we check for this here because this class may be merging into a module. The module might have an exported variable called 'prototype'. We can't allow that as that would clash with the built-in 'prototype' for the class.
        let prototype_symbol =
            self.new_symbol(SymbolFlags::PROPERTY | SymbolFlags::PROTOTYPE, b"prototype");
        let prototype_name = a.sym(prototype_symbol).name;
        let symbol_export = a.table_get(ast::get_exports(a, symbol), prototype_name);
        if !symbol_export.is_nil() {
            self.error_on_node(
                a.sym(symbol_export).declarations.at(0usize),
                diagnostics::DUPLICATE_IDENTIFIER_0,
                &[Arg::Str(ast::symbol_name(a, prototype_symbol))],
            );
        }
        a.table_set(
            ast::get_exports(a, symbol),
            prototype_name,
            prototype_symbol,
        );
        a.update_symbol(prototype_symbol, |s| s.parent = symbol);
    }

    fn bind_property_or_method_or_accessor(
        &mut self,
        node: NodeId,
        symbol_flags: SymbolFlags,
        symbol_excludes: SymbolFlags,
    ) {
        let a = self.a;
        if !a.as_source_file(self.file).is_declaration_file
            && !a.flags(node).intersects(NodeFlags::AMBIENT)
            && ast::is_async_function(a, node)
        {
            self.emit_flags |= NodeFlags::HAS_ASYNC_FUNCTIONS;
        }
        if !self.current_flow.is_nil()
            && ast::is_object_literal_or_class_expression_method_or_accessor(a, node)
        {
            set_flow_node(a, node, self.current_flow);
        }
        if ast::has_dynamic_name(a, node) {
            self.bind_anonymous_declaration(node, symbol_flags, ast::INTERNAL_SYMBOL_NAME_COMPUTED);
        } else {
            self.declare_symbol_and_add_to_symbol_table(node, symbol_flags, symbol_excludes);
        }
    }

    fn bind_function_or_constructor_type(&mut self, node: NodeId) {
        let a = self.a;
        // For a given function symbol "<...>(...) => T" we want to generate a symbol identical to the one we would get for: { <...>(...): T }. We do that by making an anonymous type literal symbol, and then setting the function symbol as its sole member. To the rest of the system, this symbol will be indistinguishable from an actual type literal symbol you would have gotten had you used the long form.
        let name = self.get_declaration_name(node);
        let symbol = self.new_symbol(SymbolFlags::SIGNATURE, name);
        self.add_declaration_to_symbol(symbol, node, SymbolFlags::SIGNATURE);
        let type_literal_symbol =
            self.new_symbol(SymbolFlags::TYPE_LITERAL, ast::INTERNAL_SYMBOL_NAME_TYPE);
        self.add_declaration_to_symbol(type_literal_symbol, node, SymbolFlags::TYPE_LITERAL);
        let members = a.new_table();
        a.update_symbol(type_literal_symbol, |s| s.members = members);
        a.table_set(members, a.sym(symbol).name, symbol);
    }

    fn add_late_bound_assignment_declaration_to_symbol(&mut self, node: NodeId, symbol: SymbolId) {
        let a = self.a;
        let exports = ast::get_exports(a, symbol);
        let mut assignment_symbol =
            a.table_get(exports, ast::INTERNAL_SYMBOL_NAME_ASSIGNMENT_DECLARATION);
        if assignment_symbol.is_nil() {
            assignment_symbol = self.new_symbol(
                SymbolFlags::NONE,
                ast::INTERNAL_SYMBOL_NAME_ASSIGNMENT_DECLARATION,
            );
            a.table_set(
                exports,
                ast::INTERNAL_SYMBOL_NAME_ASSIGNMENT_DECLARATION,
                assignment_symbol,
            );
        }
        let mut declarations = a.sym(assignment_symbol).declarations.as_slice().to_vec();
        declarations.push(node);
        let declarations = self.list_of(&declarations);
        a.update_symbol(assignment_symbol, |s| s.declarations = declarations);
    }

    fn bind_module_exports_assignment(&mut self, node: NodeId) {
        let a = self.a;
        if self.set_common_js_module_indicator(node) {
            let container = self.file;
            let flags = if ast::expression_is_alias(a, a.as_binary_expression(node).right) {
                SymbolFlags::ALIAS
            } else {
                SymbolFlags::PROPERTY
            };
            let symbol = self.declare_symbol(
                ast::get_exports(a, a.symbol(container)),
                a.symbol(container),
                node,
                flags,
                SymbolFlags::NONE,
            );
            set_value_declaration(a, symbol, node);
        }
    }

    fn bind_expando_property_assignment(&mut self, node: NodeId) {
        self.expando_assignments.push(ExpandoAssignmentInfo {
            node,
            container: self.container,
            block_scope_container: self.block_scope_container,
        });
    }

    fn bind_deferred_expando_assignments(&mut self) {
        for index in 0..self.expando_assignments.len() {
            let Some(info) = self.expando_assignments.get(index).copied() else {
                break;
            };
            self.container = info.container;
            self.block_scope_container = info.block_scope_container;
            self.bind_deferred_expando_assignment(info.node);
        }
    }

    // If the given module symbol has an export= symbol, promote exports with a type or namespace meaning from the module symbol onto the export= symbol and, if any such exports exist, mark the export= symbol as a namespace module.
    fn bind_common_js_type_exports(&mut self, module_symbol: SymbolId) {
        let a = self.a;
        let module_exports = a.sym(module_symbol).exports;
        let export_equals = a.table_get(module_exports, ast::INTERNAL_SYMBOL_NAME_EXPORT_EQUALS);
        if !export_equals.is_nil() {
            // Upstream ranges over a Go map: the order here is the order in which the exports were declared.
            let mut position = 0;
            while let Some((_, symbol)) = a.table_entry_at(module_exports, position) {
                position += 1;
                let s = a.sym(symbol);
                if s.name != ast::INTERNAL_SYMBOL_NAME_EXPORT_EQUALS
                    && s.flags
                        .intersects(SymbolFlags::TYPE | SymbolFlags::NAMESPACE)
                {
                    a.table_set(ast::get_exports(a, export_equals), s.name, symbol);
                    a.update_symbol(export_equals, |e| e.flags |= SymbolFlags::NAMESPACE_MODULE);
                }
            }
        }
    }

    fn bind_deferred_expando_assignment(&mut self, node: NodeId) {
        let a = self.a;
        let parent = get_parent_of_property_assignment(a, node);
        let mut symbol = self.lookup_entity(parent, self.block_scope_container);
        if symbol.is_nil() {
            symbol = self.lookup_entity(parent, self.container);
        }
        symbol = get_initializer_symbol(a, symbol);
        if !symbol.is_nil() {
            if ast::has_dynamic_name(a, node) {
                self.bind_anonymous_declaration(
                    node,
                    SymbolFlags::PROPERTY | SymbolFlags::ASSIGNMENT,
                    ast::INTERNAL_SYMBOL_NAME_COMPUTED,
                );
                self.add_late_bound_assignment_declaration_to_symbol(node, symbol);
            } else {
                // We declare expandos only when there are no non-expando declarations for that name.
                let exports = ast::get_exports(a, symbol);
                let name = self.get_declaration_name(node);
                let existing = a.table_get(exports, name);
                if existing.is_nil() || a.sym(existing).flags.intersects(SymbolFlags::ASSIGNMENT) {
                    self.declare_symbol(
                        exports,
                        symbol,
                        node,
                        SymbolFlags::PROPERTY | SymbolFlags::ASSIGNMENT,
                        SymbolFlags::PROPERTY_EXCLUDES,
                    );
                }
            }
        }
    }
}

fn get_parent_of_property_assignment(a: Ast<'_>, node: NodeId) -> NodeId {
    match a.kind(node) {
        Kind::BinaryExpression => a.expression(a.as_binary_expression(node).left),
        Kind::CallExpression => a.arguments(node).at(0usize),
        _ => a.unhandled("Unhandled case in getParentOfPropertyAssignment", node),
    }
}

impl<'a> Binder<'a> {
    fn bind_exports_or_object_define_property(&mut self, node: NodeId) {
        let a = self.a;
        if self.set_common_js_module_indicator(node) {
            let container = self.file;
            let flags = if ast::is_binary_expression(a, node)
                && ast::expression_is_alias(a, a.as_binary_expression(node).right)
            {
                SymbolFlags::ALIAS
            } else {
                SymbolFlags::FUNCTION_SCOPED_VARIABLE
            };
            self.declare_symbol(
                ast::get_exports(a, a.symbol(container)),
                a.symbol(container),
                node,
                flags,
                SymbolFlags::FUNCTION_SCOPED_VARIABLE_EXCLUDES,
            );
        }
    }
}

fn get_initializer_symbol(a: Ast<'_>, symbol: SymbolId) -> SymbolId {
    if symbol.is_nil() || a.sym(symbol).value_declaration.is_nil() {
        return SymbolId::NIL;
    }
    let declaration = a.sym(symbol).value_declaration;
    // For an assignment 'fn.xxx = ...', where 'fn' is a previously declared function or a previously declared const variable initialized with a function expression or arrow function, we add expando property declarations to the function's symbol. This also applies to class expressions in JS files, and empty object literals in JS files when the declaration doesn't have a type annotation.
    if ast::is_function_declaration(a, declaration)
        || (ast::is_in_js_file(a, declaration) && ast::is_class_declaration(a, declaration))
    {
        return symbol;
    } else if ast::is_variable_declaration(a, declaration)
        && (a.flags(a.parent(declaration)).intersects(NodeFlags::CONST)
            || ast::is_in_js_file(a, declaration))
    {
        let initializer = a.initializer(declaration);
        if ast::is_expando_initializer(a, declaration, initializer) {
            return a.symbol(initializer);
        }
    } else if ast::is_binary_expression(a, declaration) && ast::is_in_js_file(a, declaration) {
        let initializer = a.as_binary_expression(declaration).right;
        if ast::is_expando_initializer(a, declaration, initializer) {
            return a.symbol(initializer);
        }
    }
    SymbolId::NIL
}

impl<'a> Binder<'a> {
    fn bind_this_property_assignment(&mut self, node: NodeId) {
        let a = self.a;
        if !ast::is_in_js_file(a, node) {
            return;
        }
        let bin = a.as_binary_expression(node);
        if (ast::is_property_access_expression(a, bin.left)
            && ast::is_private_identifier(a, a.as_property_access_expression(bin.left).name))
            || self.this_container.is_nil()
        {
            return;
        }
        let (class_symbol, symbol_table) = self.get_this_class_and_symbol_table();
        if !symbol_table.is_nil() {
            if ast::has_dynamic_name(a, node) {
                self.declare_symbol_ex(
                    symbol_table,
                    class_symbol,
                    node,
                    SymbolFlags::PROPERTY,
                    SymbolFlags::NONE,
                    true,
                    true,
                );
                self.add_late_bound_assignment_declaration_to_symbol(node, class_symbol);
            } else {
                self.declare_symbol_ex(
                    symbol_table,
                    class_symbol,
                    node,
                    SymbolFlags::PROPERTY | SymbolFlags::ASSIGNMENT,
                    SymbolFlags::NONE,
                    true,
                    false,
                );
            }
        } else if a.kind(self.this_container) != Kind::FunctionDeclaration
            && a.kind(self.this_container) != Kind::FunctionExpression
        {
            // !!! constructor functions
            a.unhandled::<()>(
                "Unhandled case in bindThisPropertyAssignment: ",
                self.this_container,
            );
        }
    }

    fn get_this_class_and_symbol_table(&mut self) -> (SymbolId, SymbolTableId) {
        let a = self.a;
        let mut class_symbol = SymbolId::NIL;
        let mut symbol_table = SymbolTableId::NIL;
        if self.this_container.is_nil() {
            return (SymbolId::NIL, SymbolTableId::NIL);
        }
        match a.kind(self.this_container) {
            Kind::FunctionDeclaration | Kind::FunctionExpression => {
                // !!! constructor functions
            }
            Kind::Constructor
            | Kind::PropertyDeclaration
            | Kind::MethodDeclaration
            | Kind::GetAccessor
            | Kind::SetAccessor
            | Kind::ClassStaticBlockDeclaration => {
                // this.property assignment in class member -- bind to the containing class
                class_symbol = a.symbol(a.parent(self.this_container));
                if ast::is_static(a, self.this_container) {
                    symbol_table = ast::get_exports(a, class_symbol);
                } else {
                    symbol_table = ast::get_members(a, class_symbol);
                }
            }
            _ => {}
        }
        (class_symbol, symbol_table)
    }

    fn bind_enum_declaration(&mut self, node: NodeId) {
        if ast::is_enum_const(self.a, node) {
            self.bind_block_scoped_declaration(
                node,
                SymbolFlags::CONST_ENUM,
                SymbolFlags::CONST_ENUM_EXCLUDES,
            );
        } else {
            self.bind_block_scoped_declaration(
                node,
                SymbolFlags::REGULAR_ENUM,
                SymbolFlags::REGULAR_ENUM_EXCLUDES,
            );
        }
    }

    fn bind_variable_declaration_or_binding_element(&mut self, node: NodeId) {
        let a = self.a;
        self.check_strict_mode_eval_or_arguments(node, a.name(node));
        let name = a.name(node);
        if !name.is_nil() && !ast::is_binding_pattern(a, name) {
            if ast::is_variable_declaration_initialized_to_require(a, node) {
                self.declare_symbol_and_add_to_symbol_table(
                    node,
                    SymbolFlags::ALIAS,
                    SymbolFlags::ALIAS_EXCLUDES,
                );
            } else if ast::is_block_or_catch_scoped(a, node) {
                self.bind_block_scoped_declaration(
                    node,
                    SymbolFlags::BLOCK_SCOPED_VARIABLE,
                    SymbolFlags::BLOCK_SCOPED_VARIABLE_EXCLUDES,
                );
            } else if ast::is_part_of_parameter_declaration(a, node) {
                // It is safe to walk up parent chain to find whether the node is a destructuring parameter declaration because its parent chain has already been set up, since parents are set before descending into children. If node is a binding element in parameter declaration, we need to use ParameterExcludes. Using ParameterExcludes flag allows the compiler to report an error on duplicate identifiers in Parameter Declaration. For example: `function foo([a,a]) {}` is a Duplicate Identifier error, and for `function bar(a,a) {}` the parameter declaration is handled in bindParameter, which correctly sets the excluded symbols.
                self.declare_symbol_and_add_to_symbol_table(
                    node,
                    SymbolFlags::FUNCTION_SCOPED_VARIABLE,
                    SymbolFlags::PARAMETER_EXCLUDES,
                );
            } else {
                self.declare_symbol_and_add_to_symbol_table(
                    node,
                    SymbolFlags::FUNCTION_SCOPED_VARIABLE,
                    SymbolFlags::FUNCTION_SCOPED_VARIABLE_EXCLUDES,
                );
            }
        }
    }

    fn bind_parameter(&mut self, node: NodeId) {
        let a = self.a;
        let decl = a.as_parameter_declaration(node);
        if !a.flags(node).intersects(NodeFlags::AMBIENT) {
            // It is a SyntaxError if the identifier eval or arguments appears within a FormalParameterList of a strict mode FunctionLikeDeclaration or FunctionExpression(13.1)
            self.check_strict_mode_eval_or_arguments(node, decl.name);
        }
        if ast::is_binding_pattern(a, decl.name) {
            // slices.Index: the position of the parameter in its list, or -1.
            let mut index: isize = -1;
            for (i, parameter) in a.parameters(a.parent(node)).iter().enumerate() {
                if parameter == node {
                    index = i as isize;
                    break;
                }
            }
            let name = self.text(&[b"__".as_slice(), index.to_string().as_bytes()].concat());
            self.bind_anonymous_declaration(node, SymbolFlags::FUNCTION_SCOPED_VARIABLE, name);
        } else {
            self.declare_symbol_and_add_to_symbol_table(
                node,
                SymbolFlags::FUNCTION_SCOPED_VARIABLE,
                SymbolFlags::PARAMETER_EXCLUDES,
            );
        }
        // If this is a property-parameter, then also declare the property symbol into the containing class.
        if ast::is_parameter_property_declaration(a, node, a.parent(node)) {
            let class_declaration = a.parent(a.parent(node));
            let flags = SymbolFlags::PROPERTY
                | if !decl.question_token.is_nil() {
                    SymbolFlags::OPTIONAL
                } else {
                    SymbolFlags::NONE
                };
            self.declare_symbol(
                ast::get_members(a, a.symbol(class_declaration)),
                a.symbol(class_declaration),
                node,
                flags,
                SymbolFlags::PROPERTY_EXCLUDES,
            );
        }
    }

    fn bind_function_declaration(&mut self, node: NodeId) {
        let a = self.a;
        if !a.as_source_file(self.file).is_declaration_file
            && !a.flags(node).intersects(NodeFlags::AMBIENT)
            && ast::is_async_function(a, node)
        {
            self.emit_flags |= NodeFlags::HAS_ASYNC_FUNCTIONS;
        }
        self.check_strict_mode_function_name(node);
        self.bind_block_scoped_declaration(
            node,
            SymbolFlags::FUNCTION,
            SymbolFlags::FUNCTION_EXCLUDES,
        );
    }

    fn get_infer_type_container(&mut self, node: NodeId) -> NodeId {
        let a = self.a;
        let extends_type = ast::find_ancestor(a, node, |n| {
            let parent = a.parent(n);
            !parent.is_nil()
                && ast::is_conditional_type_node(a, parent)
                && a.as_conditional_type_node(parent).extends_type == n
        });
        if !extends_type.is_nil() {
            return a.parent(extends_type);
        }
        NodeId::NIL
    }

    fn bind_anonymous_declaration(
        &mut self,
        node: NodeId,
        symbol_flags: SymbolFlags,
        name: Text<'a>,
    ) {
        let a = self.a;
        let symbol = self.new_symbol(symbol_flags, name);
        if symbol_flags.intersects(SymbolFlags::ENUM_MEMBER | SymbolFlags::CLASS_MEMBER) {
            let parent = a.symbol(self.container);
            a.update_symbol(symbol, |s| s.parent = parent);
        }
        self.add_declaration_to_symbol(symbol, node, symbol_flags);
    }

    fn bind_block_scoped_declaration(
        &mut self,
        node: NodeId,
        symbol_flags: SymbolFlags,
        symbol_excludes: SymbolFlags,
    ) {
        let a = self.a;
        match a.kind(self.block_scope_container) {
            Kind::ModuleDeclaration => {
                self.declare_module_member(node, symbol_flags, symbol_excludes);
            }
            // A source file that is not a module falls through to the default case.
            Kind::SourceFile if ast::is_external_or_common_js_module(a, self.container) => {
                self.declare_module_member(node, symbol_flags, symbol_excludes);
            }
            _ => {
                self.declare_symbol(
                    ast::get_locals(a, self.block_scope_container),
                    SymbolId::NIL,
                    node,
                    symbol_flags,
                    symbol_excludes,
                );
            }
        }
    }

    fn bind_type_parameter(&mut self, node: NodeId) {
        let a = self.a;
        if a.kind(a.parent(node)) == Kind::InferType {
            let container = self.get_infer_type_container(a.parent(node));
            if !container.is_nil() {
                self.declare_symbol(
                    ast::get_locals(a, container),
                    SymbolId::NIL,
                    node,
                    SymbolFlags::TYPE_PARAMETER,
                    SymbolFlags::TYPE_PARAMETER_EXCLUDES,
                );
            } else {
                let name = self.get_declaration_name(node);
                self.bind_anonymous_declaration(node, SymbolFlags::TYPE_PARAMETER, name);
            }
        } else {
            self.declare_symbol_and_add_to_symbol_table(
                node,
                SymbolFlags::TYPE_PARAMETER,
                SymbolFlags::TYPE_PARAMETER_EXCLUDES,
            );
        }
    }

    fn lookup_entity(&mut self, node: NodeId, container: NodeId) -> SymbolId {
        let a = self.a;
        // Upstream dereferences a nil node here; the walk below ends at the nil expression of a node that has none.
        if node.is_nil() {
            return SymbolId::NIL;
        }
        if !self.stack_check.is_safe_to_recurse() {
            stack_limit(a, node.0);
            return SymbolId::NIL;
        }
        if ast::is_identifier(a, node) {
            return self.lookup_name(a.text(node), container);
        }
        if a.kind(a.expression(node)) == Kind::ThisKeyword {
            let (_, symbol_table) = self.get_this_class_and_symbol_table();
            if !symbol_table.is_nil() {
                let name = ast::get_element_or_property_access_name(a, node);
                if !name.is_nil() {
                    return a.table_get(symbol_table, a.text(name));
                }
            }
            return SymbolId::NIL;
        }
        let entity = self.lookup_entity(a.expression(node), container);
        let symbol = get_initializer_symbol(a, entity);
        if !symbol.is_nil() && !a.sym(symbol).exports.is_nil() {
            let name = ast::get_element_or_property_access_name(a, node);
            if !name.is_nil() {
                return a.table_get(a.sym(symbol).exports, a.text(name));
            }
        }
        SymbolId::NIL
    }

    fn lookup_name(&mut self, name: &[u8], container: NodeId) -> SymbolId {
        let a = self.a;
        if a.has_locals_container_data(container) {
            let local = a.table_get(a.locals(container), name);
            if !local.is_nil() {
                return core::or_else(a.sym(local).export_symbol, local);
            }
        }
        if a.has_declaration_data(container) && !a.symbol(container).is_nil() {
            return a.table_get(a.sym(a.symbol(container)).exports, name);
        }
        SymbolId::NIL
    }

    // The binder visits every node in the syntax tree so it is a convenient place to perform a single localized check for reserved words used as identifiers in strict mode code, as well as `yield` or `await` in [Yield] or [Await] contexts, respectively.
    fn check_contextual_identifier(&mut self, node: NodeId) {
        let a = self.a;
        // Report error only if there are no parse errors in file
        if a.as_source_file(self.file).diagnostics().len() == 0
            && !a.flags(node).intersects(NodeFlags::AMBIENT)
            && !a.flags(node).intersects(NodeFlags::JSDOC)
            && !ast::is_identifier_name(a, node)
        {
            // strict mode identifiers
            let original_keyword_kind = scanner::get_identifier_token(a.text(node));
            if original_keyword_kind == Kind::Identifier {
                return;
            }
            if original_keyword_kind >= Kind::FIRST_FUTURE_RESERVED_WORD
                && original_keyword_kind <= Kind::LAST_FUTURE_RESERVED_WORD
            {
                let message = self.get_strict_mode_identifier_message(node);
                self.error_on_node(
                    node,
                    message,
                    &[Arg::Str(&scanner::declaration_name_to_string(a, node))],
                );
            } else if original_keyword_kind == Kind::AwaitKeyword {
                if ast::is_external_module(a, self.file) && ast::is_in_top_level_context(a, node) {
                    self.error_on_node(
                        node,
                        diagnostics::IDENTIFIER_EXPECTED_0_IS_A_RESERVED_WORD_AT_THE_TOP_LEVEL_OF_A_MODULE,
                        &[Arg::Str(&scanner::declaration_name_to_string(a, node))],
                    );
                } else if a.flags(node).intersects(NodeFlags::AWAIT_CONTEXT) {
                    self.error_on_node(
                        node,
                        diagnostics::IDENTIFIER_EXPECTED_0_IS_A_RESERVED_WORD_THAT_CANNOT_BE_USED_HERE,
                        &[Arg::Str(&scanner::declaration_name_to_string(a, node))],
                    );
                }
            } else if original_keyword_kind == Kind::YieldKeyword
                && a.flags(node).intersects(NodeFlags::YIELD_CONTEXT)
            {
                self.error_on_node(
                    node,
                    diagnostics::IDENTIFIER_EXPECTED_0_IS_A_RESERVED_WORD_THAT_CANNOT_BE_USED_HERE,
                    &[Arg::Str(&scanner::declaration_name_to_string(a, node))],
                );
            }
        }
    }

    fn check_private_identifier(&mut self, node: NodeId) {
        let a = self.a;
        if a.text(node) == b"#constructor" {
            // Report error only if there are no parse errors in file
            if a.as_source_file(self.file).diagnostics().len() == 0 {
                self.error_on_node(
                    node,
                    diagnostics::X_CONSTRUCTOR_IS_A_RESERVED_WORD,
                    &[Arg::Str(&scanner::declaration_name_to_string(a, node))],
                );
            }
        }
    }

    fn get_strict_mode_identifier_message(&mut self, node: NodeId) -> MessageId {
        let a = self.a;
        // Provide specialized messages to help the user understand why we think they're in strict mode.
        if !ast::get_containing_class(a, node).is_nil() {
            return diagnostics::IDENTIFIER_EXPECTED_0_IS_A_RESERVED_WORD_IN_STRICT_MODE_CLASS_DEFINITIONS_ARE_AUTOMATICALLY_IN_STRICT_MODE;
        }
        if !a
            .as_source_file(self.file)
            .external_module_indicator
            .is_nil()
        {
            return diagnostics::IDENTIFIER_EXPECTED_0_IS_A_RESERVED_WORD_IN_STRICT_MODE_MODULES_ARE_AUTOMATICALLY_IN_STRICT_MODE;
        }
        diagnostics::IDENTIFIER_EXPECTED_0_IS_A_RESERVED_WORD_IN_STRICT_MODE
    }
}

// Should be called only on prologue directives (ast.IsPrologueDirective(node) should be true)
fn is_use_strict_prologue_directive(a: Ast<'_>, source_file: NodeId, node: NodeId) -> bool {
    let node_text = scanner::get_source_text_of_node_from_source_file(
        a,
        source_file,
        a.expression(node),
        false,
    );
    // Note: the node text must be exactly "use strict" or 'use strict'. It is not ok for the string to contain unicode escapes (as per ES5).
    node_text == b"\"use strict\"" || node_text == b"'use strict'"
}

pub fn find_use_strict_prologue(
    a: Ast<'_>,
    source_file: NodeId,
    statements: List<'_, NodeId>,
) -> NodeId {
    for statement in statements.iter() {
        if ast::is_prologue_directive(a, statement) {
            if is_use_strict_prologue_directive(a, source_file, statement) {
                return statement;
            }
        } else {
            return NodeId::NIL;
        }
    }

    NodeId::NIL
}

impl<'a> Binder<'a> {
    fn check_strict_mode_function_name(&mut self, node: NodeId) {
        let a = self.a;
        if !a.flags(node).intersects(NodeFlags::AMBIENT) {
            // It is a SyntaxError if the identifier eval or arguments appears within a FormalParameterList of a strict mode FunctionDeclaration or FunctionExpression (13.1))
            self.check_strict_mode_eval_or_arguments(node, a.name(node));
        }
    }

    pub fn get_strict_mode_block_scope_function_declaration_message(
        &mut self,
        node: NodeId,
    ) -> MessageId {
        let a = self.a;
        // Provide specialized messages to help the user understand why we think they're in strict mode.
        if !ast::get_containing_class(a, node).is_nil() {
            return diagnostics::FUNCTION_DECLARATIONS_ARE_NOT_ALLOWED_INSIDE_BLOCKS_IN_STRICT_MODE_WHEN_TARGETING_ES5_CLASS_DEFINITIONS_ARE_AUTOMATICALLY_IN_STRICT_MODE;
        }
        if !a
            .as_source_file(self.file)
            .external_module_indicator
            .is_nil()
        {
            return diagnostics::FUNCTION_DECLARATIONS_ARE_NOT_ALLOWED_INSIDE_BLOCKS_IN_STRICT_MODE_WHEN_TARGETING_ES5_MODULES_ARE_AUTOMATICALLY_IN_STRICT_MODE;
        }
        diagnostics::FUNCTION_DECLARATIONS_ARE_NOT_ALLOWED_INSIDE_BLOCKS_IN_STRICT_MODE_WHEN_TARGETING_ES5
    }

    fn check_strict_mode_binary_expression(&mut self, node: NodeId) {
        let a = self.a;
        let expr = a.as_binary_expression(node);
        if ast::is_left_hand_side_expression(a, expr.left)
            && ast::is_assignment_operator(a.kind(expr.operator_token))
        {
            // ECMA 262 (Annex C) The identifier eval or arguments may not appear as the LeftHandSideExpression of an Assignment operator(11.13) or of a PostfixExpression(11.3)
            self.check_strict_mode_eval_or_arguments(node, expr.left);
        }
    }

    fn check_strict_mode_catch_clause(&mut self, node: NodeId) {
        let a = self.a;
        // It is a SyntaxError if a TryStatement with a Catch occurs within strict code and the Identifier of the Catch production is eval or arguments
        let clause = a.as_catch_clause(node);
        if !clause.variable_declaration.is_nil() {
            self.check_strict_mode_eval_or_arguments(
                node,
                a.as_variable_declaration(clause.variable_declaration).name,
            );
        }
    }

    fn check_strict_mode_delete_expression(&mut self, node: NodeId) {
        let a = self.a;
        // Grammar checking
        let expr = a.as_delete_expression(node);
        if a.kind(expr.expression) == Kind::Identifier {
            // When a delete operator occurs within strict mode code, a SyntaxError is thrown if its UnaryExpression is a direct reference to a variable, function argument, or function name
            self.error_on_node(
                expr.expression,
                diagnostics::X_DELETE_CANNOT_BE_CALLED_ON_AN_IDENTIFIER_IN_STRICT_MODE,
                &[],
            );
        }
    }

    fn check_strict_mode_postfix_unary_expression(&mut self, node: NodeId) {
        // Grammar checking: the identifier eval or arguments may not appear as the LeftHandSideExpression of an Assignment operator(11.13) or of a PostfixExpression(11.3) or as the UnaryExpression operated upon by a Prefix Increment(11.4.4) or a Prefix Decrement(11.4.5) operator.
        self.check_strict_mode_eval_or_arguments(
            node,
            self.a.as_postfix_unary_expression(node).operand,
        );
    }

    fn check_strict_mode_prefix_unary_expression(&mut self, node: NodeId) {
        // Grammar checking
        let expr = self.a.as_prefix_unary_expression(node);
        if expr.operator == Kind::PlusPlusToken || expr.operator == Kind::MinusMinusToken {
            self.check_strict_mode_eval_or_arguments(node, expr.operand);
        }
    }

    fn check_strict_mode_with_statement(&mut self, node: NodeId) {
        // Grammar checking for withStatement
        self.error_on_first_token(
            node,
            diagnostics::X_WITH_STATEMENTS_ARE_NOT_ALLOWED_IN_STRICT_MODE,
            &[],
        );
    }

    fn check_strict_mode_labeled_statement(&mut self, node: NodeId) {
        let a = self.a;
        // Grammar checking for labeledStatement
        let data = a.as_labeled_statement(node);
        if ast::is_declaration_statement(a, data.statement)
            || ast::is_variable_statement(a, data.statement)
        {
            self.error_on_first_token(data.label, diagnostics::A_LABEL_IS_NOT_ALLOWED_HERE, &[]);
        }
    }
}

fn is_eval_or_arguments_identifier(a: Ast<'_>, node: NodeId) -> bool {
    if ast::is_identifier(a, node) {
        let text = a.text(node);
        return text == b"eval" || text == b"arguments";
    }
    false
}

impl<'a> Binder<'a> {
    fn check_strict_mode_eval_or_arguments(&mut self, context_node: NodeId, name: NodeId) {
        let a = self.a;
        if !name.is_nil() && is_eval_or_arguments_identifier(a, name) {
            // We check first if the name is inside class declaration or class expression; if so give explicit message otherwise report generic error message.
            let message = self.get_strict_mode_eval_or_arguments_message(context_node);
            self.error_on_node(name, message, &[Arg::Str(a.text(name))]);
        }
    }

    fn get_strict_mode_eval_or_arguments_message(&mut self, node: NodeId) -> MessageId {
        let a = self.a;
        // Provide specialized messages to help the user understand why we think they're in strict mode
        if !ast::get_containing_class(a, node).is_nil() {
            return diagnostics::CODE_CONTAINED_IN_A_CLASS_IS_EVALUATED_IN_JAVASCRIPT_S_STRICT_MODE_WHICH_DOES_NOT_ALLOW_THIS_USE_OF_0_FOR_MORE_INFORMATION_SEE_HTTPS_COLON_SLASH_SLASHDEVELOPER_MOZILLA_ORG_SLASHEN_US_SLASHDOCS_SLASHWEB_SLASHJAVASCRIPT_SLASHREFERENCE_SLASHSTRICT_MODE;
        }
        if !a
            .as_source_file(self.file)
            .external_module_indicator
            .is_nil()
        {
            return diagnostics::INVALID_USE_OF_0_MODULES_ARE_AUTOMATICALLY_IN_STRICT_MODE;
        }
        diagnostics::INVALID_USE_OF_0_IN_STRICT_MODE
    }

    // All container nodes are kept on a linked list in declaration order. This list is used by the getLocalNameOfContainer function in the type checker to validate that the local name used for a container is unique.
    fn bind_container(&mut self, node: NodeId, container_flags: ContainerFlags) {
        let a = self.a;
        // Before we recurse into a node's children, we first save the existing parent, container and block-container. Then after we pop out of processing the children, we restore these saved values.
        let save_container = self.container;
        let save_this_container = self.this_container;
        let saved_block_scope_container = self.block_scope_container;
        // Depending on what kind of node this is, we may have to adjust the current container and block-container. If the current node is a container, then it is automatically considered the current block-container as well. Also, for containers that we know may contain locals, we eagerly initialize the .locals field. We do this because it's highly likely that the .locals will be needed to place some child in (for example, a parameter, or variable declaration). However, we do not proactively create the .locals for block-containers because it's totally normal and common for block-containers to never actually have a block-scoped variable in them. We don't want to end up allocating an object for every 'block' we run into when most of them won't be necessary. Finally, if this is a block-container, then we clear out any existing .locals object it may contain within it. This happens in incremental scenarios. Because we can be reusing a node from a previous compilation, that node may have had 'locals' created for it. We must clear this so we don't accidentally move any stale data forward from a previous compilation.
        if container_flags.intersects(ContainerFlags::IS_CONTAINER) {
            self.container = node;
            self.block_scope_container = node;
            if container_flags.intersects(ContainerFlags::HAS_LOCALS) {
                self.add_to_container_chain(node);
            }
        } else if container_flags.intersects(ContainerFlags::IS_BLOCK_SCOPED_CONTAINER) {
            self.block_scope_container = node;
            self.add_to_container_chain(node);
        }
        if container_flags.intersects(ContainerFlags::IS_THIS_CONTAINER) {
            self.this_container = node;
        }
        if container_flags.intersects(ContainerFlags::IS_CONTROL_FLOW_CONTAINER) {
            let save_current_flow = self.current_flow;
            let save_break_target = self.current_break_target;
            let save_continue_target = self.current_continue_target;
            let save_return_target = self.current_return_target;
            let save_exception_target = self.current_exception_target;
            let save_active_label_list = self.active_label_list;
            let save_has_explicit_return = self.has_explicit_return;
            let save_seen_this_keyword = self.seen_this_keyword;
            let is_immediately_invoked = (container_flags
                .intersects(ContainerFlags::IS_FUNCTION_EXPRESSION)
                && !ast::has_syntactic_modifier(a, node, ModifierFlags::ASYNC)
                && !is_generator_function_expression(a, node)
                && !ast::get_immediately_invoked_function_expression(a, node).is_nil())
                || a.kind(node) == Kind::ClassStaticBlockDeclaration;
            // A non-async, non-generator IIFE is considered part of the containing control flow. Return statements behave similarly to break statements that exit to a label just past the statement body.
            if !is_immediately_invoked {
                let flow_start = self.new_flow_node(FlowFlags::START);
                self.current_flow = flow_start;
                if container_flags.intersects(
                    ContainerFlags::IS_FUNCTION_EXPRESSION
                        | ContainerFlags::IS_OBJECT_LITERAL_OR_CLASS_EXPRESSION_METHOD_OR_ACCESSOR,
                ) {
                    a.update_flow(flow_start, |f| f.node = node);
                }
            }
            // We create a return control flow graph for IIFEs and constructors. For constructors we use the return control flow graph in strict property initialization checks.
            if is_immediately_invoked || a.kind(node) == Kind::Constructor {
                self.current_return_target = self.new_flow_node(FlowFlags::BRANCH_LABEL);
            } else {
                self.current_return_target = FlowNodeId::NIL;
            }
            self.current_exception_target = FlowNodeId::NIL;
            self.current_break_target = FlowNodeId::NIL;
            self.current_continue_target = FlowNodeId::NIL;
            self.active_label_list = ActiveLabelId::NIL;
            self.has_explicit_return = false;
            self.seen_this_keyword = false;
            self.bind_children(node);
            // Reset flags (for incremental scenarios)
            a.set_flags(
                node,
                a.flags(node)
                    .without(NodeFlags::REACHABILITY_AND_EMIT_FLAGS | NodeFlags::CONTAINS_THIS),
            );
            if !a
                .flow(self.current_flow)
                .flags
                .intersects(FlowFlags::UNREACHABLE)
                && container_flags.intersects(ContainerFlags::IS_FUNCTION_LIKE)
            {
                if let Some(body_data) = a.body_data(node) {
                    if ast::node_is_present(a, body_data.body) {
                        a.set_flags(node, a.flags(node) | NodeFlags::HAS_IMPLICIT_RETURN);
                        if self.has_explicit_return {
                            a.set_flags(node, a.flags(node) | NodeFlags::HAS_EXPLICIT_RETURN);
                        }
                        a.set_end_flow_node(node, self.current_flow);
                    }
                }
            }
            if self.seen_this_keyword {
                a.set_flags(node, a.flags(node) | NodeFlags::CONTAINS_THIS);
            }
            if a.kind(node) == Kind::SourceFile {
                a.set_flags(node, a.flags(node) | self.emit_flags);
            }
            if !self.current_return_target.is_nil() {
                self.add_antecedent(self.current_return_target, self.current_flow);
                self.current_flow = self.finish_flow_label(self.current_return_target);
                if a.kind(node) == Kind::Constructor
                    || a.kind(node) == Kind::ClassStaticBlockDeclaration
                {
                    set_return_flow_node(a, node, self.current_flow);
                }
            }
            if !is_immediately_invoked {
                self.current_flow = save_current_flow;
            }
            self.current_break_target = save_break_target;
            self.current_continue_target = save_continue_target;
            self.current_return_target = save_return_target;
            self.current_exception_target = save_exception_target;
            self.active_label_list = save_active_label_list;
            self.has_explicit_return = save_has_explicit_return;
            if container_flags.intersects(ContainerFlags::PROPAGATES_THIS_KEYWORD) {
                self.seen_this_keyword = save_seen_this_keyword || self.seen_this_keyword;
            } else {
                self.seen_this_keyword = save_seen_this_keyword;
            }
        } else if container_flags.intersects(ContainerFlags::IS_INTERFACE) {
            let save_seen_this_keyword = self.seen_this_keyword;
            self.seen_this_keyword = false;
            self.bind_children(node);
            // ContainsThis cannot overlap with HasExtendedUnicodeEscape on Identifier
            if self.seen_this_keyword {
                a.set_flags(node, a.flags(node) | NodeFlags::CONTAINS_THIS);
            } else {
                a.set_flags(node, a.flags(node).without(NodeFlags::CONTAINS_THIS));
            }
            self.seen_this_keyword = save_seen_this_keyword;
        } else {
            self.bind_children(node);
        }
        if ast::is_source_file(a, node) && ast::is_in_js_file(a, node) {
            // Binding of top-level JSTypeAliasDeclaration nodes is deferred to ensure CommonJS module indicators, if any, are processed first.
            for statement in a.statements(node).iter() {
                if ast::is_js_type_alias_declaration(a, statement) {
                    self.bind_block_scoped_declaration(
                        statement,
                        SymbolFlags::TYPE_ALIAS,
                        SymbolFlags::TYPE_ALIAS_EXCLUDES,
                    );
                }
            }
            if !a
                .as_source_file(self.file)
                .common_js_module_indicator
                .is_nil()
            {
                self.declare_common_js_variable(b"module");
                self.declare_common_js_variable(b"exports");
            }
        }
        if (ast::is_source_file(a, node) && ast::is_external_or_common_js_module(a, node))
            || ast::is_ambient_module(a, node)
        {
            self.bind_common_js_type_exports(a.symbol(node));
        }
        self.container = save_container;
        self.this_container = save_this_container;
        self.block_scope_container = saved_block_scope_container;
    }

    fn declare_common_js_variable(&mut self, name: Text<'a>) {
        let a = self.a;
        let locals = ast::get_locals(a, self.file);
        if a.table_get(locals, name).is_nil() {
            let symbol = self.new_symbol(
                SymbolFlags::FUNCTION_SCOPED_VARIABLE | SymbolFlags::MODULE_EXPORTS,
                name,
            );
            let declarations = self.new_single_declaration(self.file);
            let value_declaration = declarations.at(0usize);
            a.update_symbol(symbol, |s| {
                s.declarations = declarations;
                s.value_declaration = value_declaration;
            });
            if name == b"module" {
                let exports_property = self.new_symbol(
                    SymbolFlags::MODULE_EXPORTS | SymbolFlags::PROPERTY,
                    b"exports",
                );
                a.update_symbol(exports_property, |s| {
                    s.declarations = declarations;
                    s.value_declaration = value_declaration;
                    s.parent = symbol;
                });
                let members = a.new_table();
                a.update_symbol(symbol, |s| s.members = members);
                a.table_set(members, b"exports", exports_property);
            }
            a.table_set(locals, name, symbol);
        }
    }

    fn bind_children(&mut self, node: NodeId) {
        let a = self.a;
        let save_in_assignment_pattern = self.in_assignment_pattern;
        // Most nodes aren't valid in an assignment pattern, so we clear the value here and set it before we descend into nodes that could actually be part of an assignment pattern.
        self.in_assignment_pattern = false;

        if self.current_flow == self.unreachable_flow {
            if a.has_flow_node_data(node) {
                a.set_flow_node(node, FlowNodeId::NIL);
            }
            if ast::is_potentially_executable_node(a, node) {
                a.set_flags(node, a.flags(node) | NodeFlags::UNREACHABLE);
            }
            self.bind_each_child(node);
            self.in_assignment_pattern = save_in_assignment_pattern;
            return;
        }

        let kind = a.kind(node);
        if Kind::FIRST_STATEMENT <= kind && kind <= Kind::LAST_STATEMENT {
            if a.has_flow_node_data(node) {
                a.set_flow_node(node, self.current_flow);
            }
        }

        match kind {
            Kind::WhileStatement => self.bind_while_statement(node),
            Kind::DoStatement => self.bind_do_statement(node),
            Kind::ForStatement => self.bind_for_statement(node),
            Kind::ForInStatement | Kind::ForOfStatement => {
                self.bind_for_in_or_for_of_statement(node)
            }
            Kind::IfStatement => self.bind_if_statement(node),
            Kind::ReturnStatement => self.bind_return_statement(node),
            Kind::ThrowStatement => self.bind_throw_statement(node),
            Kind::BreakStatement => self.bind_break_statement(node),
            Kind::ContinueStatement => self.bind_continue_statement(node),
            Kind::TryStatement => self.bind_try_statement(node),
            Kind::SwitchStatement => self.bind_switch_statement(node),
            Kind::CaseBlock => self.bind_case_block(node),
            Kind::CaseClause | Kind::DefaultClause => self.bind_case_or_default_clause(node),
            Kind::ExpressionStatement => self.bind_expression_statement(node),
            Kind::LabeledStatement => self.bind_labeled_statement(node),
            Kind::PrefixUnaryExpression => self.bind_prefix_unary_expression_flow(node),
            Kind::PostfixUnaryExpression => self.bind_postfix_unary_expression_flow(node),
            Kind::BinaryExpression => {
                if ast::is_destructuring_assignment(a, node) {
                    // Carry over whether we are in an assignment pattern to binary expressions that could actually be an initializer
                    self.in_assignment_pattern = save_in_assignment_pattern;
                    self.bind_destructuring_assignment_flow(node);
                    return;
                }
                self.bind_binary_expression_flow(node);
            }
            Kind::DeleteExpression => self.bind_delete_expression_flow(node),
            Kind::ConditionalExpression => self.bind_conditional_expression_flow(node),
            Kind::VariableDeclaration => self.bind_variable_declaration_flow(node),
            Kind::PropertyAccessExpression | Kind::ElementAccessExpression => {
                self.bind_access_expression_flow(node)
            }
            Kind::CallExpression => self.bind_call_expression_flow(node),
            Kind::NonNullExpression => self.bind_non_null_expression_flow(node),
            Kind::SourceFile => {
                let source_file = a.as_source_file(node);
                self.bind_each_statement_functions_first(source_file.statements);
                self.bind(source_file.end_of_file_token);
            }
            Kind::Block | Kind::ModuleBlock => {
                self.bind_each_statement_functions_first(a.statement_list(node));
            }
            Kind::BindingElement => self.bind_binding_element_flow(node),
            Kind::Parameter => self.bind_parameter_flow(node),
            Kind::ObjectLiteralExpression
            | Kind::ArrayLiteralExpression
            | Kind::PropertyAssignment
            | Kind::SpreadElement => {
                self.in_assignment_pattern = save_in_assignment_pattern;
                self.bind_each_child(node);
            }
            _ => self.bind_each_child(node),
        }
        self.in_assignment_pattern = save_in_assignment_pattern;
    }

    fn bind_each_child(&mut self, node: NodeId) {
        let a = self.a;
        a.for_each_child(node, &mut |child| self.bind(child));
    }

    fn bind_each(&mut self, nodes: List<'a, NodeId>) {
        for node in nodes.iter() {
            self.bind(node);
        }
    }

    fn bind_node_list(&mut self, node_list: NodeListId) {
        if !node_list.is_nil() {
            self.bind_each(self.a.nodes(node_list));
        }
    }

    fn bind_modifiers(&mut self, modifiers: ModifierListId) {
        if !modifiers.is_nil() {
            self.bind_each(self.a.nodes(modifiers.as_node_list()));
        }
    }

    fn bind_each_statement_functions_first(&mut self, statements: NodeListId) {
        let a = self.a;
        for node in a.nodes(statements).iter() {
            if a.kind(node) == Kind::FunctionDeclaration {
                self.bind(node);
            }
        }
        for node in a.nodes(statements).iter() {
            if a.kind(node) != Kind::FunctionDeclaration {
                self.bind(node);
            }
        }
    }

    fn set_continue_target(&mut self, node: NodeId, target: FlowNodeId) -> FlowNodeId {
        let a = self.a;
        let mut node = node;
        let mut label = self.active_label_list;
        while !label.is_nil() && a.kind(a.parent(node)) == Kind::LabeledStatement {
            let Some(active_label) = self.active_labels.get_mut(label.index()) else {
                break;
            };
            active_label.continue_target = target;
            label = active_label.next;
            node = a.parent(node);
        }
        target
    }

    fn do_with_conditional_branches(
        &mut self,
        action: fn(&mut Binder<'a>, NodeId) -> bool,
        value: NodeId,
        true_target: FlowNodeId,
        false_target: FlowNodeId,
    ) {
        let saved_true_target = self.current_true_target;
        let saved_false_target = self.current_false_target;
        self.current_true_target = true_target;
        self.current_false_target = false_target;
        action(self, value);
        self.current_true_target = saved_true_target;
        self.current_false_target = saved_false_target;
    }

    fn bind_condition(&mut self, node: NodeId, true_target: FlowNodeId, false_target: FlowNodeId) {
        let a = self.a;
        self.do_with_conditional_branches(Binder::bind, node, true_target, false_target);
        if node.is_nil()
            || (!is_logical_assignment_expression(a, node)
                && !ast::is_logical_expression(a, node)
                && !(ast::is_optional_chain(a, node) && ast::is_outermost_optional_chain(a, node)))
        {
            let true_condition =
                self.create_flow_condition(FlowFlags::TRUE_CONDITION, self.current_flow, node);
            self.add_antecedent(true_target, true_condition);
            let false_condition =
                self.create_flow_condition(FlowFlags::FALSE_CONDITION, self.current_flow, node);
            self.add_antecedent(false_target, false_condition);
        }
    }

    fn bind_iterative_statement(
        &mut self,
        node: NodeId,
        break_target: FlowNodeId,
        continue_target: FlowNodeId,
    ) {
        let save_break_target = self.current_break_target;
        let save_continue_target = self.current_continue_target;
        self.current_break_target = break_target;
        self.current_continue_target = continue_target;
        self.bind(node);
        self.current_break_target = save_break_target;
        self.current_continue_target = save_continue_target;
    }
}

fn is_logical_assignment_expression(a: Ast<'_>, node: NodeId) -> bool {
    ast::is_logical_or_coalescing_assignment_expression(a, ast::skip_parentheses(a, node))
}

impl<'a> Binder<'a> {
    fn bind_assignment_target_flow(&mut self, node: NodeId) {
        let a = self.a;
        if !self.stack_check.is_safe_to_recurse() {
            stack_limit(a, node.0);
            return;
        }
        match a.kind(node) {
            Kind::ArrayLiteralExpression => {
                for e in a.elements(node).iter() {
                    if a.kind(e) == Kind::SpreadElement {
                        self.bind_assignment_target_flow(a.expression(e));
                    } else {
                        self.bind_destructuring_target_flow(e);
                    }
                }
            }
            Kind::ObjectLiteralExpression => {
                for p in a.properties(node).iter() {
                    match a.kind(p) {
                        Kind::PropertyAssignment => {
                            self.bind_destructuring_target_flow(a.initializer(p));
                        }
                        Kind::ShorthandPropertyAssignment => {
                            self.bind_assignment_target_flow(
                                a.as_shorthand_property_assignment(p).name,
                            );
                        }
                        Kind::SpreadAssignment => {
                            self.bind_assignment_target_flow(a.expression(p));
                        }
                        _ => {}
                    }
                }
            }
            _ => {
                if is_narrowable_reference(a, self.stack_check, node) {
                    self.current_flow =
                        self.create_flow_mutation(FlowFlags::ASSIGNMENT, self.current_flow, node);
                }
            }
        }
    }

    fn bind_destructuring_target_flow(&mut self, node: NodeId) {
        let a = self.a;
        if ast::is_binary_expression(a, node)
            && a.kind(a.as_binary_expression(node).operator_token) == Kind::EqualsToken
        {
            self.bind_assignment_target_flow(a.as_binary_expression(node).left);
        } else {
            self.bind_assignment_target_flow(node);
        }
    }

    fn bind_while_statement(&mut self, node: NodeId) {
        let stmt = self.a.as_while_statement(node);
        let loop_label = self.create_loop_label();
        let pre_while_label = self.set_continue_target(node, loop_label);
        let pre_body_label = self.create_branch_label();
        let post_while_label = self.create_branch_label();
        self.add_antecedent(pre_while_label, self.current_flow);
        self.current_flow = pre_while_label;
        self.bind_condition(stmt.expression, pre_body_label, post_while_label);
        self.current_flow = self.finish_flow_label(pre_body_label);
        self.bind_iterative_statement(stmt.statement, post_while_label, pre_while_label);
        self.add_antecedent(pre_while_label, self.current_flow);
        self.current_flow = self.finish_flow_label(post_while_label);
    }

    fn bind_do_statement(&mut self, node: NodeId) {
        let stmt = self.a.as_do_statement(node);
        let pre_do_label = self.create_loop_label();
        let branch_label = self.create_branch_label();
        let pre_condition_label = self.set_continue_target(node, branch_label);
        let post_do_label = self.create_branch_label();
        self.add_antecedent(pre_do_label, self.current_flow);
        self.current_flow = pre_do_label;
        self.bind_iterative_statement(stmt.statement, post_do_label, pre_condition_label);
        self.add_antecedent(pre_condition_label, self.current_flow);
        self.current_flow = self.finish_flow_label(pre_condition_label);
        self.bind_condition(stmt.expression, pre_do_label, post_do_label);
        self.current_flow = self.finish_flow_label(post_do_label);
    }

    fn bind_for_statement(&mut self, node: NodeId) {
        let stmt = self.a.as_for_statement(node);
        self.bind(stmt.initializer);
        if self.current_flow == self.unreachable_flow {
            // Unlike while/do, the for-loop initializer is bound inside this function before the loop's flow graph is constructed. If it makes flow unreachable (e.g. a throwing IIFE), addAntecedent will filter out the unreachable entry to preLoopLabel, leaving only the back-edge from the incrementor. This creates a cycle with no exit that crashes isReachableFlowNodeWorker. Bail out early and just bind the remaining children with unreachable flow.
            self.bind(stmt.condition);
            self.bind(stmt.statement);
            self.bind(stmt.incrementor);
            return;
        }
        let loop_label = self.create_loop_label();
        let pre_loop_label = self.set_continue_target(node, loop_label);
        let pre_body_label = self.create_branch_label();
        let pre_incrementor_label = self.create_branch_label();
        let post_loop_label = self.create_branch_label();
        self.add_antecedent(pre_loop_label, self.current_flow);
        self.current_flow = pre_loop_label;
        self.bind_condition(stmt.condition, pre_body_label, post_loop_label);
        self.current_flow = self.finish_flow_label(pre_body_label);
        self.bind_iterative_statement(stmt.statement, post_loop_label, pre_incrementor_label);
        self.add_antecedent(pre_incrementor_label, self.current_flow);
        self.current_flow = self.finish_flow_label(pre_incrementor_label);
        self.bind(stmt.incrementor);
        self.add_antecedent(pre_loop_label, self.current_flow);
        self.current_flow = self.finish_flow_label(post_loop_label);
    }

    fn bind_for_in_or_for_of_statement(&mut self, node: NodeId) {
        let a = self.a;
        let stmt = a.as_for_in_or_of_statement(node);
        let loop_label = self.create_loop_label();
        let pre_loop_label = self.set_continue_target(node, loop_label);
        let post_loop_label = self.create_branch_label();
        self.bind(stmt.expression);
        self.add_antecedent(pre_loop_label, self.current_flow);
        self.current_flow = pre_loop_label;
        if a.kind(node) == Kind::ForOfStatement {
            self.bind(stmt.await_modifier);
        }
        self.add_antecedent(post_loop_label, self.current_flow);
        self.bind(stmt.initializer);
        if a.kind(stmt.initializer) != Kind::VariableDeclarationList {
            self.bind_assignment_target_flow(stmt.initializer);
        }
        self.bind_iterative_statement(stmt.statement, post_loop_label, pre_loop_label);
        self.add_antecedent(pre_loop_label, self.current_flow);
        self.current_flow = self.finish_flow_label(post_loop_label);
    }

    fn bind_if_statement(&mut self, node: NodeId) {
        let stmt = self.a.as_if_statement(node);
        let then_label = self.create_branch_label();
        let else_label = self.create_branch_label();
        let post_if_label = self.create_branch_label();
        self.bind_condition(stmt.expression, then_label, else_label);
        self.current_flow = self.finish_flow_label(then_label);
        self.bind(stmt.then_statement);
        self.add_antecedent(post_if_label, self.current_flow);
        self.current_flow = self.finish_flow_label(else_label);
        self.bind(stmt.else_statement);
        self.add_antecedent(post_if_label, self.current_flow);
        self.current_flow = self.finish_flow_label(post_if_label);
    }

    fn bind_return_statement(&mut self, node: NodeId) {
        self.bind(self.a.expression(node));
        if !self.current_return_target.is_nil() {
            self.add_antecedent(self.current_return_target, self.current_flow);
        }
        self.current_flow = self.unreachable_flow;
        self.has_explicit_return = true;
        self.has_flow_effects = true;
    }

    fn bind_throw_statement(&mut self, node: NodeId) {
        self.bind(self.a.expression(node));
        self.current_flow = self.unreachable_flow;
        self.has_flow_effects = true;
    }

    fn bind_break_statement(&mut self, node: NodeId) {
        self.bind_break_or_continue_statement(
            self.a.label(node),
            self.current_break_target,
            ActiveLabel::break_target,
        );
    }

    fn bind_continue_statement(&mut self, node: NodeId) {
        self.bind_break_or_continue_statement(
            self.a.label(node),
            self.current_continue_target,
            ActiveLabel::continue_target,
        );
    }

    fn bind_break_or_continue_statement(
        &mut self,
        label: NodeId,
        current_target: FlowNodeId,
        get_target: fn(&ActiveLabel<'a>) -> FlowNodeId,
    ) {
        self.bind(label);
        if !label.is_nil() {
            let active_label = self.find_active_label(self.a.text(label));
            if let Some(active_label) = self.active_labels.get_mut(active_label.index()) {
                active_label.referenced = true;
                let target = get_target(active_label);
                self.bind_break_or_continue_flow(target);
            }
        } else {
            self.bind_break_or_continue_flow(current_target);
        }
    }

    fn find_active_label(&self, name: &[u8]) -> ActiveLabelId {
        let mut label = self.active_label_list;
        while let Some(active_label) = self.active_labels.get(label.index()) {
            if active_label.name == name {
                return label;
            }
            label = active_label.next;
        }
        ActiveLabelId::NIL
    }

    fn bind_break_or_continue_flow(&mut self, flow_label: FlowNodeId) {
        if !flow_label.is_nil() {
            self.add_antecedent(flow_label, self.current_flow);
            self.current_flow = self.unreachable_flow;
            self.has_flow_effects = true;
        }
    }

    fn bind_try_statement(&mut self, node: NodeId) {
        let a = self.a;
        // We conservatively assume that *any* code in the try block can cause an exception, but we only need to track code that causes mutations (because only mutations widen the possible control flow type of a variable). The exceptionLabel is the target label for control flows that result from exceptions. We add all mutation flow nodes as antecedents of this label such that we can analyze them as possible antecedents of the start of catch or finally blocks. Furthermore, we add the current control flow to represent exceptions that occur before any mutations.
        let stmt = a.as_try_statement(node);
        let save_return_target = self.current_return_target;
        let save_exception_target = self.current_exception_target;
        let normal_exit_label = self.create_branch_label();
        let return_label = self.create_branch_label();
        let mut exception_label = self.create_branch_label();
        if !stmt.finally_block.is_nil() {
            self.current_return_target = return_label;
        }
        self.add_antecedent(exception_label, self.current_flow);
        self.current_exception_target = exception_label;
        self.bind(stmt.try_block);
        self.add_antecedent(normal_exit_label, self.current_flow);
        if !stmt.catch_clause.is_nil() {
            // Start of catch clause is the target of exceptions from try block.
            self.current_flow = self.finish_flow_label(exception_label);
            // The currentExceptionTarget now represents control flows from exceptions in the catch clause. Effectively, in a try-catch-finally, if an exception occurs in the try block, the catch block acts like a second try block.
            exception_label = self.create_branch_label();
            self.add_antecedent(exception_label, self.current_flow);
            self.current_exception_target = exception_label;
            self.bind(stmt.catch_clause);
            self.add_antecedent(normal_exit_label, self.current_flow);
        }
        self.current_return_target = save_return_target;
        self.current_exception_target = save_exception_target;
        if !stmt.finally_block.is_nil() {
            // Possible ways control can reach the finally block: 1) Normal completion of try block of a try-finally or try-catch-finally 2) Normal completion of catch block (following exception in try block) of a try-catch-finally 3) Return in try or catch block of a try-finally or try-catch-finally 4) Exception in try block of a try-finally 5) Exception in catch block of a try-catch-finally. When analyzing a control flow graph that starts inside a finally block we want to consider all five possibilities above. However, when analyzing a control flow graph that starts outside (past) the finally block, we only want to consider the first two (if we're past a finally block then it must have completed normally). Likewise, when analyzing a control flow graph from return statements in try or catch blocks in an IIFE, we only want to consider the third. To make this possible, we inject a ReduceLabel node into the control flow graph. This node contains an alternate reduced set of antecedents for the pre-finally label. As control flow analysis passes by a ReduceLabel node, the pre-finally label is temporarily switched to the reduced antecedent set.
            let finally_label = self.create_branch_label();
            let exception_and_return = self.combine_flow_lists(
                a.flow(exception_label).antecedents,
                a.flow(return_label).antecedents,
            );
            let finally_antecedents = self
                .combine_flow_lists(a.flow(normal_exit_label).antecedents, exception_and_return);
            a.update_flow(finally_label, |f| f.antecedents = finally_antecedents);
            self.current_flow = finally_label;
            self.bind(stmt.finally_block);
            if a.flow(self.current_flow)
                .flags
                .intersects(FlowFlags::UNREACHABLE)
            {
                // If the end of the finally block is unreachable, the end of the entire try statement is unreachable.
                self.current_flow = self.unreachable_flow;
            } else {
                // If we have an IIFE return target and return statements in the try or catch blocks, add a control flow that goes back through the finally block and back through only the return statements.
                if !self.current_return_target.is_nil()
                    && !a.flow(return_label).antecedents.is_nil()
                {
                    let reduce_label = self.create_reduce_label(
                        finally_label,
                        a.flow(return_label).antecedents,
                        self.current_flow,
                    );
                    self.add_antecedent(self.current_return_target, reduce_label);
                }
                // If we have an outer exception target (i.e. a containing try-finally or try-catch-finally), add a control flow that goes back through the finally block and back through each possible exception source.
                if !self.current_exception_target.is_nil()
                    && !a.flow(exception_label).antecedents.is_nil()
                {
                    let reduce_label = self.create_reduce_label(
                        finally_label,
                        a.flow(exception_label).antecedents,
                        self.current_flow,
                    );
                    self.add_antecedent(self.current_exception_target, reduce_label);
                }
                // If the end of the finally block is reachable, but the end of the try and catch blocks are not, convert the current flow to unreachable. For example, 'try { return 1; } finally { ... }' should result in an unreachable current control flow.
                if !a.flow(normal_exit_label).antecedents.is_nil() {
                    self.current_flow = self.create_reduce_label(
                        finally_label,
                        a.flow(normal_exit_label).antecedents,
                        self.current_flow,
                    );
                } else {
                    self.current_flow = self.unreachable_flow;
                }
            }
        } else {
            self.current_flow = self.finish_flow_label(normal_exit_label);
        }
    }

    fn bind_switch_statement(&mut self, node: NodeId) {
        let a = self.a;
        let stmt = a.as_switch_statement(node);
        let post_switch_label = self.create_branch_label();
        self.bind(stmt.expression);
        let save_break_target = self.current_break_target;
        let save_pre_switch_case_flow = self.pre_switch_case_flow;
        self.current_break_target = post_switch_label;
        self.pre_switch_case_flow = self.current_flow;
        self.bind(stmt.case_block);
        self.add_antecedent(post_switch_label, self.current_flow);
        let has_default = core::some(
            a.nodes(a.as_case_block(stmt.case_block).clauses).as_slice(),
            |c| a.kind(c) == Kind::DefaultClause,
        );
        if !has_default {
            let switch_clause =
                self.create_flow_switch_clause(self.pre_switch_case_flow, node, 0, 0);
            self.add_antecedent(post_switch_label, switch_clause);
        }
        self.current_break_target = save_break_target;
        self.pre_switch_case_flow = save_pre_switch_case_flow;
        self.current_flow = self.finish_flow_label(post_switch_label);
    }

    fn bind_case_block(&mut self, node: NodeId) {
        let a = self.a;
        let switch_statement = a.parent(node);
        let clauses = a.nodes(a.as_case_block(node).clauses);
        let is_narrowing_switch = a.kind(a.expression(switch_statement)) == Kind::TrueKeyword
            || is_narrowing_expression(a, self.stack_check, a.expression(switch_statement));
        let mut fallthrough_flow = self.unreachable_flow;
        let mut i: isize = 0;
        while i < clauses.len() {
            let clause_start = i;
            while a.statements(clauses.at(i)).len() == 0 && i + 1 < clauses.len() {
                if fallthrough_flow == self.unreachable_flow {
                    self.current_flow = self.pre_switch_case_flow;
                }
                self.bind(clauses.at(i));
                i += 1;
            }
            let pre_case_label = self.create_branch_label();
            let mut pre_case_flow = self.pre_switch_case_flow;
            if is_narrowing_switch {
                pre_case_flow = self.create_flow_switch_clause(
                    self.pre_switch_case_flow,
                    switch_statement,
                    clause_start,
                    i + 1,
                );
            }
            self.add_antecedent(pre_case_label, pre_case_flow);
            self.add_antecedent(pre_case_label, fallthrough_flow);
            self.current_flow = self.finish_flow_label(pre_case_label);
            let clause = clauses.at(i);
            self.bind(clause);
            fallthrough_flow = self.current_flow;
            if !a
                .flow(self.current_flow)
                .flags
                .intersects(FlowFlags::UNREACHABLE)
                && i != clauses.len() - 1
            {
                a.set_fallthrough_flow_node(clause, self.current_flow);
            }
            i += 1;
        }
    }

    fn bind_case_or_default_clause(&mut self, node: NodeId) {
        let a = self.a;
        let clause = a.as_case_or_default_clause(node);
        if !clause.expression.is_nil() {
            let save_current_flow = self.current_flow;
            self.current_flow = self.pre_switch_case_flow;
            self.bind(clause.expression);
            self.current_flow = save_current_flow;
        }
        self.bind_each(a.nodes(clause.statements));
    }

    fn bind_expression_statement(&mut self, node: NodeId) {
        let stmt = self.a.as_expression_statement(node);
        self.bind(stmt.expression);
        self.maybe_bind_expression_flow_if_call(stmt.expression);
    }

    fn maybe_bind_expression_flow_if_call(&mut self, node: NodeId) {
        let a = self.a;
        // A top level or comma expression call expression with a dotted function name and at least one argument is potentially an assertion and is therefore included in the control flow.
        if ast::is_call_expression(a, node) {
            if a.kind(a.expression(node)) != Kind::SuperKeyword
                && ast::is_dotted_name(a, a.expression(node))
            {
                self.current_flow = self.create_flow_call(self.current_flow, node);
            }
        }
    }

    fn bind_labeled_statement(&mut self, node: NodeId) {
        let a = self.a;
        let stmt = a.as_labeled_statement(node);
        let post_statement_label = self.create_branch_label();
        self.active_labels.push(ActiveLabel {
            next: self.active_label_list,
            name: a.text(stmt.label),
            break_target: post_statement_label,
            continue_target: FlowNodeId::NIL,
            referenced: false,
        });
        self.active_label_list =
            ActiveLabelId(u32::try_from(self.active_labels.len()).unwrap_or(0));
        self.bind(stmt.label);
        self.bind(stmt.statement);
        let (referenced, next) = match self.active_labels.get(self.active_label_list.index()) {
            Some(active_label) => (active_label.referenced, active_label.next),
            None => (true, ActiveLabelId::NIL),
        };
        if !referenced {
            // Mark the label as unused; the checker will decide whether to report it
            a.set_flags(stmt.label, a.flags(stmt.label) | NodeFlags::UNREACHABLE);
        }
        self.active_label_list = next;
        self.add_antecedent(post_statement_label, self.current_flow);
        self.current_flow = self.finish_flow_label(post_statement_label);
    }

    fn bind_prefix_unary_expression_flow(&mut self, node: NodeId) {
        let expr = self.a.as_prefix_unary_expression(node);
        if expr.operator == Kind::ExclamationToken {
            let save_true_target = self.current_true_target;
            std::mem::swap(
                &mut self.current_true_target,
                &mut self.current_false_target,
            );
            self.bind_each_child(node);
            self.current_false_target = self.current_true_target;
            self.current_true_target = save_true_target;
        } else {
            self.bind_each_child(node);
            if expr.operator == Kind::PlusPlusToken || expr.operator == Kind::MinusMinusToken {
                self.bind_assignment_target_flow(expr.operand);
            }
        }
    }

    fn bind_postfix_unary_expression_flow(&mut self, node: NodeId) {
        let expr = self.a.as_postfix_unary_expression(node);
        self.bind_each_child(node);
        if expr.operator == Kind::PlusPlusToken || expr.operator == Kind::MinusMinusToken {
            self.bind_assignment_target_flow(expr.operand);
        }
    }

    fn bind_destructuring_assignment_flow(&mut self, node: NodeId) {
        let expr = self.a.as_binary_expression(node);
        if self.in_assignment_pattern {
            self.in_assignment_pattern = false;
            self.bind(expr.operator_token);
            self.bind(expr.right);
            self.in_assignment_pattern = true;
            self.bind(expr.left);
            self.bind(expr.type_node);
        } else {
            self.in_assignment_pattern = true;
            self.bind(expr.left);
            self.bind(expr.type_node);
            self.in_assignment_pattern = false;
            self.bind(expr.operator_token);
            self.bind(expr.right);
        }
        self.bind_assignment_target_flow(expr.left);
    }

    fn bind_binary_expression_flow(&mut self, node: NodeId) {
        let a = self.a;
        let expr = a.as_binary_expression(node);
        let operator = a.kind(expr.operator_token);
        if ast::is_logical_or_coalescing_binary_operator(operator)
            || ast::is_logical_or_coalescing_assignment_operator(operator)
        {
            if is_top_level_logical_expression(a, node) {
                let post_expression_label = self.create_branch_label();
                let save_current_flow = self.current_flow;
                let save_has_flow_effects = self.has_flow_effects;
                self.has_flow_effects = false;
                self.bind_logical_like_expression(
                    node,
                    post_expression_label,
                    post_expression_label,
                );
                if self.has_flow_effects {
                    self.current_flow = self.finish_flow_label(post_expression_label);
                } else {
                    self.current_flow = save_current_flow;
                }
                self.has_flow_effects = self.has_flow_effects || save_has_flow_effects;
            } else {
                self.bind_logical_like_expression(
                    node,
                    self.current_true_target,
                    self.current_false_target,
                );
            }
        } else {
            self.bind(expr.left);
            self.bind(expr.type_node);
            if operator == Kind::CommaToken {
                self.maybe_bind_expression_flow_if_call(expr.left);
            }
            self.bind(expr.operator_token);
            self.bind(expr.right);
            if operator == Kind::CommaToken {
                self.maybe_bind_expression_flow_if_call(expr.right);
            }
            if ast::is_assignment_operator(operator) && !ast::is_assignment_target(a, node) {
                self.bind_assignment_target_flow(expr.left);
                if operator == Kind::EqualsToken
                    && a.kind(expr.left) == Kind::ElementAccessExpression
                {
                    let element_access = a.as_element_access_expression(expr.left);
                    if is_narrowable_operand(a, self.stack_check, element_access.expression) {
                        self.current_flow = self.create_flow_mutation(
                            FlowFlags::ARRAY_MUTATION,
                            self.current_flow,
                            node,
                        );
                    }
                }
            }
        }
    }

    fn bind_logical_like_expression(
        &mut self,
        node: NodeId,
        true_target: FlowNodeId,
        false_target: FlowNodeId,
    ) {
        let a = self.a;
        let expr = a.as_binary_expression(node);
        let pre_right_label = self.create_branch_label();
        if a.kind(expr.operator_token) == Kind::AmpersandAmpersandToken
            || a.kind(expr.operator_token) == Kind::AmpersandAmpersandEqualsToken
        {
            self.bind_condition(expr.left, pre_right_label, false_target);
        } else {
            self.bind_condition(expr.left, true_target, pre_right_label);
        }
        self.current_flow = self.finish_flow_label(pre_right_label);
        self.bind(expr.operator_token);
        if ast::is_logical_or_coalescing_assignment_operator(a.kind(expr.operator_token)) {
            self.do_with_conditional_branches(Binder::bind, expr.right, true_target, false_target);
            self.bind_assignment_target_flow(expr.left);
            let true_condition =
                self.create_flow_condition(FlowFlags::TRUE_CONDITION, self.current_flow, node);
            self.add_antecedent(true_target, true_condition);
            let false_condition =
                self.create_flow_condition(FlowFlags::FALSE_CONDITION, self.current_flow, node);
            self.add_antecedent(false_target, false_condition);
        } else {
            self.bind_condition(expr.right, true_target, false_target);
        }
    }

    fn bind_delete_expression_flow(&mut self, node: NodeId) {
        let a = self.a;
        let expr = a.as_delete_expression(node);
        self.bind_each_child(node);
        if a.kind(expr.expression) == Kind::PropertyAccessExpression {
            self.bind_assignment_target_flow(expr.expression);
        }
    }

    fn bind_conditional_expression_flow(&mut self, node: NodeId) {
        let expr = self.a.as_conditional_expression(node);
        let true_label = self.create_branch_label();
        let false_label = self.create_branch_label();
        let post_expression_label = self.create_branch_label();
        let save_current_flow = self.current_flow;
        let save_has_flow_effects = self.has_flow_effects;
        self.has_flow_effects = false;
        self.bind_condition(expr.condition, true_label, false_label);
        self.current_flow = self.finish_flow_label(true_label);
        self.bind(expr.question_token);
        self.bind(expr.when_true);
        self.add_antecedent(post_expression_label, self.current_flow);
        self.current_flow = self.finish_flow_label(false_label);
        self.bind(expr.colon_token);
        self.bind(expr.when_false);
        self.add_antecedent(post_expression_label, self.current_flow);
        if self.has_flow_effects {
            self.current_flow = self.finish_flow_label(post_expression_label);
        } else {
            self.current_flow = save_current_flow;
        }
        self.has_flow_effects = self.has_flow_effects || save_has_flow_effects;
    }

    fn bind_variable_declaration_flow(&mut self, node: NodeId) {
        let a = self.a;
        self.bind_each_child(node);
        if !a.initializer(node).is_nil()
            || ast::is_for_in_or_of_statement(a, a.parent(a.parent(node)))
        {
            self.bind_initialized_variable_flow(node);
        }
    }

    fn bind_initialized_variable_flow(&mut self, node: NodeId) {
        let a = self.a;
        if !self.stack_check.is_safe_to_recurse() {
            stack_limit(a, node.0);
            return;
        }
        let mut name = NodeId::NIL;
        match a.kind(node) {
            Kind::VariableDeclaration => {
                name = a.as_variable_declaration(node).name;
            }
            Kind::BindingElement => {
                name = a.as_binding_element(node).name;
            }
            _ => {}
        }
        if !name.is_nil() && ast::is_binding_pattern(a, name) {
            for child in a.elements(name).iter() {
                self.bind_initialized_variable_flow(child);
            }
        } else {
            self.current_flow =
                self.create_flow_mutation(FlowFlags::ASSIGNMENT, self.current_flow, node);
        }
    }

    fn bind_access_expression_flow(&mut self, node: NodeId) {
        if ast::is_optional_chain(self.a, node) {
            self.bind_optional_chain_flow(node);
        } else {
            self.bind_each_child(node);
        }
    }

    fn bind_optional_chain_flow(&mut self, node: NodeId) {
        if is_top_level_logical_expression(self.a, node) {
            let post_expression_label = self.create_branch_label();
            let save_current_flow = self.current_flow;
            let save_has_flow_effects = self.has_flow_effects;
            self.bind_optional_chain(node, post_expression_label, post_expression_label);
            if self.has_flow_effects {
                self.current_flow = self.finish_flow_label(post_expression_label);
            } else {
                self.current_flow = save_current_flow;
            }
            self.has_flow_effects = self.has_flow_effects || save_has_flow_effects;
        } else {
            self.bind_optional_chain(node, self.current_true_target, self.current_false_target);
        }
    }

    fn bind_optional_chain(
        &mut self,
        node: NodeId,
        true_target: FlowNodeId,
        false_target: FlowNodeId,
    ) {
        let a = self.a;
        // For an optional chain, we emulate the behavior of a logical expression: `a?.b` is `a && a.b`, `a?.b.c` is `a && a.b.c`, `a?.b?.c` is `a && a.b && a.b.c`, `a?.[x = 1]` is `a && a[x = 1]`. To do this we descend through the chain until we reach the root of a chain (the expression with a `?.`) and build it's CFA graph as if it were the first condition (`a && ...`). Then we bind the rest of the node as part of the "true" branch, and continue to do so as we ascend back up to the outermost chain node. We then treat the entire node as the right side of the expression.
        let mut pre_chain_label = FlowNodeId::NIL;
        if ast::is_optional_chain_root(a, node) {
            pre_chain_label = self.create_branch_label();
        }
        self.bind_optional_expression(
            a.expression(node),
            if !pre_chain_label.is_nil() {
                pre_chain_label
            } else {
                true_target
            },
            false_target,
        );
        if !pre_chain_label.is_nil() {
            self.current_flow = self.finish_flow_label(pre_chain_label);
        }
        self.do_with_conditional_branches(
            Binder::bind_optional_chain_rest,
            node,
            true_target,
            false_target,
        );
        if ast::is_outermost_optional_chain(a, node) {
            let true_condition =
                self.create_flow_condition(FlowFlags::TRUE_CONDITION, self.current_flow, node);
            self.add_antecedent(true_target, true_condition);
            let false_condition =
                self.create_flow_condition(FlowFlags::FALSE_CONDITION, self.current_flow, node);
            self.add_antecedent(false_target, false_condition);
        }
    }

    fn bind_optional_expression(
        &mut self,
        node: NodeId,
        true_target: FlowNodeId,
        false_target: FlowNodeId,
    ) {
        let a = self.a;
        self.do_with_conditional_branches(Binder::bind, node, true_target, false_target);
        if !ast::is_optional_chain(a, node) || ast::is_outermost_optional_chain(a, node) {
            let true_condition =
                self.create_flow_condition(FlowFlags::TRUE_CONDITION, self.current_flow, node);
            self.add_antecedent(true_target, true_condition);
            let false_condition =
                self.create_flow_condition(FlowFlags::FALSE_CONDITION, self.current_flow, node);
            self.add_antecedent(false_target, false_condition);
        }
    }

    fn bind_optional_chain_rest(&mut self, node: NodeId) -> bool {
        let a = self.a;
        match a.kind(node) {
            Kind::PropertyAccessExpression => {
                self.bind(a.question_dot_token(node));
                self.bind(a.name(node));
            }
            Kind::ElementAccessExpression => {
                self.bind(a.question_dot_token(node));
                self.bind(a.as_element_access_expression(node).argument_expression);
            }
            Kind::CallExpression => {
                self.bind(a.question_dot_token(node));
                self.bind_node_list(a.type_argument_list(node));
                self.bind_each(a.arguments(node));
            }
            _ => {}
        }
        false
    }

    fn bind_call_expression_flow(&mut self, node: NodeId) {
        let a = self.a;
        let call = a.as_call_expression(node);
        if ast::is_optional_chain(a, node) {
            self.bind_optional_chain_flow(node);
        } else {
            // If the target of the call expression is a function expression or arrow function we have an immediately invoked function expression (IIFE). Initialize the flowNode property to the current control flow (which includes evaluation of the IIFE arguments).
            let expr = ast::skip_parentheses(a, call.expression);
            if a.kind(expr) == Kind::FunctionExpression || a.kind(expr) == Kind::ArrowFunction {
                self.bind_node_list(call.type_arguments);
                self.bind_each(a.nodes(call.arguments));
                self.bind(call.expression);
            } else {
                self.bind_each_child(node);
                if a.kind(call.expression) == Kind::SuperKeyword {
                    self.current_flow = self.create_flow_call(self.current_flow, node);
                }
            }
        }
        if ast::is_property_access_expression(a, call.expression) {
            let access = a.as_property_access_expression(call.expression);
            if ast::is_identifier(a, access.name)
                && is_narrowable_operand(a, self.stack_check, access.expression)
                && ast::is_push_or_unshift_identifier(a, access.name)
            {
                self.current_flow =
                    self.create_flow_mutation(FlowFlags::ARRAY_MUTATION, self.current_flow, node);
            }
        }
    }

    fn bind_non_null_expression_flow(&mut self, node: NodeId) {
        if ast::is_optional_chain(self.a, node) {
            self.bind_optional_chain_flow(node);
        } else {
            self.bind_each_child(node);
        }
    }

    fn bind_binding_element_flow(&mut self, node: NodeId) {
        // When evaluating a binding pattern, the initializer is evaluated before the binding pattern, per https://tc39.es/ecma262/#sec-destructuring-binding-patterns-runtime-semantics-iteratorbindinginitialization (`BindingElement: BindingPattern Initializer?`) and https://tc39.es/ecma262/#sec-runtime-semantics-keyedbindinginitialization (`BindingElement: BindingPattern Initializer?`).
        let elem = self.a.as_binding_element(node);
        self.bind(elem.dot_dot_dot_token);
        self.bind(elem.property_name);
        self.bind_initializer(elem.initializer);
        self.bind(elem.name);
    }

    fn bind_parameter_flow(&mut self, node: NodeId) {
        let param = self.a.as_parameter_declaration(node);
        self.bind_modifiers(param.modifiers);
        self.bind(param.dot_dot_dot_token);
        self.bind(param.question_token);
        self.bind(param.type_node);
        self.bind_initializer(param.initializer);
        self.bind(param.name);
    }

    // a BindingElement/Parameter does not have side effects if initializers are not evaluated and used. (see GH#49759)
    fn bind_initializer(&mut self, node: NodeId) {
        if node.is_nil() {
            return;
        }
        let entry_flow = self.current_flow;
        self.bind(node);
        if entry_flow == self.unreachable_flow || entry_flow == self.current_flow {
            return;
        }
        let exit_flow = self.create_branch_label();
        self.add_antecedent(exit_flow, entry_flow);
        self.add_antecedent(exit_flow, self.current_flow);
        self.current_flow = self.finish_flow_label(exit_flow);
    }
}

fn set_flow_node(a: Ast<'_>, node: NodeId, flow_node: FlowNodeId) {
    if a.has_flow_node_data(node) {
        a.set_flow_node(node, flow_node);
    }
}

fn set_return_flow_node(a: Ast<'_>, node: NodeId, return_flow_node: FlowNodeId) {
    match a.kind(node) {
        Kind::Constructor
        | Kind::FunctionDeclaration
        | Kind::FunctionExpression
        | Kind::ClassStaticBlockDeclaration => {
            a.set_return_flow_node(node, return_flow_node);
        }
        _ => {}
    }
}

fn is_generator_function_expression(a: Ast<'_>, node: NodeId) -> bool {
    ast::is_function_expression(a, node) && !a.as_function_expression(node).asterisk_token.is_nil()
}

impl<'a> Binder<'a> {
    fn add_to_container_chain(&mut self, next: NodeId) {
        if !self.last_container.is_nil() {
            self.a.set_next_container(self.last_container, next);
        }
        self.last_container = next;
    }

    fn add_declaration_to_symbol(
        &mut self,
        symbol: SymbolId,
        node: NodeId,
        symbol_flags: SymbolFlags,
    ) {
        let a = self.a;
        a.update_symbol(symbol, |s| s.flags |= symbol_flags);
        a.set_symbol(node, symbol);
        let declarations = a.sym(symbol).declarations;
        let declarations = if declarations.is_nil() {
            self.new_single_declaration(node)
        } else {
            let appended = core::append_if_unique(declarations.as_slice().to_vec(), node);
            // The list stays as it is when the node is in it.
            if appended.len() == declarations.as_slice().len() {
                declarations
            } else {
                self.list_of(&appended)
            }
        };
        a.update_symbol(symbol, |s| s.declarations = declarations);
        // On merge of const enum module with class or function, reset const enum only flag (namespaces will already recalculate)
        let flags = a.sym(symbol).flags;
        if flags.intersects(SymbolFlags::CONST_ENUM_ONLY_MODULE)
            && flags
                .intersects(SymbolFlags::FUNCTION | SymbolFlags::CLASS | SymbolFlags::REGULAR_ENUM)
        {
            a.update_symbol(symbol, |s| {
                s.flags = s.flags.without(SymbolFlags::CONST_ENUM_ONLY_MODULE);
            });
            self.not_const_enum_only_modules.add(symbol);
        }
        if symbol_flags.intersects(SymbolFlags::VALUE) {
            set_value_declaration(a, symbol, node);
        }
    }
}

pub fn set_value_declaration(a: Ast<'_>, symbol: SymbolId, node: NodeId) {
    let value_declaration = a.sym(symbol).value_declaration;
    if value_declaration.is_nil()
        || (is_assignment_declaration(a, value_declaration) && !is_assignment_declaration(a, node))
        || (a.kind(value_declaration) != a.kind(node)
            && is_effective_module_declaration(a, value_declaration))
    {
        // Non-assignment declarations take precedence over assignment declarations and non-namespace declarations take precedence over namespace declarations.
        a.update_symbol(symbol, |s| s.value_declaration = node);
    }
}

pub fn get_container_flags(a: Ast<'_>, node: NodeId) -> ContainerFlags {
    match a.kind(node) {
        Kind::ClassExpression
        | Kind::ClassDeclaration
        | Kind::EnumDeclaration
        | Kind::ObjectLiteralExpression
        | Kind::TypeLiteral
        | Kind::JsxAttributes => ContainerFlags::IS_CONTAINER,
        Kind::InterfaceDeclaration => ContainerFlags::IS_CONTAINER | ContainerFlags::IS_INTERFACE,
        Kind::ModuleDeclaration
        | Kind::TypeAliasDeclaration
        | Kind::JSTypeAliasDeclaration
        | Kind::MappedType
        | Kind::IndexSignature => ContainerFlags::IS_CONTAINER | ContainerFlags::HAS_LOCALS,
        Kind::SourceFile => {
            ContainerFlags::IS_CONTAINER
                | ContainerFlags::IS_CONTROL_FLOW_CONTAINER
                | ContainerFlags::HAS_LOCALS
        }
        Kind::GetAccessor | Kind::SetAccessor | Kind::MethodDeclaration => {
            if ast::is_object_literal_or_class_expression_method_or_accessor(a, node) {
                return ContainerFlags::IS_CONTAINER
                    | ContainerFlags::IS_CONTROL_FLOW_CONTAINER
                    | ContainerFlags::HAS_LOCALS
                    | ContainerFlags::IS_FUNCTION_LIKE
                    | ContainerFlags::IS_OBJECT_LITERAL_OR_CLASS_EXPRESSION_METHOD_OR_ACCESSOR
                    | ContainerFlags::IS_THIS_CONTAINER;
            }
            // Falls through to the case of constructors, function declarations and class static blocks.
            ContainerFlags::IS_CONTAINER
                | ContainerFlags::IS_CONTROL_FLOW_CONTAINER
                | ContainerFlags::HAS_LOCALS
                | ContainerFlags::IS_FUNCTION_LIKE
                | ContainerFlags::IS_THIS_CONTAINER
        }
        Kind::Constructor | Kind::FunctionDeclaration | Kind::ClassStaticBlockDeclaration => {
            ContainerFlags::IS_CONTAINER
                | ContainerFlags::IS_CONTROL_FLOW_CONTAINER
                | ContainerFlags::HAS_LOCALS
                | ContainerFlags::IS_FUNCTION_LIKE
                | ContainerFlags::IS_THIS_CONTAINER
        }
        Kind::MethodSignature
        | Kind::CallSignature
        | Kind::FunctionType
        | Kind::ConstructSignature
        | Kind::ConstructorType => {
            ContainerFlags::IS_CONTAINER
                | ContainerFlags::IS_CONTROL_FLOW_CONTAINER
                | ContainerFlags::HAS_LOCALS
                | ContainerFlags::IS_FUNCTION_LIKE
                | ContainerFlags::PROPAGATES_THIS_KEYWORD
        }
        Kind::FunctionExpression => {
            ContainerFlags::IS_CONTAINER
                | ContainerFlags::IS_CONTROL_FLOW_CONTAINER
                | ContainerFlags::HAS_LOCALS
                | ContainerFlags::IS_FUNCTION_LIKE
                | ContainerFlags::IS_FUNCTION_EXPRESSION
                | ContainerFlags::IS_THIS_CONTAINER
        }
        Kind::ArrowFunction => {
            ContainerFlags::IS_CONTAINER
                | ContainerFlags::IS_CONTROL_FLOW_CONTAINER
                | ContainerFlags::HAS_LOCALS
                | ContainerFlags::IS_FUNCTION_LIKE
                | ContainerFlags::IS_FUNCTION_EXPRESSION
                | ContainerFlags::PROPAGATES_THIS_KEYWORD
        }
        Kind::ModuleBlock => ContainerFlags::IS_CONTROL_FLOW_CONTAINER,
        Kind::PropertyDeclaration => {
            if !a.initializer(node).is_nil() {
                ContainerFlags::IS_CONTROL_FLOW_CONTAINER | ContainerFlags::IS_THIS_CONTAINER
            } else {
                ContainerFlags::NONE
            }
        }
        Kind::CatchClause
        | Kind::ForStatement
        | Kind::ForInStatement
        | Kind::ForOfStatement
        | Kind::CaseBlock => ContainerFlags::IS_BLOCK_SCOPED_CONTAINER | ContainerFlags::HAS_LOCALS,
        Kind::Block => {
            if ast::is_function_like(a, a.parent(node))
                || ast::is_class_static_block_declaration(a, a.parent(node))
            {
                ContainerFlags::NONE
            } else {
                ContainerFlags::IS_BLOCK_SCOPED_CONTAINER | ContainerFlags::HAS_LOCALS
            }
        }
        _ => ContainerFlags::NONE,
    }
}

fn is_narrowing_expression(a: Ast<'_>, stack_check: StackCheck, expr: NodeId) -> bool {
    if !stack_check.is_safe_to_recurse() {
        stack_limit(a, expr.0);
        return false;
    }
    match a.kind(expr) {
        Kind::Identifier | Kind::ThisKeyword => true,
        Kind::PropertyAccessExpression | Kind::ElementAccessExpression => {
            contains_narrowable_reference(a, stack_check, expr)
        }
        Kind::CallExpression => has_narrowable_argument(a, stack_check, expr),
        Kind::ParenthesizedExpression | Kind::NonNullExpression | Kind::TypeOfExpression => {
            is_narrowing_expression(a, stack_check, a.expression(expr))
        }
        Kind::BinaryExpression => is_narrowing_binary_expression(a, stack_check, expr),
        Kind::PrefixUnaryExpression => {
            a.as_prefix_unary_expression(expr).operator == Kind::ExclamationToken
                && is_narrowing_expression(
                    a,
                    stack_check,
                    a.as_prefix_unary_expression(expr).operand,
                )
        }
        _ => false,
    }
}

fn contains_narrowable_reference(a: Ast<'_>, stack_check: StackCheck, expr: NodeId) -> bool {
    if !stack_check.is_safe_to_recurse() {
        stack_limit(a, expr.0);
        return false;
    }
    if is_narrowable_reference(a, stack_check, expr) {
        return true;
    }
    if a.flags(expr).intersects(NodeFlags::OPTIONAL_CHAIN) {
        match a.kind(expr) {
            Kind::PropertyAccessExpression
            | Kind::ElementAccessExpression
            | Kind::CallExpression
            | Kind::NonNullExpression => {
                return contains_narrowable_reference(a, stack_check, a.expression(expr));
            }
            _ => {}
        }
    }
    false
}

fn is_narrowable_reference(a: Ast<'_>, stack_check: StackCheck, node: NodeId) -> bool {
    if !stack_check.is_safe_to_recurse() {
        stack_limit(a, node.0);
        return false;
    }
    match a.kind(node) {
        Kind::Identifier | Kind::ThisKeyword | Kind::SuperKeyword | Kind::MetaProperty => true,
        Kind::PropertyAccessExpression
        | Kind::ParenthesizedExpression
        | Kind::NonNullExpression => is_narrowable_reference(a, stack_check, a.expression(node)),
        Kind::ElementAccessExpression => {
            let expr = a.as_element_access_expression(node);
            ast::is_string_or_numeric_literal_like(a, expr.argument_expression)
                || (ast::is_entity_name_expression(a, expr.argument_expression)
                    && is_narrowable_reference(a, stack_check, expr.expression))
        }
        Kind::BinaryExpression => {
            let expr = a.as_binary_expression(node);
            (a.kind(expr.operator_token) == Kind::CommaToken
                && is_narrowable_reference(a, stack_check, expr.right))
                || (ast::is_assignment_operator(a.kind(expr.operator_token))
                    && ast::is_left_hand_side_expression(a, expr.left))
        }
        _ => false,
    }
}

fn has_narrowable_argument(a: Ast<'_>, stack_check: StackCheck, expr: NodeId) -> bool {
    let call = a.as_call_expression(expr);
    for argument in a.nodes(call.arguments).iter() {
        if contains_narrowable_reference(a, stack_check, argument) {
            return true;
        }
    }
    if ast::is_property_access_expression(a, call.expression) {
        if contains_narrowable_reference(a, stack_check, a.expression(call.expression)) {
            return true;
        }
    }
    false
}

fn is_narrowing_binary_expression(a: Ast<'_>, stack_check: StackCheck, expr: NodeId) -> bool {
    let expr = a.as_binary_expression(expr);
    match a.kind(expr.operator_token) {
        Kind::EqualsToken
        | Kind::BarBarEqualsToken
        | Kind::AmpersandAmpersandEqualsToken
        | Kind::QuestionQuestionEqualsToken => {
            contains_narrowable_reference(a, stack_check, expr.left)
        }
        Kind::EqualsEqualsToken
        | Kind::ExclamationEqualsToken
        | Kind::EqualsEqualsEqualsToken
        | Kind::ExclamationEqualsEqualsToken => {
            let left = ast::skip_parentheses(a, expr.left);
            let right = ast::skip_parentheses(a, expr.right);
            is_narrowable_operand(a, stack_check, left)
                || is_narrowable_operand(a, stack_check, right)
                || is_narrowing_type_of_operands(a, stack_check, right, left)
                || is_narrowing_type_of_operands(a, stack_check, left, right)
                || ((ast::is_boolean_literal(a, right)
                    && is_narrowing_expression(a, stack_check, left))
                    || (ast::is_boolean_literal(a, left)
                        && is_narrowing_expression(a, stack_check, right)))
        }
        Kind::InstanceOfKeyword => is_narrowable_operand(a, stack_check, expr.left),
        Kind::InKeyword => is_narrowing_expression(a, stack_check, expr.right),
        Kind::CommaToken => is_narrowing_expression(a, stack_check, expr.right),
        _ => false,
    }
}

fn is_narrowable_operand(a: Ast<'_>, stack_check: StackCheck, expr: NodeId) -> bool {
    if !stack_check.is_safe_to_recurse() {
        stack_limit(a, expr.0);
        return false;
    }
    match a.kind(expr) {
        Kind::ParenthesizedExpression => {
            return is_narrowable_operand(a, stack_check, a.expression(expr));
        }
        Kind::BinaryExpression => {
            let binary = a.as_binary_expression(expr);
            match a.kind(binary.operator_token) {
                Kind::EqualsToken => return is_narrowable_operand(a, stack_check, binary.left),
                Kind::CommaToken => return is_narrowable_operand(a, stack_check, binary.right),
                _ => {}
            }
        }
        _ => {}
    }
    contains_narrowable_reference(a, stack_check, expr)
}

fn is_narrowing_type_of_operands(
    a: Ast<'_>,
    stack_check: StackCheck,
    expr1: NodeId,
    expr2: NodeId,
) -> bool {
    ast::is_type_of_expression(a, expr1)
        && is_narrowable_operand(a, stack_check, a.expression(expr1))
        && ast::is_string_literal_like(a, expr2)
}

impl<'a> Binder<'a> {
    fn error_on_node(&mut self, node: NodeId, message: MessageId, args: &[Arg<'_>]) {
        let diagnostic = self.create_diagnostic_for_node(node, message, args);
        self.add_diagnostic(diagnostic);
    }

    fn error_on_first_token(&mut self, node: NodeId, message: MessageId, args: &[Arg<'_>]) {
        let span = scanner::get_range_of_token_at_position(self.a, self.file, self.a.pos(node));
        let diagnostic = self
            .diagnostic_store
            .new_diagnostic(self.file, span, message, args);
        self.add_diagnostic(diagnostic);
    }

    // Inside the binder, we may create a diagnostic for an as-yet unbound node (with potentially no parent pointers, implying no accessible source file). If so, the node _must_ be in the current file (as that's the only way anything could have traversed to it to yield it as the error node). This version of `createDiagnosticForNode` uses the binder's context to account for this, and always yields correct diagnostics even in these situations.
    fn create_diagnostic_for_node(
        &mut self,
        node: NodeId,
        message: MessageId,
        args: &[Arg<'_>],
    ) -> DiagnosticId {
        let loc = scanner::get_error_range_for_node(self.a, self.file, node);
        self.diagnostic_store
            .new_diagnostic(self.file, loc, message, args)
    }

    fn add_diagnostic(&mut self, diagnostic: DiagnosticId) {
        self.bind_diagnostics.push(diagnostic);
    }
}

pub fn is_signed_numeric_literal(a: Ast<'_>, node: NodeId) -> bool {
    if a.kind(node) == Kind::PrefixUnaryExpression {
        let node = a.as_prefix_unary_expression(node);
        return (node.operator == Kind::PlusToken || node.operator == Kind::MinusToken)
            && ast::is_numeric_literal(a, node.operand);
    }
    false
}

fn get_optional_symbol_flag_for_node(a: Ast<'_>, node: NodeId) -> SymbolFlags {
    let postfix_token = a.postfix_token(node);
    if !postfix_token.is_nil() && a.kind(postfix_token) == Kind::QuestionToken {
        SymbolFlags::OPTIONAL
    } else {
        SymbolFlags::NONE
    }
}

pub fn is_function_symbol(a: Ast<'_>, symbol: SymbolId) -> bool {
    let d = a.sym(symbol).value_declaration;
    if !d.is_nil() {
        if ast::is_function_declaration(a, d) {
            return true;
        }
        if ast::is_variable_declaration(a, d) {
            let var_decl = a.as_variable_declaration(d);
            if !var_decl.initializer.is_nil() {
                return ast::is_function_like(a, var_decl.initializer);
            }
        }
    }
    false
}

fn is_statement_condition(a: Ast<'_>, node: NodeId) -> bool {
    let parent = a.parent(node);
    match a.kind(parent) {
        Kind::IfStatement | Kind::WhileStatement | Kind::DoStatement => {
            a.expression(parent) == node
        }
        Kind::ForStatement => a.as_for_statement(parent).condition == node,
        Kind::ConditionalExpression => a.as_conditional_expression(parent).condition == node,
        _ => false,
    }
}

fn is_top_level_logical_expression(a: Ast<'_>, node: NodeId) -> bool {
    let mut node = node;
    while ast::is_parenthesized_expression(a, a.parent(node))
        || (ast::is_prefix_unary_expression(a, a.parent(node))
            && a.as_prefix_unary_expression(a.parent(node)).operator == Kind::ExclamationToken)
    {
        node = a.parent(node);
    }
    !is_statement_condition(a, node)
        && !ast::is_logical_expression(a, a.parent(node))
        && !(ast::is_optional_chain(a, a.parent(node)) && a.expression(a.parent(node)) == node)
}

fn is_assignment_declaration(a: Ast<'_>, decl: NodeId) -> bool {
    ast::is_binary_expression(a, decl)
        || ast::is_access_expression(a, decl)
        || ast::is_identifier(a, decl)
        || ast::is_call_expression(a, decl)
}

fn is_effective_module_declaration(a: Ast<'_>, node: NodeId) -> bool {
    ast::is_module_declaration(a, node) || ast::is_identifier(a, node)
}
