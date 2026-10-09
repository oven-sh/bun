use bun_core::strings;
use bun_lint::prelude::*;

/// Enforce consistent newlines before and after dots.
pub struct DotLocation {
    on_object: bool,
}

const EXPECTED_DOT_AFTER_OBJECT: Message =
    Message::new("expectedDotAfterObject", "Expected dot to be on same line as object.");
const EXPECTED_DOT_BEFORE_PROPERTY: Message =
    Message::new("expectedDotBeforeProperty", "Expected dot to be on same line as property.");

/// What is around a dot.
#[derive(Copy, Clone)]
struct Access {
    /// Where the token before the dot ends.
    object_end: u32,
    /// Where the name after the dot starts.
    property: u32,
    /// `?.`
    is_optional: bool,
    /// The token before the dot is a number that a `.` directly after it would be a part of.
    is_decimal_integer: bool,
}

impl DotLocation {
    fn check_dot_location(&self, access: Access, cx: &Cx<'_, Self>) {
        let start = skip_trivia(cx.text(), access.object_end);
        let dot = Span::new(start, start + if access.is_optional { 2 } else { 1 });
        if self.on_object {
            if strings::contains_js_line_break(cx.slice(Span::before(access.object_end, dot))) {
                cx.report(dot, EXPECTED_DOT_AFTER_OBJECT).fix(|fixer| {
                    let moved = match (access.is_optional, access.is_decimal_integer) {
                        (true, _) => "?.",
                        (false, true) => " .",
                        (false, false) => ".",
                    };
                    [fixer.insert_after(Span::empty(access.object_end), moved), fixer.remove(dot)]
                });
            }
        } else if strings::contains_js_line_break(cx.slice(Span::after(dot, access.property))) {
            cx.report(dot, EXPECTED_DOT_BEFORE_PROPERTY).fix(|fixer| {
                let moved = if access.is_optional { "?." } else { "." };
                [fixer.remove(dot), fixer.insert_before(Span::empty(access.property), moved)]
            });
        }
    }
}

impl Rule for DotLocation {
    const META: Meta = Meta::eslint("dot-location", Kind::Layout).fixable(Fixable::Code).deprecated();
    type State<'a> = ();

    fn new(options: &Options) -> Self {
        DotLocation {
            on_object: options.str(0) != Some("property"),
        }
    }

    fn register<'a>(&self, on: &mut Listeners<'a, Self>, file: &'a File<'a>) {
        on.exprs([ExprTag::Dot], |rule, e, cx| {
            let ExprKind::Dot { obj, name, chain } = e.kind() else {
                return;
            };
            let (object_end, property) = (obj.outer_span().end, name.start());
            if strings::contains_js_line_break(cx.slice(Span::new(object_end, property)))
                && ast_utils::is_member_expression(e)
            {
                let access = Access {
                    object_end,
                    property,
                    is_optional: chain == Chain::Start,
                    is_decimal_integer: !obj.is_parenthesized() && ast_utils::is_decimal_integer(obj),
                };
                rule.check_dot_location(access, cx);
            }
        });
        if file.is_javascript() {
            return;
        }
        // `interface I extends a.b`, `class C implements a.b`: typescript-eslint has the name as
        // a `MemberExpression`.
        on.types([TypeTag::Ref], |rule, ty, cx| {
            let TypeKind::Ref { name, .. } = ty.kind() else {
                return;
            };
            if name.len() < 2
                || !strings::contains_js_line_break(cx.slice(name.span()))
                || utils::estree_type_name(Node::Type(ty)) == "TSTypeReference"
            {
                return;
            }
            for (object, property) in name.parts().zip(name.parts().skip(1)) {
                let access = Access {
                    object_end: object.span().end,
                    property: property.start(),
                    is_optional: false,
                    is_decimal_integer: false,
                };
                rule.check_dot_location(access, cx);
            }
        });
    }
}
