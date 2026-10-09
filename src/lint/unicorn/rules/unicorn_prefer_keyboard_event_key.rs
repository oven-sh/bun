use bun_lint_oxlint::ast_util::get_member_expr;
use bun_lint_oxlint::codegen::print_string;
use bun_lint::prelude::*;
use bun_lint::rule::{NodeTags, Plugin};
use bun_lint::utils::ancestor_memo::AncestorMemo;

/// Prefer `KeyboardEvent#key` over `KeyboardEvent#keyCode`.
pub struct PreferKeyboardEventKey;

const PREFER_KEYBOARD_EVENT_KEY: Message = Message::new("", "Use `.key` instead of `.{{deprecated_prop}}`");

const DEPRECATED_PROPERTIES: [&str; 3] = ["keyCode", "charCode", "which"];

impl Rule for PreferKeyboardEventKey {
    const META: Meta =
        Meta::oxlint(Plugin::Unicorn, "prefer-keyboard-event-key", Kind::Suggestion).fixable(Fixable::Code);
    /// `find_add_event_listener_callback`
    type State<'a> = AncestorMemo<'a, Func<'a>>;

    fn new(_: &Options) -> Self {
        PreferKeyboardEventKey
    }

    fn register<'a>(&self, on: &mut Listeners<'a, Self>, file: &'a File<'a>) -> Self::State<'a> {
        if file.mentions("addEventListener") && file.mentions_any(&DEPRECATED_PROPERTIES) {
            on.exprs([ExprTag::Dot], check_static_member_expression);
            on.nodes(NodeTags::PAT_PROP, |_, node, cx| {
                if let Node::PatProp(prop) = node {
                    check_binding_property(prop, cx);
                }
            });
        }
        AncestorMemo::default()
    }
}

type Context<'a> = Cx<'a, PreferKeyboardEventKey>;

/// The innermost function around `node`, or `node` itself, that is the second argument of `a.addEventListener(..)`.
fn find_add_event_listener_callback<'a>(node: Node<'a>, known: &mut AncestorMemo<'a, Func<'a>>) -> Option<Func<'a>> {
    known.find(node, |child, parent| {
        let (callback, call) = (child.as_expr()?, parent.as_expr()?.as_call()?);
        let callee = get_member_expr(call.callee())?;
        (call.args().get(1) == Some(callback)
            && !callback.is_parenthesized()
            && matches!(callee.kind(), ExprKind::Dot { name, .. } if name.name().is("addEventListener")))
        .then(|| callback.as_fn())?
    })
}

/// Whether the identifier `expr` is the first parameter of the callback around `node`.
fn is_event_parameter<'a>(expr: Expr<'a>, node: Node<'a>, cx: &mut Context<'a>) -> bool {
    expr.tag() == ExprTag::Ident
        && !expr.is_parenthesized()
        && find_add_event_listener_callback(node, &mut cx.state)
            .and_then(|callback| callback.params().first())
            .filter(|first_param| !first_param.is_rest() && first_param.pat().as_ident().is_some())
            .and_then(|first_param| first_param.pat().symbol())
            .is_some_and(|event| expr.symbol() == Some(event))
}

fn check_static_member_expression<'a>(_: &PreferKeyboardEventKey, member_expr: Expr<'a>, cx: &mut Context<'a>) {
    let ExprKind::Dot { obj, name: property, .. } = member_expr.kind() else {
        return;
    };
    if !property.name().is_any(&DEPRECATED_PROPERTIES) || !is_event_parameter(obj, Node::Expr(member_expr), cx) {
        return;
    }
    let report = cx.report(property, PREFER_KEYBOARD_EVENT_KEY).data("deprecated_prop", property.bytes());
    // `event.keyCode === 27`
    if let Node::Expr(parent) = member_expr.parent()
        && !member_expr.is_parenthesized()
        && !member_expr.is_chain_root()
        && let ExprKind::Binary { op: BinOp::EqEq | BinOp::EqEqEq, left, right } = parent.kind()
        && let Some((number, ExprKind::Number(code))) = [right, left]
            .into_iter()
            .map(|it| (it, it.kind()))
            .find(|it| it.0.tag() == ExprTag::Number && !it.0.is_parenthesized())
        && let Some(key_name) = get_key_from_code(code)
    {
        report.fix(|fixer| {
            let mut key_str = Vec::new();
            print_string(&mut key_str, key_name.as_bytes(), b'\'');
            [fixer.replace(property, "key"), fixer.replace(number, key_str)]
        });
    }
}

fn check_binding_property<'a>(prop: PatProp<'a>, cx: &mut Context<'a>) {
    let (Some(KeyKind::Ident(_)), Some(value_name), None) =
        (prop.key().map(Key::kind), prop.value().as_ident(), prop.default())
    else {
        return;
    };
    // `{ keyCode: a }` is fine. `{ a: keyCode }` is not.
    if !value_name.is_any(&DEPRECATED_PROPERTIES) {
        return;
    }
    // What the pattern that it is in is the whole of.
    let mut owner = prop.parent();
    while matches!(owner, Node::Pat(_) | Node::PatProp(_) | Node::PatElem(_)) {
        owner = owner.parent();
    }
    let is_of_event = match owner {
        Node::VarDecl(declarator) => declarator.init().is_some_and(|init| is_event_parameter(init, owner, cx)),
        Node::Param(param) => find_add_event_listener_callback(Node::Param(param).parent(), &mut cx.state).is_some(),
        _ => false,
    };
    if is_of_event {
        cx.report(prop.value(), PREFER_KEYBOARD_EVENT_KEY).data("deprecated_prop", value_name.bytes());
    }
}

/// The `key` for a `keyCode`.
fn get_key_from_code(code: f64) -> Option<String> {
    let code = code as u32;
    let key = match code {
        8 => "Backspace",
        9 => "Tab",
        12 => "Clear",
        13 => "Enter",
        16 => "Shift",
        17 => "Control",
        18 => "Alt",
        19 => "Pause",
        20 => "CapsLock",
        27 => "Escape",
        32 => " ",
        33 => "PageUp",
        34 => "PageDown",
        35 => "End",
        36 => "Home",
        37 => "ArrowLeft",
        38 => "ArrowUp",
        39 => "ArrowRight",
        40 => "ArrowDown",
        45 => "Insert",
        46 => "Delete",
        112..=123 => return Some(format!("F{}", code - 111)),
        144 => "NumLock",
        145 => "ScrollLock",
        186 => ";",
        187 => "=",
        188 => ",",
        189 => "-",
        190 => ".",
        191 => "/",
        219 => "[",
        220 => "\\",
        221 => "]",
        222 => "'",
        224 => "Meta",
        _ => return char::from_u32(code).map(String::from),
    };
    Some(key.to_owned())
}
