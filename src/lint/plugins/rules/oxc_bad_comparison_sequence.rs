use bun_lint::prelude::*;
use bun_lint::rule::Plugin;
use bun_lint::utils::ancestor_memo::AncestorMemo;

/// This rule applies when the comparison operator is applied two or more times in a row.
pub struct BadComparisonSequence;

const BAD_COMPARISON_SEQUENCE: Message = Message::new("", "Bad comparison sequence");

impl Rule for BadComparisonSequence {
    const META: Meta = Meta::oxlint(Plugin::Oxc, "bad-comparison-sequence", Kind::Problem);
    const ON: On = On::new()
        .binaries(&[BinOp::EqEq, BinOp::NotEq, BinOp::EqEqEq, BinOp::NotEqEq])
        .binaries(&[BinOp::Lt, BinOp::Le, BinOp::Gt, BinOp::Ge]);
    /// `has_no_bad_comparison_in_parents`
    type State<'a> = AncestorMemo<'a, bool>;

    fn new(_: &Options) -> Self {
        BadComparisonSequence
    }

    fn start<'a>(&self, _: &'a File<'a>) -> Option<Self::State<'a>> {
        Some(AncestorMemo::default())
    }

    fn binary<'a>(&self, e: Expr<'a>, cx: &mut Cx<'a, Self>) {
        if let Some(comparison_result) = bad_comparison_sequence(e)
            && cx.state.find(Node::Expr(e), has_no_bad_comparison_in_parent) == Some(true)
        {
            let compared_against = e.right().map(Expr::outer_span).unwrap_or_default();
            cx.report(comparison_result, BAD_COMPARISON_SEQUENCE)
                .first_label("This comparison expression produces a boolean")
                .label(compared_against, "That boolean is then compared with this operand");
        }
    }
}

/// Of `a === b === c === d` only the whole is reported. Parentheses, statements and declarations are where that ends.
fn has_no_bad_comparison_in_parent<'a>(child: Node<'a>, parent: Node<'a>) -> Option<bool> {
    if matches!(child, Node::Expr(e) if e.is_parenthesized()) {
        return Some(true);
    }
    match parent {
        Node::Stmt(_) => Some(true),
        Node::Member(member)
            if member.kind() == MemberKind::Property && !member.flags().contains(Flags::ACCESSOR) && !member.is_signature() =>
        {
            Some(true)
        }
        Node::Expr(e) if bad_comparison_sequence(e).is_some() => Some(false),
        _ => None,
    }
}

#[derive(PartialEq, Eq)]
enum Comparison {
    Equality,
    Compare,
}

fn comparison_kind(e: Expr) -> Option<Comparison> {
    match e.binary_op()? {
        BinOp::EqEq | BinOp::NotEq | BinOp::EqEqEq | BinOp::NotEqEq => Some(Comparison::Equality),
        BinOp::Lt | BinOp::Le | BinOp::Gt | BinOp::Ge => Some(Comparison::Compare),
        _ => None,
    }
}

/// The comparison on the left whose result is compared.
fn bad_comparison_sequence(e: Expr<'_>) -> Option<Expr<'_>> {
    let kind = comparison_kind(e)?;
    e.left().filter(|left| comparison_kind(*left) == Some(kind) && !left.is_parenthesized())
}
