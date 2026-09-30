// checker/nodebuilderscopes.go: the scopes that the node builder enters for a signature or a mapped type. Upstream returns a function that undoes a scope: here each enter returns the state that its exit takes.
use crate::ast::{
    Kind, NodeId, SymbolId, SymbolTableId, is_binding_pattern, is_block, is_parameter_declaration,
};
use crate::checker::nodebuilderimpl::{NodeBuilderContext, NodeBuilderImpl};
use crate::checker::{Checker, SignatureId, TypeId, TypeMapperId};
use crate::collections::{CopyOnWriteMap, CopyOnWriteSet};
use crate::nodebuilder::Flags;

// The four states that cloneNodeBuilderContext saves.
pub struct ContextScope {
    names: CopyOnWriteMap<TypeId, NodeId>,
    names_by_text: CopyOnWriteSet<Vec<u8>>,
    names_by_text_next_name_count: CopyOnWriteMap<Vec<u8>, isize>,
    symbol_list: CopyOnWriteSet<SymbolId>,
}

// Make type parameters created within this context not consume the name outside this context: sibling scopes name their type parameters independently, so `export const y: <T>(x: T) => T` is not written as `<T_1>(x: T_1) => T_1` after a sibling used `T`.
pub(crate) fn clone_node_builder_context(context: &mut NodeBuilderContext) -> ContextScope {
    ContextScope {
        names: context.type_parameter_names.enter_scope(),
        names_by_text: context.type_parameter_names_by_text.enter_scope(),
        names_by_text_next_name_count: context
            .type_parameter_names_by_text_next_name_count
            .enter_scope(),
        symbol_list: context.type_parameter_symbol_list.enter_scope(),
    }
}

fn restore_node_builder_context(context: &mut NodeBuilderContext, saved: ContextScope) {
    context.type_parameter_names = saved.names;
    context.type_parameter_names_by_text = saved.names_by_text;
    context.type_parameter_names_by_text_next_name_count = saved.names_by_text_next_name_count;
    context.type_parameter_symbol_list = saved.symbol_list;
}

struct LocalsRecord<'a> {
    name: &'a [u8],
    old_symbol: SymbolId,
}

// What addSymbolTypeToContext returns a function for.
#[derive(Clone, Copy)]
pub struct SymbolTypeRestore {
    id: SymbolId,
    old_type: Option<TypeId>,
}

// The locals that an existing fake scope gets back when the scope is left.
pub struct FakeScopeUndo<'a> {
    locals: SymbolTableId,
    new_locals: Vec<&'a [u8]>,
    old_locals: Vec<LocalsRecord<'a>>,
}

// pushFakeScope between its start and the end of `addAll`.
struct FakeScope<'a> {
    kind: &'static [u8],
    existing_fake_scope: NodeId,
    locals: SymbolTableId,
    new_locals: Vec<&'a [u8]>,
    old_locals: Vec<LocalsRecord<'a>>,
}

pub struct ScopeCleanup<'a> {
    cleanup_params: Option<FakeScopeUndo<'a>>,
    cleanup_type_params: Option<FakeScopeUndo<'a>>,
    cleanup_context: ContextScope,
    old_enclosing_decl: NodeId,
    old_mapper: TypeMapperId,
}

impl NodeBuilderImpl {
    pub(crate) fn add_symbol_type_to_context(
        self,
        c: &mut Checker<'_>,
        symbol: SymbolId,
        t: TypeId,
    ) -> SymbolTypeRestore {
        let old_type = self.ctx_mut(c).enclosing_symbol_types.insert(symbol, t);
        SymbolTypeRestore {
            id: symbol,
            old_type,
        }
    }

    pub(crate) fn restore_symbol_type_in_context(
        self,
        c: &mut Checker<'_>,
        restore: SymbolTypeRestore,
    ) {
        match restore.old_type {
            Some(old_type) => {
                self.ctx_mut(c)
                    .enclosing_symbol_types
                    .insert(restore.id, old_type);
            }
            None => {
                self.ctx_mut(c).enclosing_symbol_types.remove(&restore.id);
            }
        }
    }

