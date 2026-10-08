use bun_core::strings;
use bun_lint::prelude::*;
use bun_lint::utils::char_source;

/// Disallow `javascript:` URLs.
pub struct NoScriptUrl;

const UNEXPECTED_SCRIPT_URL: Message =
    Message::new("unexpectedScriptURL", "Script URL is a form of eval.");

const SCHEME: &[u8] = b"javascript:";

fn is_script_url(value: Name) -> bool {
    value.bytes().get(..SCHEME.len()).is_some_and(|start| start.eq_ignore_ascii_case(SCHEME))
}

/// `raw`: a string as it is written, with its quotes.
fn is_script_url_literal(raw: &[u8]) -> bool {
    let Some(start) = raw.get(1..=SCHEME.len()) else {
        return false;
    };
    if !strings::contains_char(start, b'\\') {
        return start.eq_ignore_ascii_case(SCHEME);
    }
    let value = char_source::parse_string_literal(raw);
    value.len() >= SCHEME.len()
        && value
            .iter()
            .zip(SCHEME)
            .all(|(unit, c)| u8::try_from(unit.code_unit).is_ok_and(|it| it.eq_ignore_ascii_case(c)))
}

/// `` [`a`] ``, which is a `TemplateLiteral` for ESLint and not an expression here.
fn check_template_key<'a>(key: Option<Key<'a>>, cx: &Cx<'a, NoScriptUrl>) {
    if let Some(key) = key
        && let KeyKind::ComputedString(value) = key.kind()
        && is_script_url(value)
    {
        let span = key.inner_span(cx.file());
        if cx.slice(span).starts_with(b"`") {
            cx.report(span, UNEXPECTED_SCRIPT_URL);
        }
    }
}

impl Rule for NoScriptUrl {
    const META: Meta = Meta::eslint("no-script-url", Kind::Suggestion);
    type State<'a> = ();

    fn new(_: &Options) -> Self {
        NoScriptUrl
    }

    fn register<'a>(&self, on: &mut Listeners<'a, Self>, file: &'a File<'a>) {
        on.string_literals(|_, literal, cx| {
            // After the quote: the `j`, an escape, or an entity in JSX.
            if !matches!(literal.text().get(1), Some(b'j' | b'J' | b'\\' | b'&')) {
                return;
            }
            let found = match literal.owner() {
                // The value of a JSX attribute is written differently.
                Node::Expr(e) => e.as_string().is_some_and(is_script_url),
                _ => is_script_url_literal(literal.text()),
            };
            if found {
                cx.report(literal, UNEXPECTED_SCRIPT_URL);
            }
        });
        if !strings::contains_char(file.text(), b'`') {
            return;
        }
        on.exprs([ExprTag::Template], |_, e, cx| {
            if let ExprKind::Template(template) = e.kind()
                && template.as_static().is_some_and(is_script_url)
                && !matches!(e.parent(), Node::Expr(parent) if parent.tag() == ExprTag::TaggedTemplate)
            {
                cx.report(e, UNEXPECTED_SCRIPT_URL);
            }
        });
        on.types([TypeTag::StringLit], |_, ty, cx| {
            if matches!(ty.kind(), TypeKind::StringLit(value) if is_script_url(value))
                && ty.text().starts_with(b"`")
            {
                cx.report(ty, UNEXPECTED_SCRIPT_URL);
            }
        });
        on.props(|_, prop, cx| check_template_key(prop.key(), cx));
        on.members(|_, member, cx| check_template_key(member.key(), cx));
        on.pats([PatTag::Object], |_, pat, cx| {
            if let PatKind::Object(props) = pat.kind() {
                props.iter().for_each(|prop| check_template_key(prop.key(), cx));
            }
        });
    }
}
