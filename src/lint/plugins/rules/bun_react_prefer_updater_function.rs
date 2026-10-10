use bun_lint::prelude::*;
use bun_lint::rule::Plugin;

/// Prefer a function of the previous state to an array or object that is made of the state as of the last render.
///
/// See "Updating state based on the previous state" in React's reference of `useState`.
pub struct ReactPreferUpdaterFunction;

const STALE_STATE: Message = Message::new(
    "staleState",
    "`{{state}}` is the state as of the last render, which can be out of date when `{{setter}}` is called. Pass a function: `{{setter}}(previous => ..)`.",
);

/// The identifiers that are spread into the array or the object literal `e`.
fn spread_identifiers(e: Expr<'_>) -> impl Iterator<Item = Expr<'_>> {
    let (elements, properties) = match e.kind() {
        ExprKind::Array(elements) => (Some(elements), None),
        ExprKind::Object(properties) => (None, Some(properties)),
        _ => (None, None),
    };
    let of_array = elements.into_iter().flatten().filter_map(|it| match it.kind() {
        ExprKind::Spread(argument) => Some(argument),
        _ => None,
    });
    let spreads = properties.into_iter().flatten().filter(|it| it.kind() == PropKind::Spread);
    let of_object = spreads.filter_map(Prop::value);
    of_array.chain(of_object).filter(|it| it.tag() == ExprTag::Ident)
}

/// The `const [state, setter] = useState(..)` that declares `e`.
fn use_state_declaration(e: Expr<'_>) -> Option<VarDecl<'_>> {
    let Node::VarDecl(declaration) = e.symbol()?.declarations().next()?.node()? else {
        return None;
    };
    let callee = declaration.init()?.callee()?;
    let is_hook = callee.is_ident("useState") || ast_utils::is_specific_member_access(callee, None, Some("useState"));
    (is_hook && declaration.pat().tag() == PatTag::Array).then_some(declaration)
}

/// `setRows` and `rows`
fn are_named_as_a_pair(setter: &[u8], state: &[u8]) -> bool {
    match (setter.strip_prefix(b"set"), state) {
        (Some([first, rest @ ..]), [state_first, state_rest @ ..]) => {
            first.is_ascii_uppercase() && first.to_ascii_lowercase() == *state_first && rest == state_rest
        }
        _ => false,
    }
}

/// Whether `setter` sets the state that `state` is. If neither is from a `useState()` in the file, their names decide.
fn is_setter_of<'a>(setter: Expr<'a>, state: Expr<'a>) -> bool {
    match (use_state_declaration(setter), use_state_declaration(state)) {
        (Some(of_setter), Some(of_state)) => of_setter == of_state && setter.symbol() != state.symbol(),
        (None, None) => are_named_as_a_pair(setter.text(), state.text()),
        _ => false,
    }
}

impl Rule for ReactPreferUpdaterFunction {
    const META: Meta = Meta::plugin(Plugin::Bun, "react-prefer-updater-function", Kind::Suggestion);
    const ON: On = On::new().exprs(&[ExprTag::Call]);
    no_state!();

    fn new(_: &Options) -> Self {
        ReactPreferUpdaterFunction
    }

    fn expr<'a>(&self, e: Expr<'a>, cx: &mut Cx<'a, Self>) {
        if let Some(call) = e.as_call()
            && call.args().len() == 1
            && call.callee().tag() == ExprTag::Ident
            && let Some(value) = call.args().first()
            && let Some(state) = spread_identifiers(value).find(|it| is_setter_of(call.callee(), *it))
        {
            cx.report(state, STALE_STATE).data("state", state.text()).data("setter", call.callee().text());
        }
    }
}
