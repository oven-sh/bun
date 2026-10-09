use bun_lint_oxlint::ast_util::get_inner_expression;
use crate::oxlint::vue::{is_this_object, is_vue_component_options_object, is_vue_file};
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;
use bun_lint::utils::ancestor_memo::AncestorMemo;
use rustc_hash::{FxHashMap, FxHashSet};

/// Enforce properties of `$slots` to be used as functions.
pub struct RequireSlotsAsFunctions;

const REQUIRE_SLOTS_AS_FUNCTIONS: Message = Message::new("", "Property in `$slots` should be used as function.");

#[derive(Default)]
pub struct State<'a> {
    /// That something is in the options of a component.
    in_options: AncestorMemo<'a, ()>,
    /// [`count_other_uses`] of a variable, by its key.
    other_uses: FxHashMap<usize, usize>,
}

impl Rule for RequireSlotsAsFunctions {
    const META: Meta = Meta::oxlint(Plugin::Vue, "require-slots-as-functions", Kind::Problem);
    type State<'a> = State<'a>;

    fn new(_: &Options) -> Self {
        RequireSlotsAsFunctions
    }

    fn register<'a>(&self, on: &mut Listeners<'a, Self>, file: &'a File<'a>) -> Self::State<'a> {
        if is_vue_file(file) && file.mentions("$slots") {
            on.exprs([ExprTag::Dot], |_, slot_prop_member, cx| {
                // `this.$slots.foo`
                let is_options = |it: Node| matches!(it, Node::Expr(e) if is_vue_component_options_object(e));
                if let ExprKind::Dot { obj, name, .. } = slot_prop_member.kind()
                    && !slot_prop_member.is_private_member()
                    && let ExprKind::Dot { obj: this, name: slots, .. } = get_inner_expression(obj).kind()
                    && slots.name().is("$slots")
                    && cx.state.in_options.find(Node::Expr(slot_prop_member), |_, parent| is_options(parent).then_some(())).is_some()
                    && is_this_object(this)
                {
                    verify(slot_prop_member, name.span(), cx);
                }
            });
        }
        State::default()
    }
}

/// What is done with a value.
enum Use<'a> {
    /// It is used as something else than a function.
    Other,
    AssignedTo(Symbol<'a>),
    Fine,
}

fn use_of(node: Expr<'_>) -> Use<'_> {
    let mut node = node;
    let symbol = loop {
        match node.parent() {
            Node::Expr(parent) => match parent.kind() {
                ExprKind::As { .. } | ExprKind::AsConst(_) if parent.is_angle_bracket_assertion() => return Use::Fine,
                ExprKind::As { .. } | ExprKind::AsConst(_) | ExprKind::NonNull(_) | ExprKind::Satisfies { .. } => node = parent,
                // `children = this.$slots.foo`
                ExprKind::Assign { target, value, .. } if value == node => break target.symbol(),
                // `<a>{...this.$slots.foo}</a>`
                ExprKind::Spread(_) if parent.parent().as_expr().is_some_and(|it| it.tag() == ExprTag::Jsx) => return Use::Fine,
                ExprKind::Dot { .. } | ExprKind::Index { .. } | ExprKind::Spread(_) | ExprKind::Array(_) => return Use::Other,
                _ => return Use::Fine,
            },
            Node::Prop(prop) if prop.kind() == PropKind::Spread && !prop.is_jsx_attribute() => return Use::Other,
            // `var children = this.$slots.foo`
            Node::VarDecl(var) => break var.pat().symbol(),
            _ => return Use::Fine,
        }
    };
    symbol.map_or(Use::Fine, Use::AssignedTo)
}

/// How often a variable, and the variables that it is assigned to, are used as something else than a function. The references to a
/// variable are followed once.
fn count_other_uses<'a>(symbol: Symbol<'a>) -> usize {
    let reads = |symbol: Symbol<'a>| symbol.references().filter(|it| it.is_read()).filter_map(|it| it.expr());
    let mut followed = FxHashSet::from_iter([symbol.key()]);
    let mut pending: Vec<Expr<'a>> = reads(symbol).collect();
    let mut count = 0;
    while let Some(node) = pending.pop() {
        match use_of(node) {
            Use::Other => count += 1,
            Use::AssignedTo(symbol) if followed.insert(symbol.key()) => pending.extend(reads(symbol)),
            _ => {}
        }
    }
    count
}

/// A report for each use of `node`, and of the variables that it is assigned to, as something else than a function.
fn verify<'a>(node: Expr<'a>, report_span: Span, cx: &mut Cx<'a, RequireSlotsAsFunctions>) {
    let count = match use_of(node) {
        Use::Other => 1,
        Use::AssignedTo(symbol) => *cx.state.other_uses.entry(symbol.key()).or_insert_with(|| count_other_uses(symbol)),
        Use::Fine => 0,
    };
    for _ in 0..count {
        if cx.has_reported_too_much() {
            break;
        }
        cx.report(report_span, REQUIRE_SLOTS_AS_FUNCTIONS);
    }
}