    pub(crate) fn enter_signature_scope<'a>(
        self,
        c: &mut Checker<'a>,
        signature: SignatureId,
    ) -> (Vec<SymbolId>, ScopeCleanup<'a>) {
        let expanded_params = c
            .get_expanded_parameters(signature, true)
            .into_iter()
            .next()
            .unwrap_or_default();
        let declaration = c.signatures[signature].declaration;
        let type_parameters: Vec<TypeId> =
            c.signatures[signature].type_parameters.as_slice().to_vec();
        let parameters: Vec<SymbolId> = c.signatures[signature].parameters.as_slice().to_vec();
        let mapper = c.signatures[signature].mapper;
        let cleanup = self.enter_new_scope(
            c,
            declaration,
            Some(&expanded_params),
            &type_parameters,
            Some(&parameters),
            mapper,
        );
        (expanded_params, cleanup)
    }

    fn push_fake_scope_start<'a>(self, c: &mut Checker<'a>, kind: &'static [u8]) -> FakeScope<'a> {
        // We only ever need to look two declarations upward.
        let a = c.ast;
        let enclosing_declaration = self.ctx(c).enclosing_declaration;
        c.assert(
            !enclosing_declaration.is_nil(),
            "b.ctx.enclosingDeclaration != nil",
        );
        let is_fake_scope_of_kind = |c: &Checker<'a>, node: NodeId| {
            c.node_builder
                .impl_
                .links
                .get(&node)
                .and_then(|links| links.fake_scope_for_signature_declaration.as_deref())
                == Some(kind)
        };
        let mut existing_fake_scope = NodeId::NIL;
        if is_fake_scope_of_kind(c, enclosing_declaration) {
            existing_fake_scope = enclosing_declaration;
        }
        let parent = a.parent(enclosing_declaration);
        if existing_fake_scope.is_nil() && !parent.is_nil() && is_fake_scope_of_kind(c, parent) {
            existing_fake_scope = parent;
        }
        c.assert(
            existing_fake_scope.is_nil() || is_block(a, existing_fake_scope),
            "existingFakeScope == nil || ast.IsBlock(existingFakeScope)",
        );

        let mut locals = SymbolTableId::NIL;
        if !existing_fake_scope.is_nil() {
            locals = a.locals(existing_fake_scope);
        }
        if locals.is_nil() {
            locals = a.new_table();
        }
        FakeScope {
            kind,
            existing_fake_scope,
            locals,
            new_locals: Vec::new(),
            old_locals: Vec::new(),
        }
    }

    // `addSymbol` of pushFakeScope.
    fn fake_scope_add<'a>(
        c: &Checker<'a>,
        scope: &mut FakeScope<'a>,
        name: &'a [u8],
        symbol: SymbolId,
    ) {
        let a = c.ast;
        if !scope.existing_fake_scope.is_nil() {
            let old_symbol = a.table_get(scope.locals, name);
            if old_symbol.is_nil() {
                scope.new_locals.push(name);
            } else {
                scope.old_locals.push(LocalsRecord { name, old_symbol });
            }
        }
        a.table_set(scope.locals, name, symbol);
    }

    fn push_fake_scope_end<'a>(
        self,
        c: &mut Checker<'a>,
        scope: FakeScope<'a>,
    ) -> Option<FakeScopeUndo<'a>> {
        let a = c.ast;
        if scope.existing_fake_scope.is_nil() {
            // Use a Block for this; the type of the node doesn't matter so long as it can hold locals, and this is slightly more efficient than a conditional type.
            let statements = self.f(c).new_node_list(&[]);
            let fake_scope = self.f(c).new_block(statements, false);
            c.node_builder
                .impl_
                .links
                .entry(fake_scope)
                .or_default()
                .fake_scope_for_signature_declaration = Some(scope.kind.to_vec());
            a.set_locals(fake_scope, scope.locals);
            let enclosing_declaration = self.ctx(c).enclosing_declaration;
            a.set_parent(fake_scope, enclosing_declaration);
            self.ctx_mut(c).enclosing_declaration = fake_scope;
            None
        } else {
            // We did not create the current scope, so we have to clean it up
            Some(FakeScopeUndo {
                locals: scope.locals,
                new_locals: scope.new_locals,
                old_locals: scope.old_locals,
            })
        }
    }

    fn fake_scope_undo(c: &Checker<'_>, undo: FakeScopeUndo<'_>) {
        let a = c.ast;
        for s in undo.new_locals {
            a.table_delete(undo.locals, s);
        }
        for s in undo.old_locals {
            a.table_set(undo.locals, s.name, s.old_symbol);
        }
    }

    // `bindPattern` of enterNewScope: upstream returns after the first element of the pattern.
    fn bind_pattern<'a>(c: &mut Checker<'a>, scope: &mut FakeScope<'a>, pattern: NodeId) {
        let a = c.ast;
        let elements = a.element_list(pattern);
        let Some(&e) = a.nodes(elements).as_slice().first() else {
            return;
        };
        match a.kind(e) {
            Kind::OmittedExpression => {}
            Kind::BindingElement => Self::bind_element(c, scope, e),
            _ => c.fail("Unhandled binding element kind"),
        }
    }

    // `bindElement` of enterNewScope.
    fn bind_element<'a>(c: &mut Checker<'a>, scope: &mut FakeScope<'a>, e: NodeId) {
        if !c.stack_check.is_safe_to_recurse() {
            return c.stack_limit();
        }
        let a = c.ast;
        let name = a.name(e);
        if !name.is_nil() && is_binding_pattern(a, name) {
            return Self::bind_pattern(c, scope, name);
        }
        let symbol = c.get_symbol_of_declaration(e);
        // omitted expressions are now parsed as nameless binding patterns and also have no symbol
        if !symbol.is_nil() {
            Self::fake_scope_add(c, scope, a.sym(symbol).name, symbol);
        }
    }

    pub(crate) fn enter_new_scope<'a>(
        self,
        c: &mut Checker<'a>,
        declaration: NodeId,
        expanded_params: Option<&[SymbolId]>,
        type_parameters: &[TypeId],
        original_parameters: Option<&[SymbolId]>,
        mapper: TypeMapperId,
    ) -> ScopeCleanup<'a> {
        let a = c.ast;
        let cleanup_context = clone_node_builder_context(self.ctx_mut(c));
        // For regular function/method declarations, the enclosing declaration will already be signature.declaration, so this is a no-op: for arrow functions and function expressions the enclosing declaration is set here so that symbol resolution sees the parameters.
        let mut cleanup_params: Option<FakeScopeUndo<'a>> = None;
        let mut cleanup_type_params: Option<FakeScopeUndo<'a>> = None;
        let old_enclosing_decl = self.ctx(c).enclosing_declaration;
        let old_mapper = self.ctx(c).mapper;
        if !mapper.is_nil() {
            self.ctx_mut(c).mapper = mapper;
        }
        if !self.ctx(c).enclosing_declaration.is_nil() && !declaration.is_nil() {
            // As a performance optimization, reuse the same fake scope within this chain: a block that holds the locals that the signature brings into scope.
            if let Some(expanded_params) =
                expanded_params.filter(|params| params.iter().any(|p| !p.is_nil()))
            {
                let mut scope = self.push_fake_scope_start(c, b"params");
                for (p_index, param) in expanded_params.iter().copied().enumerate() {
                    let original_param = original_parameters
                        .and_then(|parameters| parameters.get(p_index))
                        .copied()
                        .unwrap_or(SymbolId::NIL);
                    if original_parameters.is_some() && original_param != param {
                        // Can't reference the expanded parameter directly, add only the original one
                        if !original_param.is_nil() {
                            Self::fake_scope_add(
                                c,
                                &mut scope,
                                a.sym(original_param).name,
                                original_param,
                            );
                        }
                    } else {
                        // A parameter whose name is a binding pattern brings the names of the pattern into scope instead of its own.
                        let mut bound_pattern = false;
                        for d in a.sym(param).declarations.as_slice().iter().copied() {
                            if is_parameter_declaration(a, d)
                                && !a.name(d).is_nil()
                                && is_binding_pattern(a, a.name(d))
                            {
                                Self::bind_pattern(c, &mut scope, a.name(d));
                                bound_pattern = true;
                                break;
                            }
                        }
                        if !bound_pattern {
                            Self::fake_scope_add(c, &mut scope, a.sym(param).name, param);
                        }
                    }
                }
                cleanup_params = self.push_fake_scope_end(c, scope);
            }

            if self
                .ctx(c)
                .flags
                .intersects(Flags::GENERATE_NAMES_FOR_SHADOWED_TYPE_PARAMS)
                && type_parameters.iter().any(|p| !p.is_nil())
            {
                let mut scope = self.push_fake_scope_start(c, b"typeParams");
                for type_param in type_parameters.iter().copied() {
                    if type_param.is_nil() {
                        continue;
                    }
                    let name_node = self.type_parameter_to_name(c, type_param);
                    let type_param_name = a.text(name_node);
                    let type_param_symbol = c.types[type_param].symbol;
                    Self::fake_scope_add(c, &mut scope, type_param_name, type_param_symbol);
                }
                cleanup_type_params = self.push_fake_scope_end(c, scope);
            }
        }

        ScopeCleanup {
            cleanup_params,
            cleanup_type_params,
            cleanup_context,
            old_enclosing_decl,
            old_mapper,
        }
    }

    // The function that enterNewScope returns upstream.
    pub(crate) fn exit_new_scope(self, c: &mut Checker<'_>, cleanup: ScopeCleanup<'_>) {
        if let Some(cleanup_params) = cleanup.cleanup_params {
            Self::fake_scope_undo(c, cleanup_params);
        }
        if let Some(cleanup_type_params) = cleanup.cleanup_type_params {
            Self::fake_scope_undo(c, cleanup_type_params);
        }
        let ctx = self.ctx_mut(c);
        restore_node_builder_context(ctx, cleanup.cleanup_context);
        ctx.enclosing_declaration = cleanup.old_enclosing_decl;
        ctx.mapper = cleanup.old_mapper;
    }
}
