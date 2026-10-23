use bun_lint::ast::svelte::{Role, SvelteNode, SvelteTag};
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;
use bun_lint_eslint::rules::no_dupe_else_if::{self, is_subset, split};

/// disallow duplicate conditions in `{#if}` / `{:else if}` chains
pub struct NoDupeElseIfBlocks;

const UNEXPECTED: Message = Message::new(
    "unexpected",
    "This branch can never execute. Its condition is a duplicate or covered by previous conditions in the `{#if}` / `{:else if}` chain.",
);

/// `buildOrOperands`: `node`, and its `||` operands, each split by `&&`.
struct OrOperands<'a> {
    node: Expr<'a>,
    operands: no_dupe_else_if::OrOperands<'a>,
}

fn or_operands(node: Expr<'_>) -> OrOperands<'_> {
    OrOperands {
        node,
        operands: no_dupe_else_if::split_by_or_and(node),
    }
}

fn test_of(block: SvelteNode<'_>) -> Option<Expr<'_>> {
    match block.code(Role::Expression)?.node()? {
        Node::Expr(e) => Some(e),
        _ => None,
    }
}

impl Rule for NoDupeElseIfBlocks {
    const META: Meta = Meta::plugin(Plugin::Svelte, "no-dupe-else-if-blocks", Kind::Problem).recommended();
    const ON: On = On::new().svelte_nodes(&[SvelteTag::IfBlock]);
    no_state!();

    fn new(_: &Options) -> Self {
        NoDupeElseIfBlocks
    }

    fn svelte_node<'a>(&self, node: SvelteNode<'a>, cx: &mut Cx<'a, Self>) {
        let Some(test) = test_of(node) else {
            return;
        };
        let conditions = match test.kind() {
            ExprKind::Binary { op: BinOp::And, .. } => {
                let mut all = split(BinOp::And, test).into_vec();
                all.push(test);
                all
            }
            _ => vec![test],
        };
        let mut to_check: Vec<OrOperands<'a>> = conditions.into_iter().map(or_operands).collect();
        // `iterateIfElseIf`: the `{#if}` around each `{:else}` the block is a child of.
        let mut target = node;
        while let Some(else_block) = target.parent()
            && else_block.tag() == SvelteTag::ElseBlock
            && else_block.nodes(Role::Children).any(|it| it == target)
            && let Some(block) = else_block.parent()
            && block.tag() == SvelteTag::IfBlock
        {
            target = block;
            let Some(current) = test_of(block) else {
                continue;
            };
            let current = or_operands(current);
            for condition in &mut to_check {
                condition.operands.retain(|operand| {
                    !current.operands.iter().any(|it| is_subset(it, operand))
                });
                if condition.operands.is_empty() {
                    cx.report(condition.node, UNEXPECTED);
                    return;
                }
            }
        }
    }
}
