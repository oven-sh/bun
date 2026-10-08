use bun_lint::prelude::*;

/// Enforce or disallow parentheses when invoking a constructor with no arguments.
pub struct NewParens {
    always: bool,
}

const MISSING: Message = Message::new("missing", "Missing '()' invoking a constructor.");
const UNNECESSARY: Message = Message::new(
    "unnecessary",
    "Unnecessary '()' invoking a constructor with no arguments.",
);

impl Rule for NewParens {
    const META: Meta = Meta::eslint("new-parens", Kind::Layout)
        .fixable(Fixable::Code)
        .deprecated();
    type State<'a> = ();

    fn new(options: &Options) -> Self {
        NewParens {
            always: options.str(0) != Some("never"),
        }
    }

    fn register<'a>(&self, on: &mut Listeners<'a, Self>, _: &'a File<'a>) {
        on.exprs([ExprTag::New], |rule, e, cx| {
            let ExprKind::New(call) = e.kind() else {
                return;
            };
            if !call.args().is_empty() {
                return;
            }
            match (call.close_paren(), rule.always) {
                (None, true) => {
                    cx.report(e, MISSING).fix(|fixer| fixer.insert_after(e, "()"));
                }
                (Some(close), false) => {
                    cx.report(e, UNNECESSARY).fix(|fixer| {
                        let head_end = (call.type_args().angle_brackets_span())
                            .map_or_else(|| call.callee().outer_span().end, |it| it.end);
                        let open = skip_trivia(fixer.file().text(), head_end);
                        [
                            fixer.remove(Span::new(open, open + 1)),
                            fixer.remove(Span::new(close, close + 1)),
                            fixer.insert_before(e, "("),
                            fixer.insert_after(e, ")"),
                        ]
                    });
                }
                _ => {}
            }
        });
    }
}
