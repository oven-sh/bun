use bun_lint::prelude::*;

/// Require or disallow trailing commas.
pub struct CommaDangle {
    option: OptionValue,
}

enum OptionValue {
    /// A string, which does not apply to functions before ES2017.
    All(Mode),
    Each(Modes),
}

#[derive(Copy, Clone, PartialEq, Eq)]
pub enum Mode {
    AlwaysMultiline,
    Always,
    Ignore,
    Never,
    OnlyMultiline,
}

/// ESLint's `normalizeOptions`.
#[derive(Copy, Clone)]
pub struct Modes {
    arrays: Mode,
    objects: Mode,
    imports: Mode,
    exports: Mode,
    functions: Mode,
}

const UNEXPECTED: Message = Message::new("unexpected", "Unexpected trailing comma.");
const MISSING: Message = Message::new("missing", "Missing trailing comma.");

impl Mode {
    fn of(value: &str) -> Option<Mode> {
        Some(match value {
            "always-multiline" => Mode::AlwaysMultiline,
            "always" => Mode::Always,
            "ignore" => Mode::Ignore,
            "never" => Mode::Never,
            "only-multiline" => Mode::OnlyMultiline,
            _ => return None,
        })
    }
}

/// The last of the items of a list that can end with a comma.
#[derive(Copy, Clone)]
struct LastItem {
    /// Where the token ends that a trailing comma follows.
    end: u32,
    /// It is a `RestElement`, which no comma can follow.
    is_rest: bool,
}

/// The offset of ESLint's `getNextLocation` of what is at `at`: one UTF-16 code unit further, or where the next line starts.
/// `at` at the end of the file.
fn next_location(source: &[u8], at: u32) -> u32 {
    match source.get(at as usize..).unwrap_or_default() {
        [] => at,
        [b'\r', b'\n', ..] => at + 2,
        [0xE0..=0xEF, ..] => at + 3,
        // Two bytes, or the first half of a surrogate pair.
        [0xC0..=0xDF | 0xF0..=0xFF, ..] => at + 2,
        _ => at + 1,
    }
}

fn check(mode: Mode, last: LastItem, cx: &Cx<'_, CommaDangle>) {
    let (file, source) = (cx.file(), cx.text());
    let after = skip_trivia(source, last.end);
    let has_comma = source.get(after as usize) == Some(&b',');
    // The closing token is not on the line of what precedes it.
    let is_multiline = || {
        let trailing_end = if has_comma { after + 1 } else { last.end };
        text::has_line_break(file.slice(Span::new(trailing_end, skip_trivia(source, trailing_end))))
    };
    let forces = match mode {
        Mode::Ignore => return,
        Mode::Never => false,
        Mode::Always => true,
        Mode::AlwaysMultiline => is_multiline(),
        Mode::OnlyMultiline if is_multiline() => return,
        Mode::OnlyMultiline => false,
    };
    // The fixes include the tokens around the comma, so that they conflict with those of a rule
    // that adds or removes an item.
    if !forces || last.is_rest {
        if has_comma {
            let comma = Span::new(after, after + 1);
            cx.report(comma, UNEXPECTED).fix(|fixer| {
                let (before, next) = (file.token_before(comma)?, file.token_after(comma)?);
                Some([fixer.remove(comma), fixer.insert_before(before, ""), fixer.insert_after(next, "")])
            });
        }
    } else if !has_comma {
        let at = Span::empty(last.end);
        cx.report(Span::after(at, next_location(source, last.end)), MISSING).fix(|fixer| {
            let (trailing, next) = (file.token_before(at)?, file.token_after(at)?);
            Some([
                fixer.insert_after(trailing, ","),
                fixer.insert_before(trailing, ""),
                fixer.insert_after(next, ""),
            ])
        });
    }
}

