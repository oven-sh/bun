use bun_lint::prelude::*;

/// Disallow `javascript:` URLs.
pub struct NoScriptUrl;

const UNEXPECTED_SCRIPT_URL: Message =
    Message::new("unexpectedScriptURL", "Script URL is a form of eval.");

fn is_script_url(value: Name) -> bool {
    value.bytes().get(..11).is_some_and(|start| start.eq_ignore_ascii_case(b"javascript:"))
}

/// A name that can be written as a string: in the braces of an import or an export, of a module.
fn check_ident<'a>(name: Ident<'a>, cx: &mut Cx<'a, NoScriptUrl>) {
    if is_script_url(name.name()) && name.is_string() {
        cx.report(name, UNEXPECTED_SCRIPT_URL);
    }
}

fn check_key<'a>(key: Option<Key<'a>>, cx: &mut Cx<'a, NoScriptUrl>) {
    if let Some(key) = key
        && let KeyKind::String(value) | KeyKind::ComputedString(value) = key.kind()
        && is_script_url(value)
    {
        cx.report(key.inner_span(cx.file()), UNEXPECTED_SCRIPT_URL);
    }
}

impl Rule for NoScriptUrl {
    const META: Meta = Meta::eslint("no-script-url", Kind::Suggestion);
    type State<'a> = ();

    fn new(_: &Options) -> Self {
        NoScriptUrl
    }

    fn register<'a>(&self, on: &mut Listeners<'a, Self>, _: &'a File<'a>) {
        on.exprs([ExprTag::String], |_, e, cx| {
            if e.as_string().is_some_and(is_script_url) && !e.is_jsx_text() && !e.is_jsx_tag_name() {
                cx.report(e, UNEXPECTED_SCRIPT_URL);
            }
        });
        on.exprs([ExprTag::Template], |_, e, cx| {
            if let ExprKind::Template(template) = e.kind()
                && template.as_static().is_some_and(is_script_url)
                && !matches!(e.parent(), Node::Expr(parent) if parent.tag() == ExprTag::TaggedTemplate)
            {
                cx.report(e, UNEXPECTED_SCRIPT_URL);
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
            if matches!(ty.kind(), TypeKind::StringLit(value) if is_script_url(value)) {
                cx.report(ty, UNEXPECTED_SCRIPT_URL);
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
                if specifier.is_some_and(is_script_url)
                    && let Some(span) = stmt.module_specifier_span()
                {
                    cx.report(span, UNEXPECTED_SCRIPT_URL);
                }
            },
        );
    }
}
