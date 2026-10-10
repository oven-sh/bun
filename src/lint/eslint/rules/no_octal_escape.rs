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
    const ON: On = On::new()
        .exprs(&[ExprTag::String])
        .props()
        .members()
        .enum_members()
        .pats(&[PatTag::Object])
        .types(&[TypeTag::StringLit])
        .import_specs()
        .export_specs()
        .stmts(&[StmtTag::Import, StmtTag::ExportNamed, StmtTag::ExportStar, StmtTag::ImportEquals, StmtTag::Module]);
    type State<'a> = ();

    fn new(_: &Options) -> Self {
        NoOctalEscape
    }

    fn start<'a>(&self, file: &'a File<'a>) -> Option<()> {
        strings::contains_char(file.text(), b'\\').then_some(())
    }

    fn expr<'a>(&self, e: Expr<'a>, cx: &mut Cx<'a, Self>) {
        if !e.is_jsx_text() && !e.is_jsx_tag_name() {
            check(e.span(), cx);
        }
    }

    // The strings that are a `Literal` for ESLint and not an expression here.

    fn prop<'a>(&self, prop: Prop<'a>, cx: &mut Cx<'a, Self>) {
        check_key(prop.key(), cx);
    }

    fn member<'a>(&self, member: Member<'a>, cx: &mut Cx<'a, Self>) {
        if member.flags().contains(Flags::STRING_NAME) {
            check_key(member.key(), cx);
        }
    }

    fn enum_member<'a>(&self, member: EnumMember<'a>, cx: &mut Cx<'a, Self>) {
        check_key(member.key(), cx);
    }

    fn pat<'a>(&self, pat: Pat<'a>, cx: &mut Cx<'a, Self>) {
        if let PatKind::Object(props) = pat.kind() {
            props.iter().for_each(|prop| check_key(prop.key(), cx));
        }
    }

    fn ty<'a>(&self, ty: TypeNode<'a>, cx: &mut Cx<'a, Self>) {
        check(ty.span(), cx);
    }

    fn import_spec<'a>(&self, spec: ImportSpec<'a>, cx: &mut Cx<'a, Self>) {
        check(spec.imported().span(), cx);
    }

    fn export_spec<'a>(&self, spec: ExportSpec<'a>, cx: &mut Cx<'a, Self>) {
        check(spec.local().span(), cx);
        if spec.is_renamed() {
            check(spec.exported().span(), cx);
        }
    }

    fn stmt<'a>(&self, stmt: Stmt<'a>, cx: &mut Cx<'a, Self>) {
        match stmt.kind() {
            StmtKind::ExportStar { alias: Some(alias), .. } => check(alias.span(), cx),
            StmtKind::Module(module) => check(module.name_span(), cx),
            _ => {}
        }
        if let Some(specifier) = stmt.module_specifier_span() {
            check(specifier, cx);
        }
    }
}
