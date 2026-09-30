// checker/nodebuilder.go: the context stack and the entry points of the node builder. A checker has one node builder: its handle is a unit value and its state is the field `node_builder` of the checker.
use crate::ast::{Kind, NodeId, SymbolFlags, SymbolId, get_source_file_of_node};
use crate::checker::nodebuilderimpl::{
    NodeBuilderContext, NodeBuilderImpl, NodeBuilderImplState, new_node_builder_impl,
};
use crate::checker::symboltracker::new_symbol_tracker_impl;
use crate::checker::{Checker, SignatureId, TypeId, TypePredicateId};
use crate::nodebuilder::{Flags, InternalFlags, SymbolTracker};
use crate::printer::{EmitContext, new_emit_context};
use bun_collections::HashMap;

// The fields of NodeBuilder. `host` is the program of the checker and has no field here.
#[derive(Default)]
pub struct NodeBuilderState {
    pub ctx_stack: Vec<Option<Box<NodeBuilderContext>>>,
    pub impl_: NodeBuilderImplState,
    // nil for non-hover callers
    pub verbosity: Option<VerbosityContext>,
    // `c.typeToStringNodebuilder != nil`
    pub created: bool,
}

// VerbosityContext controls hover-expansion behavior in the node builder: None means no expansion, level 0 detects expandability without expanding, level 1+ expands.
#[derive(Clone, Copy, Default, Debug)]
pub struct VerbosityContext {
    // 0 = default (no expansion), 1+ = expansion depth
    pub level: isize,
    // 0 = use default
    pub max_truncation_length: isize,
    // output: whether increasing Level would reveal more
    pub can_increase_verbosity: bool,
    // output: whether output was truncated
    pub truncated: bool,
}

// `*NodeBuilder`: the receiver of the upstream methods.
#[derive(Clone, Copy, Default)]
pub struct NodeBuilder;

impl NodeBuilder {
    // EmitContext implements NodeBuilderInterface.
    pub fn emit_context<'c>(self, c: &'c mut Checker<'_>) -> &'c mut EmitContext {
        &mut c.node_builder.impl_.e
    }

    pub fn enter_context(
        self,
        c: &mut Checker<'_>,
        enclosing_declaration: NodeId,
        flags: Flags,
        internal_flags: InternalFlags,
        tracker: Option<Box<dyn SymbolTracker>>,
    ) {
        let mut verbosity_level: isize = -1;
        let mut max_truncation_length: isize = 0;
        if let Some(verbosity) = c.node_builder.verbosity {
            verbosity_level = verbosity.level;
            max_truncation_length = verbosity.max_truncation_length;
        }
        let previous = c.node_builder.impl_.ctx.take();
        c.node_builder.ctx_stack.push(previous);
        c.node_builder.impl_.ctx = Some(Box::new(NodeBuilderContext {
            tracker: new_symbol_tracker_impl(tracker),
            flags,
            internal_flags,
            max_expansion_depth: verbosity_level,
            max_truncation_length,
            enclosing_declaration,
            enclosing_file: get_source_file_of_node(c.ast, enclosing_declaration),
            ..NodeBuilderContext::default()
        }));
    }

    // propagateVerbosityOut copies expansion signals from the context to the VerbosityContext output.
    pub fn propagate_verbosity_out(self, c: &mut Checker<'_>) {
        let ctx = c.node_builder.impl_.ctx();
        let (can_increase, truncated) = (ctx.can_increase_expansion_depth, ctx.expansion_truncated);
        if let Some(verbosity) = c.node_builder.verbosity.as_mut() {
            // Only set to true, never clear: multiple calls share the same VerbosityContext
            if can_increase {
                verbosity.can_increase_verbosity = true;
            }
            if truncated {
                verbosity.truncated = true;
            }
        }
    }

    pub fn pop_context(self, c: &mut Checker<'_>) {
        match c.node_builder.ctx_stack.pop() {
            None => c.node_builder.impl_.ctx = None,
            Some(previous) => c.node_builder.impl_.ctx = previous,
        }
    }

    pub fn exit_context(self, c: &mut Checker<'_>, result: NodeId) -> NodeId {
        self.propagate_verbosity_out(c);
        self.exit_context_check(c);
        // `defer b.popContext()`: the context is read before it is popped.
        let encountered_error = c.node_builder.impl_.ctx().encountered_error;
        self.pop_context(c);
        if encountered_error {
            return NodeId::NIL;
        }
        result
    }

