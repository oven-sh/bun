use bun_lint::prelude::*;

/// Disallow use of `Object.prototype.hasOwnProperty.call()` and prefer use of `Object.hasOwn()`.
pub struct PreferObjectHasOwn;

const USE_HAS_OWN: Message = Message::new(
    "useHasOwn",
    "Use 'Object.hasOwn()' instead of 'Object.prototype.hasOwnProperty.call()'.",
);

/// The object of `e`, if ESLint has a `MemberExpression` for `e` and not a `ChainExpression`
/// around one.
fn object_of_member(e: Expr<'_>) -> Option<Expr<'_>> {
    e.object().filter(|_| !e.is_chain_root())
}

fn is_named(member: Expr<'_>, name: &str) -> bool {
    ast_utils::get_static_property_name(member).is_some_and(|it| *it == *name.as_bytes())
}

/// Whether `object` is `Object`, `Object.prototype` or `{}`.
fn is_left_hand_object(object: Expr<'_>) -> bool {
    if let Some(props) = object.as_object() {
        return props.is_empty();
    }
    match object_of_member(object) {
        Some(inner) if is_named(object, "prototype") => inner.is_ident("Object"),
        _ => object.is_ident("Object"),
    }
}

impl Rule for PreferObjectHasOwn {
    const META: Meta = Meta::eslint("prefer-object-has-own", Kind::Suggestion).fixable(Fixable::Code);
    const ON: On = On::new().method_calls(&["call"]);
    no_state!();

    fn new(_: &Options) -> Self {
        PreferObjectHasOwn
    }

    fn narrow<'a>(&self, file: &'a File<'a>) -> On {
        if file.mentions("hasOwnProperty") && file.mentions("call") { Self::ON } else { On::new() }
    }

    fn expr<'a>(&self, e: Expr<'a>, cx: &mut Cx<'a, Self>) {
        let Some(callee) = e.as_call().map(Call::callee) else {
            return;
        };
        let Some(method) = object_of_member(callee) else {
            return;
        };
        let Some(object) = object_of_member(method) else {
            return;
        };
        if !is_named(callee, "call")
            || !is_named(method, "hasOwnProperty")
            || !is_left_hand_object(object)
            || Node::Expr(e).scope().resolve("Object").is_some()
            || cx.file().global(b"Object").is_none()
        {
            return;
        }
        cx.report(e, USE_HAS_OWN).fix(|fixer| {
            let file = fixer.file();
            if file.comments_in(callee).next().is_some() {
                return None;
            }
            let start = callee.span().start;
            let needs_space = match file.language().is_oxlint {
                // It goes by the character before.
                true => start > 1 && !matches!(file.text().get(start as usize - 1), Some(b' ' | b'=' | b'/' | b'(')),
                false => file.tokens_before(callee).with_comments().next().is_some_and(|before| {
                    before.end() == start && !ast_utils::can_tokens_be_adjacent(before, "Object.hasOwn")
                }),
            };
            Some(fixer.replace(callee, if needs_space { " Object.hasOwn" } else { "Object.hasOwn" }))
        });
    }
}
