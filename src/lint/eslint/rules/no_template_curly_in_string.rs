use bun_core::strings;
use bun_lint::prelude::*;

/// Disallow template literal placeholder syntax in regular strings.
pub struct NoTemplateCurlyInString;

const UNEXPECTED_TEMPLATE_EXPRESSION: Message = Message::new(
    "unexpectedTemplateExpression",
    "Unexpected template string expression.",
);

/// `/\$\{[^}]+\}/u.test(value)`
fn has_placeholder(value: Name) -> bool {
    let mut rest = value.bytes();
    while let Some(at) = strings::index_of(rest, b"${") {
        rest = rest.get(at + 2..).unwrap_or_default();
        match strings::index_of_char_usize(rest, b'}') {
            None => return false,
            Some(0) => {}
            Some(_) => return true,
        }
    }
    false
}

/// Whether what is written at `span` is in quotes, as opposed to backticks.
fn is_quoted(file: &File, span: Span) -> bool {
    matches!(file.text().get(span.start as usize), Some(b'"' | b'\''))
}

/// A name that can be written as a string: in the braces of an import or an export, of a module.
fn check_ident<'a>(name: Ident<'a>, cx: &mut Cx<'a, NoTemplateCurlyInString>) {
    if has_placeholder(name.name()) && name.is_string() {
        cx.report(name, UNEXPECTED_TEMPLATE_EXPRESSION);
    }
}

fn check_key<'a>(key: Option<Key<'a>>, cx: &mut Cx<'a, NoTemplateCurlyInString>) {
    if let Some(key) = key
        && let KeyKind::String(value) | KeyKind::ComputedString(value) = key.kind()
        && has_placeholder(value)
    {
        let span = key.inner_span(cx.file());
        if is_quoted(cx.file(), span) {
            cx.report(span, UNEXPECTED_TEMPLATE_EXPRESSION);
        }
    }
}

impl Rule for NoTemplateCurlyInString {
    const META: Meta = Meta::eslint("no-template-curly-in-string", Kind::Problem);
    type State<'a> = ();

    fn new(_: &Options) -> Self {
        NoTemplateCurlyInString
    }

    fn register<'a>(&self, on: &mut Listeners<'a, Self>, _: &'a File<'a>) {
        on.exprs([ExprTag::String], |_, e, cx| {
            if e.as_string().is_some_and(has_placeholder) && !e.is_jsx_text() && !e.is_jsx_tag_name() {
                cx.report(e, UNEXPECTED_TEMPLATE_EXPRESSION);
            }
        });
        // The strings that are a `Literal` for ESLint and not an expression here.
        on.props(|_, prop, cx| check_key(prop.key(), cx));
        on.members(|_, member, cx| check_key(member.key(), cx));
        on.enum_members(|_, member, cx| check_key(member.key(), cx));
        on.pats([PatTag::Object], |_, pat, cx| {
            if let PatKind::Object(props) = pat.kind() {
                props.iter().for_each(|prop| check_key(prop.key(), cx));
            }
        });
        on.types([TypeTag::StringLit], |_, ty, cx| {
            if matches!(ty.kind(), TypeKind::StringLit(value) if has_placeholder(value))
                && is_quoted(cx.file(), ty.span())
            {
                cx.report(ty, UNEXPECTED_TEMPLATE_EXPRESSION);
            }
        });
        on.import_specs(|_, spec, cx| check_ident(spec.imported(), cx));
        on.export_specs(|_, spec, cx| {
            check_ident(spec.local(), cx);
            if spec.is_renamed() {
                check_ident(spec.exported(), cx);
            }
        });
        on.stmts(
            [StmtTag::Import, StmtTag::ExportNamed, StmtTag::ExportStar, StmtTag::ImportEquals, StmtTag::Module],
            |_, stmt, cx| {
                let specifier = match stmt.kind() {
                    StmtKind::Import(import) => Some(import.spec()),
                    StmtKind::ExportNamed(export) => export.spec(),
                    StmtKind::ExportStar { spec, alias, .. } => {
                        if let Some(alias) = alias {
                            check_ident(alias, cx);
                        }
                        spec
                    }
                    StmtKind::ImportEquals(import) => match import.target() {
                        ImportEqualsTarget::Require(spec) => spec,
                        ImportEqualsTarget::Entity(_) => None,
                    },
                    StmtKind::Module(module) => {
                        if let ModuleName::String(name) = module.name() {
                            check_ident(name, cx);
                        }
                        None
                    }
                    _ => None,
                };
                if specifier.is_some_and(has_placeholder)
                    && let Some(span) = stmt.module_specifier_span()
                {
                    cx.report(span, UNEXPECTED_TEMPLATE_EXPRESSION);
                }
            },
        );
    }
}
