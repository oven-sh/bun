// checker/nodebuilder.go 10-96: the context stack of the node builder, with the fields of the context that these functions touch. The checker has one node builder: its handle is a unit value and its state is a field of the checker. The symbol tracker has no port here.
use crate::checker::checker::Checker;
use crate::tscore::ids::{NodeId, SymbolId, TypeId};

#[derive(Default)]
pub struct NodeBuilderContext {
    pub flags: u32,
    pub internal_flags: u32,
    pub max_expansion_depth: isize,
    pub max_truncation_length: isize,
    pub encountered_error: bool,
    pub truncating: bool,
    pub can_increase_expansion_depth: bool,
    pub expansion_truncated: bool,
    pub reported_truncation_error: bool,
    pub enclosing_declaration: NodeId,
    pub enclosing_file: NodeId,
    pub infer_type_parameters: Vec<TypeId>,
    pub reverse_mapped_stack: Vec<SymbolId>,
}

// nodebuilder.go 19
#[derive(Clone, Copy, Default)]
pub struct VerbosityContext {
    pub level: isize,
    pub max_truncation_length: isize,
    pub can_increase_verbosity: bool,
    pub truncated: bool,
}

// The fields of NodeBuilder and `impl.ctx`. `ctx` is the top of the stack; None is upstream's nil context.
#[derive(Default)]
pub struct NodeBuilderState {
    pub ctx_stack: Vec<Option<Box<NodeBuilderContext>>>,
    pub ctx: Option<Box<NodeBuilderContext>>,
    pub verbosity: Option<VerbosityContext>,
}

// `*NodeBuilder`: the receiver of the upstream methods.
#[derive(Clone, Copy, Default)]
pub struct NodeBuilder;

pub const FLAGS_NO_TRUNCATION: u32 = 1 << 0;

impl NodeBuilder {
    pub fn enter_context(
        self,
        c: &mut Checker<'_>,
        enclosing_declaration: NodeId,
        flags: u32,
        internal_flags: u32,
    ) {
        let mut verbosity_level = -1;
        let mut max_truncation_length = 0;
        if let Some(verbosity) = c.node_builder.verbosity {
            verbosity_level = verbosity.level;
            max_truncation_length = verbosity.max_truncation_length;
        }
        let previous = c.node_builder.ctx.take();
        c.node_builder.ctx_stack.push(previous);
        c.node_builder.ctx = Some(Box::new(NodeBuilderContext {
            flags,
            internal_flags,
            max_expansion_depth: verbosity_level,
            max_truncation_length,
            enclosing_declaration,
            enclosing_file: c.ast.source_file_of(enclosing_declaration),
            ..NodeBuilderContext::default()
        }));
    }

    // propagateVerbosityOut copies expansion signals from the context to the VerbosityContext output.
    pub fn propagate_verbosity_out(self, c: &mut Checker<'_>) {
        let Some(ctx) = c.node_builder.ctx.as_deref() else {
            return c.fail("nil NodeBuilderContext");
        };
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
            None => c.node_builder.ctx = None,
            Some(previous) => c.node_builder.ctx = previous,
        }
    }

    pub fn exit_context(self, c: &mut Checker<'_>, result: NodeId) -> NodeId {
        self.propagate_verbosity_out(c);
        self.exit_context_check(c);
        // `defer b.popContext()`: the context is read before it is popped.
        let encountered_error = c
            .node_builder
            .ctx
            .as_deref()
            .is_some_and(|ctx| ctx.encountered_error);
        self.pop_context(c);
        if encountered_error {
            return NodeId::NIL;
        }
        result
    }

    pub fn exit_context_check(self, c: &mut Checker<'_>) {
        if let Some(ctx) = c.node_builder.ctx.as_deref_mut() {
            if ctx.truncating && ctx.flags & FLAGS_NO_TRUNCATION != 0 {
                // b.impl.ctx.tracker.ReportTruncationError()
                ctx.reported_truncation_error = true;
            }
        }
    }
}
