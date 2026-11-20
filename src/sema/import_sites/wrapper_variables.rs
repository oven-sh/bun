use super::call_sites::expr_kind;
use crate::bind::{Binding, Bound, CommonJsVariable, Decl, Parent, PatParent, ScopeKind, SymbolId};
use crate::fold::{TreeNode, push_children};
use crate::hir::{ExprId, ExprKind, File, StmtId, StmtKind};
use crate::module_format::{EsmSyntax, file_esm_syntax};

pub(super) fn names_redeclared_require(hir: &File<'_>, bound: &Bound<'_>, e: ExprId) -> bool {
    let redeclared = bound.runtime.redeclared_commonjs_variables();
    if redeclared.is_empty() || !matches!(expr_kind(hir, e), Some(ExprKind::Ident(_))) {
        return false;
    }
    let own_require = bound.redeclared_own_require(|| {
        let mut redeclared = redeclared.iter();
        let &(symbol, _) = redeclared.find(|it| it.1 == CommonJsVariable::Require)?;
        let is_filled_by_wrapper = file_esm_syntax(hir) == EsmSyntax::None
            && reads_what_wrapper_hands_in(hir, bound, symbol);
        is_filled_by_wrapper.then_some(symbol)
    });
    own_require.is_some_and(|symbol| bound.binding(e) == Binding::Symbol(symbol))
}

pub fn reads_what_wrapper_hands_in(hir: &File<'_>, bound: &Bound<'_>, variable: SymbolId) -> bool {
    let mut scopes = bound.scopes.iter();
    if bound.file_uses_arguments()
        || !bound.runtime.eval_scopes().is_empty()
        || scopes.any(|scope| matches!(scope.kind, ScopeKind::With(_)))
    {
        return true;
    }
    let declarators = bound.symbol(variable).decls;
    let first = declarators
        .iter()
        .filter_map(|declarator| match *declarator {
            Decl::Var(name) => Some(name),
            _ => None,
        });
    let Some(first) = first.min_by_key(|&name| hir[name].pos) else {
        return true;
    };
    let PatParent::Var(declaration) = bound.pat_parent[first.idx()] else {
        return true;
    };
    if hir[declaration].init.is_none() {
        return true;
    }
    let statement = bound.var_stmt[declaration.idx()];
    let list = match bound.parent_of_stmt(statement) {
        Parent::File => hir.body,
        Parent::Stmt(block) => match hir[block].kind {
            StmtKind::Block(list) => list,
            _ => return true,
        },
        _ => return true,
    };
    let names_variable = |e: ExprId| {
        matches!(hir[e].kind, ExprKind::Ident(_)) && bound.binding(e) == Binding::Symbol(variable)
    };
    let count_below = |statements: &mut dyn Iterator<Item = StmtId>| {
        let mut stack: Vec<TreeNode> = statements.map(TreeNode::Stmt).collect();
        let (mut mentions, mut declared) = (0, 0);
        while let Some(node) = stack.pop() {
            match node {
                TreeNode::Stmt(it) if matches!(hir[it].kind, StmtKind::Fn(_)) => continue,
                TreeNode::Expr(e) if names_variable(e) => mentions += 1,
                TreeNode::Pattern(name) if declarators.contains(&Decl::Var(name)) => declared += 1,
                _ => {}
            }
            push_children(hir, node, &mut stack);
        }
        (mentions, declared)
    };
    let mut behind = hir.ids(list).skip_while(|&it| it != statement).skip(1);
    let (mentions_behind, declared_behind) = count_below(&mut behind);
    let all = (0..hir.exprs.len()).filter(|&index| names_variable(ExprId(index as u32)));
    count_below(&mut core::iter::once(statement)) != (0, 1)
        || all.count() != mentions_behind
        || declarators.len() != declared_behind + 1
}

pub fn redeclares_what_wrapper_hands_in(hir: &File<'_>, bound: &Bound<'_>) -> bool {
    let mut redeclared = bound.runtime.redeclared_commonjs_variables().iter();
    redeclared.any(|it| reads_what_wrapper_hands_in(hir, bound, it.0))
}
