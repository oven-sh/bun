use bun_core::strings;
use bun_lint::prelude::*;

/// Disallow octal escape sequences in string literals.
pub struct NoOctalEscape;

const OCTAL_ESCAPE_SEQUENCE: Message = Message::new(
    "octalEscapeSequence",
    "Don't use octal: '\\{{sequence}}'. Use '\\u....' instead.",
);

/// The group of `/^(?:[^\\]|\\.)*?\\([0-3][0-7]{1,2}|[4-7][0-7]|0(?=[89])|[1-7])/su`.
fn octal_escape(raw: &[u8]) -> Option<&[u8]> {
    let mut at = 0;
    while let Some(found) = strings::index_of_char_usize(raw.get(at..)?, b'\\') {
        let start = at + found + 1;
        let is_octal = |i: usize| matches!(raw.get(start + i), Some(b'0'..=b'7'));
        let len = match raw.get(start)? {
            b'0'..=b'3' if is_octal(1) => 2 + usize::from(is_octal(2)),
            b'4'..=b'7' if is_octal(1) => 2,
            b'0' if matches!(raw.get(start + 1), Some(b'8' | b'9')) => 1,
            b'1'..=b'7' => 1,
            _ => 0,
        };
        if len > 0 {
            return raw.get(start..start + len);
        }
        at = start + 1;
    }
    None
}

/// `literal`: what can be a string in quotes.
fn check(literal: Span, cx: &Cx<'_, NoOctalEscape>) {
    let raw = cx.slice(literal);
    if matches!(raw.first(), Some(b'"' | b'\''))
        && let Some(sequence) = octal_escape(raw)
    {
        cx.report(literal, OCTAL_ESCAPE_SEQUENCE).data("sequence", sequence);
    }
}

fn check_key<'a>(key: Option<Key<'a>>, cx: &Cx<'a, NoOctalEscape>) {
    if let Some(key) = key
        && matches!(key.kind(), KeyKind::String(_) | KeyKind::ComputedString(_))
    {
        check(key.inner_span(cx.file()), cx);
    }
}

impl Rule for NoOctalEscape {
    const META: Meta = Meta::eslint("no-octal-escape", Kind::Suggestion);
    type State<'a> = ();

    fn new(_: &Options) -> Self {
        NoOctalEscape
    }

    fn register<'a>(&self, on: &mut Listeners<'a, Self>, file: &'a File<'a>) {
        if !strings::contains_char(file.text(), b'\\') {
            return;
        }
        on.exprs([ExprTag::String], |_, e, cx| {
            if !e.is_jsx_text() && !e.is_jsx_tag_name() {
                check(e.span(), cx);
            }
        });
        // The strings that are a `Literal` for ESLint and not an expression here.
        on.props(|_, prop, cx| check_key(prop.key(), cx));
        on.members(|_, member, cx| {
            if member.flags().contains(Flags::STRING_NAME) {
                check_key(member.key(), cx);
            }
        });
        on.enum_members(|_, member, cx| check_key(member.key(), cx));
        on.pats([PatTag::Object], |_, pat, cx| {
            if let PatKind::Object(props) = pat.kind() {
                props.iter().for_each(|prop| check_key(prop.key(), cx));
            }
        });
        on.types([TypeTag::StringLit], |_, ty, cx| check(ty.span(), cx));
        on.import_specs(|_, spec, cx| check(spec.imported().span(), cx));
        on.export_specs(|_, spec, cx| {
            check(spec.local().span(), cx);
            if spec.is_renamed() {
                check(spec.exported().span(), cx);
            }
        });
        on.stmts(
            [StmtTag::Import, StmtTag::ExportNamed, StmtTag::ExportStar, StmtTag::ImportEquals, StmtTag::Module],
            |_, stmt, cx| {
                match stmt.kind() {
                    StmtKind::ExportStar { alias: Some(alias), .. } => check(alias.span(), cx),
                    StmtKind::Module(module) => check(module.name_span(), cx),
                    _ => {}
                }
                if let Some(specifier) = stmt.module_specifier_span() {
                    check(specifier, cx);
                }
            },
        );
    }
}
