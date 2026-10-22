use crate::conditions::should_run;
use crate::reactive::{WITHOUT_RUNES, assignment_of, body_of, reactive_statements};
use crate::variables::owner_as;
use bun_lint::ast::svelte::variables::{
    DefNode, DefinitionKind, SvelteDefinition, SvelteReference, SvelteVariable,
};
use bun_lint::ast::svelte::{Role, SvelteKind, SvelteTag};
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;
use bun_lint::semantic::DeclarationKind;

/// disallow reactive statements that don't reference reactive values.
pub struct NoImmutableReactiveStatements;

const IMMUTABLE: Message = Message::new(
    "immutable",
    "This statement is not reactive because all variables referenced in the reactive statement are immutable.",
);

/// What's known about which variables are mutable, and the patterns `hasWriteReference` has inspected.
#[derive(Default)]
struct Mutability<'a> {
    known: Vec<(SvelteVariable<'a>, bool)>,
    seen: rustc_hash::FxHashSet<Pat<'a>>,
}

impl<'a> Mutability<'a> {
    /// `isMutableVariableReference`
    fn is_mutable_reference(&mut self, reference: SvelteReference<'a>) -> bool {
        if reference.name().bytes().starts_with(b"$") {
            return true;
        }
        reference.variable().is_none_or(|it| self.is_mutable_variable(it))
    }

    /// `isMutableVariable`
    fn is_mutable_variable(&mut self, variable: SvelteVariable<'a>) -> bool {
        if let Some(&(_, known)) = self.known.iter().find(|it| it.0 == variable) {
            return known;
        }
        // A global variable.
        let is_mutable = variable.definitions().len() == 0
            || variable.definitions().any(|definition| self.is_mutable_definition(variable, definition));
        self.known.push((variable, is_mutable));
        is_mutable
    }

    fn is_mutable_definition(&mut self, variable: SvelteVariable<'a>, definition: SvelteDefinition<'a>) -> bool {
        match definition.kind() {
            DefinitionKind::Declared(DeclarationKind::ImportBinding) => false,
            // Reactive values.
            DefinitionKind::Computed => true,
            DefinitionKind::Declared(DeclarationKind::Variable) => {
                if let (Some(DefNode::Program(Node::VarDecl(declarator))), Some(DefNode::Program(Node::Stmt(statement)))) =
                    (definition.node(), definition.parent())
                {
                    if declarator.var_kind() == VarKind::Const {
                        let is_fixed = declarator.init().is_some_and(|init| {
                            ast_utils::is_literal(init)
                                || init.as_fn().is_some_and(|it| matches!(it.kind(), FnKind::Expr | FnKind::Arrow))
                        });
                        if is_fixed {
                            return false;
                        }
                    } else if statement.is_exported() && !statement.is_default_export() {
                        // Props.
                        return true;
                    }
                }
                // `FindVariableContext` is created again for each definition.
                self.seen.clear();
                self.has_write(variable)
            }
            DefinitionKind::Declared(_) => false,
        }
    }

    /// `hasWrite`
    fn has_write(&mut self, variable: SvelteVariable<'a>) -> bool {
        let names: Vec<Span> = variable.definitions().map(|it| it.name_span()).collect();
        for reference in variable.references() {
            if reference.is_write() && !names.iter().any(|it| it.contains(reference.span())) {
                return true;
            }
            if reference.expr().is_some_and(|e| self.has_write_member(e)) {
                return true;
            }
        }
        false
    }

    /// `hasWriteMember`, for `e` and each member expression it's the object of, outward.
    fn has_write_member(&mut self, mut e: Expr<'a>) -> bool {
        while let Node::Expr(parent) = e.parent() {
            match parent.kind() {
                ExprKind::Assign { target, .. } => return target == e,
                ExprKind::Unary { op, operand } => {
                    return operand == e
                        && matches!(op, UnOp::Delete | UnOp::PreInc | UnOp::PreDec | UnOp::PostInc | UnOp::PostDec);
                }
                ExprKind::Dot { obj, .. } | ExprKind::Index { obj, .. } if obj == e => e = parent,
                _ => return false,
            }
        }
        if owner_as(e, SvelteTag::Directive, Role::Expression).is_some_and(|it| it.kind() == SvelteKind::Binding) {
            return true;
        }
        let Some(each) = owner_as(e, SvelteTag::EachBlock, Role::Expression) else {
            return false;
        };
        // `hasWriteReference` for the item.
        let Some(context) = each.code(Role::Context).and_then(|it| it.node()) else {
            return false;
        };
        let pattern = match context {
            Node::Param(param) => param.pat(),
            Node::Pat(pat) => pat,
            _ => return false,
        };
        let file = e.file();
        let mut ids = Vec::new();
        pattern.for_each_binding(&mut |it| ids.push(it));
        ids.into_iter().any(|id| {
            if !self.seen.insert(id) {
                return false;
            }
            let variable = id.symbol().and_then(|it| file.svelte_variable_of(it));
            variable.is_some_and(|it| self.has_write(it))
        })
    }
}

impl Rule for NoImmutableReactiveStatements {
    const META: Meta = Meta::plugin(Plugin::Svelte, "no-immutable-reactive-statements", Kind::Suggestion).recommended();
    const ON: On = On::new().finish();
    type State<'a> = ();

    fn new(_: &Options) -> Self {
        NoImmutableReactiveStatements
    }

    fn start<'a>(&self, file: &'a File<'a>) -> Option<()> {
        (file.svelte().is_some() && should_run(file, WITHOUT_RUNES)).then_some(())
    }

    /// Upstream's `SvelteReactiveStatement` listener.
    fn finish<'a>(&self, cx: &mut Cx<'a, Self>) {
        let file = cx.file();
        let top = file.top_level_scope();
        // `iterateRangeReferences`: the references to top-level variables, sorted by start.
        let mut in_top: Vec<SvelteReference<'a>> =
            file.svelte_variables_of(top).flat_map(SvelteVariable::references).collect();
        bun_lint::utils::sort::sort_by_key(&mut in_top, |it| it.span().start);
        let mut mutability = Mutability::default();
        for reactive in reactive_statements(file) {
            let range = reactive.span();
            let from = in_top.partition_point(|it| it.span().start < range.start);
            let mut in_range = (in_top.get(from..).unwrap_or_default().iter())
                .take_while(|it| it.span().start < range.end)
                .filter(|it| range.contains(it.span()));
            if in_range.any(|it| !it.is_write_only() && mutability.is_mutable_reference(*it)) {
                continue;
            }
            let mut through = top
                .through()
                .filter(|it| range.contains(it.span()) && file.svelte_reference(*it).is_some());
            if through.any(|it| it.name().bytes().starts_with(b"$$") || it.symbol().is_none() && it.global().is_none()) {
                continue;
            }
            let reported = match assignment_of(reactive).and_then(Expr::as_assign) {
                Some((_, _, value)) => Node::Expr(value),
                None => body_of(reactive).map_or(Node::Stmt(reactive), Node::Stmt),
            };
            cx.report(reported, IMMUTABLE).listened_by(reactive, false);
        }
    }
}