    pub fn exit_context_check(self, c: &mut Checker<'_>) {
        let ctx = c.node_builder.impl_.ctx_mut();
        if ctx.truncating && ctx.flags.intersects(Flags::NO_TRUNCATION) {
            crate::checker::symboltracker::SymbolTrackerImpl::report_truncation_error(ctx);
        }
    }

    // SignatureToSignatureDeclaration implements NodeBuilderInterface.
    pub fn signature_to_signature_declaration(
        self,
        c: &mut Checker<'_>,
        signature: SignatureId,
        kind: Kind,
        enclosing_declaration: NodeId,
        flags: Flags,
        internal_flags: InternalFlags,
        tracker: Option<Box<dyn SymbolTracker>>,
    ) -> NodeId {
        self.enter_context(c, enclosing_declaration, flags, internal_flags, tracker);
        let result =
            NodeBuilderImpl.signature_to_signature_declaration_helper(c, signature, kind, None);
        self.exit_context(c, result)
    }

    // SymbolToEntityName implements NodeBuilderInterface.
    pub fn symbol_to_entity_name(
        self,
        c: &mut Checker<'_>,
        symbol: SymbolId,
        meaning: SymbolFlags,
        enclosing_declaration: NodeId,
        flags: Flags,
        internal_flags: InternalFlags,
        tracker: Option<Box<dyn SymbolTracker>>,
    ) -> NodeId {
        self.enter_context(c, enclosing_declaration, flags, internal_flags, tracker);
        let result = NodeBuilderImpl.symbol_to_name(c, symbol, meaning, false);
        self.exit_context(c, result)
    }

    // SymbolToNode implements NodeBuilderInterface.
    pub fn symbol_to_node(
        self,
        c: &mut Checker<'_>,
        symbol: SymbolId,
        meaning: SymbolFlags,
        enclosing_declaration: NodeId,
        flags: Flags,
        internal_flags: InternalFlags,
        tracker: Option<Box<dyn SymbolTracker>>,
    ) -> NodeId {
        self.enter_context(c, enclosing_declaration, flags, internal_flags, tracker);
        let result = NodeBuilderImpl.symbol_to_node(c, symbol, meaning);
        self.exit_context(c, result)
    }

    // TypePredicateToTypePredicateNode implements NodeBuilderInterface.
    pub fn type_predicate_to_type_predicate_node(
        self,
        c: &mut Checker<'_>,
        predicate: TypePredicateId,
        enclosing_declaration: NodeId,
        flags: Flags,
        internal_flags: InternalFlags,
        tracker: Option<Box<dyn SymbolTracker>>,
    ) -> NodeId {
        self.enter_context(c, enclosing_declaration, flags, internal_flags, tracker);
        let result = NodeBuilderImpl.type_predicate_to_type_predicate_node(c, predicate);
        self.exit_context(c, result)
    }

    // TypeToTypeNode implements NodeBuilderInterface.
    pub fn type_to_type_node(
        self,
        c: &mut Checker<'_>,
        typ: TypeId,
        enclosing_declaration: NodeId,
        flags: Flags,
        internal_flags: InternalFlags,
        tracker: Option<Box<dyn SymbolTracker>>,
    ) -> NodeId {
        self.enter_context(c, enclosing_declaration, flags, internal_flags, tracker);
        let result = NodeBuilderImpl.type_to_type_node(c, typ);
        self.exit_context(c, result)
    }
}

pub fn new_node_builder_ex(
    ch: &Checker<'_>,
    e: EmitContext,
    id_to_symbol: Option<HashMap<NodeId, SymbolId>>,
) -> NodeBuilderState {
    let impl_ = new_node_builder_impl(ch, e, id_to_symbol);
    NodeBuilderState {
        impl_,
        ctx_stack: Vec::with_capacity(1),
        verbosity: None,
        created: true,
    }
}

impl Checker<'_> {
    // Upstream also returns a function that releases the node arenas of the emit context: synthetic nodes stay in the store of the checker here.
    pub fn get_node_builder(&mut self) -> NodeBuilder {
        if self.node_builder.created {
            return NodeBuilder;
        }
        self.node_builder = self.get_node_builder_ex(None);
        NodeBuilder
    }

    pub fn get_node_builder_ex(
        &mut self,
        id_to_symbol: Option<HashMap<NodeId, SymbolId>>,
    ) -> NodeBuilderState {
        new_node_builder_ex(self, new_emit_context(), id_to_symbol)
    }
}
