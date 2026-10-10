use bun_lint_oxlint::ast_util::{get_inner_expression, static_property_name};
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;
use bun_lint::utils::ancestor_memo::AncestorMemo;
use rustc_hash::FxHashSet;

/// Disallow synchronous methods.
pub struct NoSync {
    allow_at_root_level: bool,
    ignores: FxHashSet<Box<[u8]>>,
}

const NO_SYNC: Message = Message::new("", "Unexpected sync method: '{{property_name}}'.");

impl Rule for NoSync {
    const META: Meta = Meta::oxlint(Plugin::Node, "no-sync", Kind::Suggestion);
    const ON: On = On::new().exprs(&[ExprTag::Call]);
    /// That something is in a function.
    type State<'a> = AncestorMemo<'a, ()>;

    fn new(options: &Options) -> Self {
        let options = options.object(0);
        NoSync {
            allow_at_root_level: options.bool_or("allowAtRootLevel", false),
            ignores: options.strings("ignores").iter().map(|it| it.as_bytes().into()).collect(),
        }
    }

    fn start<'a>(&self, _: &'a File<'a>) -> Option<Self::State<'a>> {
        Some(AncestorMemo::default())
    }

    fn expr<'a>(&self, e: Expr<'a>, cx: &mut Cx<'a, Self>) {
        let Some(property_name) = e.callee().and_then(get_sync_property_name) else {
            return;
        };
        let is_function = |it: Node| matches!(it, Node::Func(func) if func.kind() != FnKind::StaticBlock);
        if self.ignores.contains(property_name.bytes())
            || self.allow_at_root_level && cx.state.find(Node::Expr(e), |_, parent| is_function(parent).then_some(())).is_none()
        {
            return;
        }
        cx.report(e, NO_SYNC).data("property_name", property_name);
    }
}

/// The last name in `a.b.c` that ends in `Sync`.
fn get_sync_property_name(callee: Expr<'_>) -> Option<Name<'_>> {
    let is_sync = |name: &Name| name.bytes().ends_with(b"Sync");
    let mut at = get_inner_expression(callee);
    loop {
        if let Some(name) = at.as_ident() {
            return Some(name).filter(is_sync);
        }
        if at.is_private_member() || at.is_chain_root() {
            return None;
        }
        if let Some(name) = static_property_name(at).filter(is_sync) {
            return Some(name);
        }
        at = get_inner_expression(at.object()?);
    }
}
