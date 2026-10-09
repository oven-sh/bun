use bun_core::strings;
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;
use bun_lint_oxlint::text::best_match;

/// Detects common typos in Next.js data fetching function names.
pub struct NoTypos;

const NO_TYPOS: Message = Message::new("", "`{{typo}}` may be a typo. Did you mean `{{suggestion}}`?");
const CHANGE: Message = Message::new("", "Change `{{typo}}` to `{{suggestion}}`");

const NEXTJS_DATA_FETCHING_FUNCTIONS: [&str; 3] = ["getStaticProps", "getStaticPaths", "getServerSideProps"];
const THRESHOLD: usize = 1;

/// The file is under a directory `pages`, the first in its path, and not in the `api` of that.
fn is_page(file_path: &[u8]) -> bool {
    let mut components = strings::split(file_path, b"/").filter(|it| !matches!(*it, b"" | b"."));
    components.any(|it| it == b"pages") && components.next().is_some_and(|it| it != b"api")
}

impl Rule for NoTypos {
    const META: Meta = Meta::oxlint(Plugin::Nextjs, "no-typos", Kind::Problem).has_suggestions();
    type State<'a> = ();

    fn new(_: &Options) -> Self {
        NoTypos
    }

    fn register<'a>(&self, on: &mut Listeners<'a, Self>, file: &'a File<'a>) {
        if !is_page(file.path()) {
            return;
        }
        on.stmts([StmtTag::Var, StmtTag::Fn], |_, stmt, cx| {
            if !stmt.is_exported() || stmt.is_default_export() {
                return;
            }
            match stmt.kind() {
                StmtKind::Var(declarators) => {
                    for id in declarators.iter().map(VarDecl::pat) {
                        if let Some(name) = id.as_ident() {
                            check_function_name(name, id.span(), cx);
                        }
                    }
                }
                StmtKind::Fn(func) => {
                    if let Some(id) = func.name() {
                        check_function_name(id.name(), id.span(), cx);
                    }
                }
                _ => {}
            }
        });
    }
}

fn check_function_name<'a>(name: Name<'a>, span: Span, cx: &Cx<'a, NoTypos>) {
    if let Some(suggestion) = best_match(name.bytes(), &NEXTJS_DATA_FETCHING_FUNCTIONS, THRESHOLD) {
        let data = [("typo", name.bytes()), ("suggestion", suggestion.as_bytes())];
        let report = cx.report(span, NO_TYPOS).data("typo", name).data("suggestion", suggestion);
        report.suggest_with(CHANGE, &data, |fixer| fixer.replace(span, suggestion));
    }
}
