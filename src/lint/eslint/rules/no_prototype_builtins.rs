use bun_lint::prelude::*;

/// Disallow calling some `Object.prototype` methods directly on objects.
pub struct NoPrototypeBuiltins;

const PROTOTYPE_BUILD_IN: Message = Message::new(
    "prototypeBuildIn",
    "Do not access Object.prototype method '{{prop}}' from target object.",
);
const CALL_OBJECT_PROTOTYPE: Message =
    Message::new("callObjectPrototype", "Call Object.prototype.{{prop}} explicitly.");

fn disallowed_prop(name: Name<'_>) -> Option<&'static str> {
    match name.bytes() {
        b"hasOwnProperty" => Some("hasOwnProperty"),
        b"isPrototypeOf" => Some("isPrototypeOf"),
        b"propertyIsEnumerable" => Some("propertyIsEnumerable"),
        _ => None,
    }
}

/// ESLint's `isAfterOptional`: `e` or something to the left of it in the same chain has a `?.`.
fn is_after_optional(e: Expr<'_>) -> bool {
    // Only a `!` can be in the way from a link of a chain to its `?.`.
    if e.chain() == Chain::No || e.file().is_javascript() {
        return e.chain() != Chain::No;
    }
    let mut at = e;
    loop {
        let (left, is_optional) = match at.kind() {
            ExprKind::Dot { obj, chain, .. } | ExprKind::Index { obj, chain, .. } => {
                (obj, chain == Chain::Start)
            }
            ExprKind::Call(call) => (call.callee(), call.is_optional()),
            _ => return false,
        };
        if is_optional {
            return true;
        }
        if left.is_chain_root() {
            return false;
        }
        at = left;
    }
}

impl NoPrototypeBuiltins {
    fn check<'a>(&self, e: Expr<'a>, cx: &mut Cx<'a, Self>) {
        let ExprKind::Call(call) = e.kind() else {
            return;
        };
        let callee = call.callee();
        // Of the literals, only a string can be one of the names.
        let name = match callee.kind() {
            ExprKind::Dot { name, .. } => Some(name.name()),
            ExprKind::Index { index, .. } => match index.kind() {
                ExprKind::String(value) => Some(value),
                ExprKind::Template(template) => template.as_static(),
                _ => None,
            },
            _ => None,
        };
        let Some(prop) = name.and_then(disallowed_prop) else {
            return;
        };
        let (object, property) = match callee.kind() {
            ExprKind::Dot { obj, name, .. } => (obj, name.span()),
            ExprKind::Index { obj, index, .. } => (obj, index.span()),
            _ => return,
        };
        // oxlint points at what is called.
        let place = if cx.language().is_oxlint { callee.span() } else { property };
        cx.report(place, PROTOTYPE_BUILD_IN).data("prop", prop).suggest_with(
            CALL_OBJECT_PROTOTYPE,
            &[("prop", prop.as_bytes())],
            |fixer| {
                let file = fixer.file();
                // The call can be short-circuited, or it is on the result of a chain.
                if is_after_optional(e) || callee.is_chain_root() {
                    return None;
                }
                if file.global(b"Object").is_none()
                    || Node::Expr(e).scope().resolve("Object").is_some()
                {
                    return None;
                }
                let open_paren = file.tokens_after(callee).find(ast_utils::is_opening_paren_token)?;
                let needs_parens = ast_utils::get_precedence(object)
                    <= ast_utils::get_binary_operator_precedence(BinOp::Comma);
                let mut argument = Vec::new();
                if needs_parens {
                    argument.push(b'(');
                }
                argument.extend_from_slice(object.text());
                if needs_parens {
                    argument.push(b')');
                }
                if !call.args().is_empty() {
                    argument.extend_from_slice(b", ");
                }
                Some([
                    fixer.replace(callee, format!("Object.prototype.{prop}.call")),
                    fixer.insert_after(open_paren, argument),
                ])
            },
        );
    }
}

impl Rule for NoPrototypeBuiltins {
    const META: Meta = Meta::eslint("no-prototype-builtins", Kind::Problem)
        .recommended()
        .has_suggestions();
    const ON: On = On::new().exprs(&[ExprTag::Call]);
    type State<'a> = ();

    fn new(_: &Options) -> Self {
        NoPrototypeBuiltins
    }

    fn start<'a>(&self, file: &'a File<'a>) -> Option<()> {
        file.mentions_any(&["hasOwnProperty", "isPrototypeOf", "propertyIsEnumerable"])
            .then_some(())
    }

    fn expr<'a>(&self, e: Expr<'a>, cx: &mut Cx<'a, Self>) {
        self.check(e, cx);
    }
}