impl CommaDangle {
    /// An `ObjectExpression`, or an `ObjectPattern` in an assignment.
    fn check_object<'a>(&self, e: Expr<'a>, cx: &mut Cx<'a, Self>) {
        let ExprKind::Object(properties) = e.kind() else {
            return;
        };
        let Some(last) = properties.last() else {
            return;
        };
        // The `{ type: "json" }` of `with { type: "json" }` is not an object.
        if matches!(e.parent(), Node::File(_)) {
            return;
        }
        let item = LastItem {
            end: last.span().end,
            is_rest: last.kind() == PropKind::Spread && utils::is_assignment_target(e),
        };
        check(cx.state.objects, item, cx);
    }

    /// An `ArrayExpression`, or an `ArrayPattern` in an assignment.
    fn check_array<'a>(&self, e: Expr<'a>, cx: &mut Cx<'a, Self>) {
        let ExprKind::Array(elements) = e.kind() else {
            return;
        };
        let Some(last) = elements.last().filter(|last| !last.is_missing()) else {
            return;
        };
        // In a pattern, ESLint looks for the comma directly after the element, before the
        // parentheses around it.
        let is_spread = last.tag() == ExprTag::Spread;
        let is_pattern = (is_spread || last.is_parenthesized()) && utils::is_assignment_target(e);
        let item = LastItem {
            end: if is_pattern { last.span().end } else { last.outer_span().end },
            is_rest: is_spread && is_pattern,
        };
        check(cx.state.arrays, item, cx);
    }

    /// An `ObjectPattern` or an `ArrayPattern` in a declaration or a parameter.
    fn check_binding_pattern<'a>(&self, pattern: Pat<'a>, cx: &mut Cx<'a, Self>) {
        match pattern.kind() {
            PatKind::Object(properties) => {
                if let Some(last) = properties.last() {
                    let item = LastItem {
                        end: last.span().end,
                        is_rest: last.is_rest(),
                    };
                    check(cx.state.objects, item, cx);
                }
            }
            PatKind::Array(elements) => {
                if let Some(last) = elements.last().filter(|last| last.pat().is_some()) {
                    let item = LastItem {
                        end: last.span().end,
                        is_rest: last.is_rest(),
                    };
                    check(cx.state.arrays, item, cx);
                }
            }
            PatKind::Ident(_) | PatKind::Missing => {}
        }
    }

    /// A `FunctionDeclaration`, a `FunctionExpression` or an `ArrowFunctionExpression`.
    fn check_function<'a>(&self, func: Func<'a>, cx: &mut Cx<'a, Self>) {
        if ast_utils::is_function_with_body(func)
            && let Some(last) = func.params().last().or_else(|| func.this_param())
        {
            let item = LastItem {
                end: last.span().end,
                is_rest: last.is_rest(),
            };
            check(cx.state.functions, item, cx);
        }
    }

    /// A `CallExpression` or a `NewExpression`.
    fn check_call<'a>(&self, e: Expr<'a>, cx: &mut Cx<'a, Self>) {
        if let ExprKind::Call(call) | ExprKind::New(call) = e.kind()
            && let Some(last) = call.args().last()
        {
            let item = LastItem {
                end: last.outer_span().end,
                is_rest: false,
            };
            check(cx.state.functions, item, cx);
        }
    }
}

impl Rule for CommaDangle {
    const META: Meta = Meta::eslint("comma-dangle", Kind::Layout).fixable(Fixable::Code).deprecated();
    type State<'a> = Modes;

    fn new(options: &Options) -> Self {
        let object = options.object(0);
        let mode = |key: &str| object.str(key).and_then(Mode::of).unwrap_or(Mode::Never);
        CommaDangle {
            option: match options.str(0).and_then(Mode::of) {
                Some(mode) => OptionValue::All(mode),
                None => OptionValue::Each(Modes {
                    arrays: mode("arrays"),
                    objects: mode("objects"),
                    imports: mode("imports"),
                    exports: mode("exports"),
                    functions: mode("functions"),
                }),
            },
        }
    }

    fn register<'a>(&self, on: &mut Listeners<'a, Self>, file: &'a File<'a>) -> Modes {
        let modes = match self.option {
            OptionValue::All(mode) => Modes {
                arrays: mode,
                objects: mode,
                imports: mode,
                exports: mode,
                functions: if file.language().ecma_version < 2017 { Mode::Ignore } else { mode },
            },
            OptionValue::Each(modes) => modes,
        };
        if modes.objects != Mode::Ignore {
            on.exprs([ExprTag::Object], Self::check_object);
            on.pats([PatTag::Object], Self::check_binding_pattern);
            // ESLint has `{ with: { type: "json" } }` in `import("m", { with: { type: "json" } })`
            // as two object literals.
            on.types([TypeTag::Import], |_, ty, cx| {
                let Some(attributes) = ty.import_attributes() else {
                    return;
                };
                let ends = [attributes.entries().last().map(|last| last.span().end), Some(attributes.braces_span().end)];
                for end in ends.into_iter().flatten() {
                    check(cx.state.objects, LastItem { end, is_rest: false }, cx);
                }
            });
        }
        if modes.arrays != Mode::Ignore {
            on.exprs([ExprTag::Array], Self::check_array);
            on.pats([PatTag::Array], Self::check_binding_pattern);
        }
        if modes.imports != Mode::Ignore {
            on.stmts([StmtTag::Import], |_, statement, cx| {
                if let StmtKind::Import(import) = statement.kind()
                    && let Some(last) = import.named().last()
                {
                    let item = LastItem {
                        end: last.span().end,
                        is_rest: false,
                    };
                    check(cx.state.imports, item, cx);
                }
            });
        }
        if modes.exports != Mode::Ignore {
            on.stmts([StmtTag::ExportNamed], |_, statement, cx| {
                if let StmtKind::ExportNamed(export) = statement.kind()
                    && let Some(last) = export.items().last()
                {
                    let item = LastItem {
                        end: last.span().end,
                        is_rest: false,
                    };
                    check(cx.state.exports, item, cx);
                }
            });
        }
        if modes.functions != Mode::Ignore {
            on.funcs(Self::check_function);
            on.exprs([ExprTag::Call, ExprTag::New], Self::check_call);
        }
        modes
    }
}
