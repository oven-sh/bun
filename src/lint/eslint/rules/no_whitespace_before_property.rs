use bun_lint::prelude::*;
use bun_lint::utils::ast_utils;

/// Disallow whitespace before properties.
pub struct NoWhitespaceBeforeProperty;

const UNEXPECTED_WHITESPACE: Message = Message::new(
    "unexpectedWhitespace",
    "Unexpected whitespace before property {{propName}}.",
);

/// A `MemberExpression` with something besides the punctuator between the object and the property.
#[derive(Copy, Clone)]
struct Access<'a> {
    node: Span,
    /// Where the object ends, without the parentheses around it.
    object_end: u32,
    /// Where the token before the `.`, the `?.` or the `[` ends.
    left: u32,
    /// Where the name or the `[` starts.
    right: u32,
    property: Span,
    /// What belongs between `left` and `right`.
    punctuator: &'static str,
    /// The object, if a `.` follows it.
    object_before_dot: Option<Expr<'a>>,
}

/// Whether ESTree has a `MemberExpression` for `e`, a `Dot`. In the name of a JSX element it is a
/// `JSXMemberExpression`, in the operand of a `typeof` type a `TSQualifiedName`.
fn is_member_expression(e: Expr) -> bool {
    let mut at = e;
    loop {
        match at.parent() {
            Node::Expr(parent) => match parent.kind() {
                ExprKind::Dot { obj, .. } if obj == at => at = parent,
                ExprKind::Jsx(jsx) => return jsx.tag() != Some(at) && jsx.close_tag() != Some(at),
                _ => return true,
            },
            Node::Type(ty) => return !matches!(ty.kind(), TypeKind::Typeof { .. }),
            _ => return true,
        }
    }
}

impl NoWhitespaceBeforeProperty {
    fn check<'a>(cx: &Cx<'a, Self>, access: Access<'a>) {
        let file = cx.file();
        if !ast_utils::is_token_on_same_line(file, Span::empty(access.object_end), access.property) {
            return;
        }
        let (left, right) = (Span::empty(access.left), Span::empty(access.right));
        if !file.is_space_between(left, right) {
            return;
        }
        cx.report(access.node, UNEXPECTED_WHITESPACE)
            .data("propName", file.slice(access.property))
            .fix(|fixer| {
                // `5.toString()` is a syntax error.
                if access.object_before_dot.is_some_and(ast_utils::is_decimal_integer)
                    || file.comments_between(left, right).next().is_some()
                {
                    return None;
                }
                Some(fixer.replace(left.between(right), access.punctuator))
            });
    }

    fn check_member<'a>(&self, e: Expr<'a>, cx: &mut Cx<'a, Self>) {
        match e.kind() {
            ExprKind::Dot { obj, name, chain } => {
                let is_optional = chain == Chain::Start;
                let punctuator = if is_optional { "?." } else { "." };
                let (left, right) = (obj.outer_span().end, name.start());
                if left + punctuator.len() as u32 == right || !is_member_expression(e) {
                    return;
                }
                Self::check(
                    cx,
                    Access {
                        node: e.span(),
                        object_end: obj.span().end,
                        left,
                        right,
                        property: name.span(),
                        punctuator,
                        object_before_dot: (!is_optional).then_some(obj),
                    },
                );
            }
            ExprKind::Index { obj, index, chain } => {
                let is_optional = chain == Chain::Start;
                let (text, left) = (cx.text(), obj.outer_span().end);
                let adjacent: &[u8] = if is_optional { b"?.[" } else { b"[" };
                if text.get(left as usize..).is_some_and(|rest| rest.starts_with(adjacent)) {
                    return;
                }
                let mut right = skip_trivia(text, left);
                if is_optional {
                    right = skip_trivia(text, right + 2);
                }
                Self::check(
                    cx,
                    Access {
                        node: e.span(),
                        object_end: obj.span().end,
                        left,
                        right,
                        property: index.span(),
                        punctuator: if is_optional { "?." } else { "" },
                        object_before_dot: None,
                    },
                );
            }
            _ => {}
        }
    }

    /// The `a.b` of `implements a.b` and of `interface I extends a.b` is a `MemberExpression` in
    /// ESTree.
    fn check_heritage<'a>(cx: &Cx<'a, Self>, types: List<'a, TypeNode<'a>>) {
        for ty in types {
            let TypeKind::Ref { name, .. } = ty.kind() else {
                continue;
            };
            let mut parts = name.parts();
            let Some(first) = parts.next() else {
                continue;
            };
            let mut object_end = first.span().end;
            for part in parts {
                let property = part.span();
                if object_end + 1 != property.start {
                    Self::check(
                        cx,
                        Access {
                            node: Span::new(first.start(), property.end),
                            object_end,
                            left: object_end,
                            right: property.start,
                            property,
                            punctuator: ".",
                            object_before_dot: None,
                        },
                    );
                }
                object_end = property.end;
            }
        }
    }
}

impl Rule for NoWhitespaceBeforeProperty {
    const META: Meta = Meta::eslint("no-whitespace-before-property", Kind::Layout)
        .fixable(Fixable::Whitespace)
        .deprecated();
    type State<'a> = ();

    fn new(_: &Options) -> Self {
        NoWhitespaceBeforeProperty
    }

    fn register<'a>(&self, on: &mut Listeners<'a, Self>, file: &'a File<'a>) {
        on.exprs([ExprTag::Dot, ExprTag::Index], Self::check_member);
        if !file.is_javascript() {
            on.classes(|_, class, cx| Self::check_heritage(cx, class.implements()));
            on.stmts([StmtTag::Interface], |_, statement, cx| {
                if let StmtKind::Interface(interface) = statement.kind() {
                    Self::check_heritage(cx, interface.extends());
                }
            });
        }
    }
}
