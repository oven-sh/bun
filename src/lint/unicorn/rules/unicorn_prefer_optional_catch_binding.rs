use bun_lint::prelude::*;
use bun_lint::rule::Plugin;
use smallvec::{SmallVec, smallvec};

/// Prefers omitting the catch binding parameter if it is unused.
pub struct PreferOptionalCatchBinding;

const PREFER_OPTIONAL_CATCH_BINDING: Message =
    Message::new("", "Prefer omitting the catch binding parameter if it is unused");

/// Whether something that `pat` binds is referred to. A default value counts as that. The `...rest` of an array does
/// not count at all, as in oxlint.
fn is_param_referenced(pat: Pat) -> bool {
    let mut pending: SmallVec<[Pat; 4]> = smallvec![pat];
    while let Some(pat) = pending.pop() {
        match pat.kind() {
            PatKind::Ident(_) => {
                if pat.symbol().is_some_and(|it| it.references().next().is_some()) {
                    return true;
                }
            }
            PatKind::Object(properties) => {
                if properties.iter().any(|it| it.default().is_some()) {
                    return true;
                }
                pending.extend(properties.iter().map(PatProp::value));
            }
            PatKind::Array(elements) => {
                if elements.iter().any(|it| it.default().is_some()) {
                    return true;
                }
                pending.extend(elements.iter().filter(|it| !it.is_rest()).filter_map(PatElem::pat));
            }
            _ => {}
        }
    }
    false
}

impl Rule for PreferOptionalCatchBinding {
    const META: Meta =
        Meta::oxlint(Plugin::Unicorn, "prefer-optional-catch-binding", Kind::Suggestion).fixable(Fixable::Code);
    type State<'a> = ();

    fn new(_: &Options) -> Self {
        PreferOptionalCatchBinding
    }

    fn register<'a>(&self, on: &mut Listeners<'a, Self>, _: &'a File<'a>) {
        on.stmts([StmtTag::Try], |_, stmt, cx| {
            let StmtKind::Try { param: Some(param), handler: Some(body), .. } = stmt.kind() else {
                return;
            };
            let pat = param.pat();
            if is_param_referenced(pat) {
                return;
            }
            cx.report(pat, PREFER_OPTIONAL_CATCH_BINDING).fix(|fixer| {
                // From the `(`, which is the first that is not white space after the `catch`, to the block.
                let after_catch = stmt.catch_clause_span()?.start + 5;
                let before_param = fixer.file().slice(Span::new(after_catch, pat.span().start));
                let white_space = before_param.iter().position(|it| !it.is_ascii_whitespace()).unwrap_or(0);
                Some(fixer.remove(Span::new(after_catch + white_space as u32, body.span().start)))
            });
        });
    }
}
