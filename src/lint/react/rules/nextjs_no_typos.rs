use bstr::ByteSlice;
use bun_core::strings;
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;
use smallvec::SmallVec;

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
    if let Some(suggestion) = best_match(name.bytes()) {
        let data = [("typo", name.bytes()), ("suggestion", suggestion.as_bytes())];
        let report = cx.report(span, NO_TYPOS).data("typo", name).data("suggestion", suggestion);
        report.suggest_with(CHANGE, &data, |fixer| fixer.replace(span, suggestion));
    }
}

/// `oxc_span`'s `min_edit_distance`: how many characters have to be replaced, added or removed. `b` is ASCII.
fn min_edit_distance(a: &[u8], b: &[u8]) -> usize {
    let mut prev: SmallVec<[usize; 24]> = (0..=b.len()).collect();
    let mut curr: SmallVec<[usize; 24]> = SmallVec::new();
    for (i, ca) in a.chars().enumerate() {
        curr.clear();
        curr.push(i + 1);
        for (j, &cb) in b.iter().enumerate() {
            let (Some(&replaced), Some(&removed), Some(&added)) = (prev.get(j), prev.get(j + 1), curr.get(j)) else {
                break;
            };
            curr.push((replaced + usize::from(ca != char::from(cb))).min(removed + 1).min(added + 1));
        }
        std::mem::swap(&mut prev, &mut curr);
    }
    prev.last().copied().unwrap_or(0)
}

/// `oxc_span`'s `best_match`: the closest of the names. `None` if `needle` is one of them, or like none.
fn best_match(needle: &[u8]) -> Option<&'static str> {
    let mut best: Option<(&'static str, usize)> = None;
    for candidate in NEXTJS_DATA_FETCHING_FUNCTIONS {
        if candidate.len().abs_diff(needle.len()) > THRESHOLD {
            continue;
        }
        match min_edit_distance(needle, candidate.as_bytes()) {
            0 => return None,
            distance if distance <= THRESHOLD && best.is_none_or(|it| distance < it.1) => best = Some((candidate, distance)),
            _ => {}
        }
    }
    best.map(|it| it.0)
}
