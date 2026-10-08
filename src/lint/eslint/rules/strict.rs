use bun_lint::prelude::*;
use bun_lint::utils::ast_utils;

/// Require or disallow strict mode directives.
pub struct Strict {
    mode: Mode,
}

#[derive(Copy, Clone, PartialEq, Eq)]
pub enum Mode {
    Never,
    Global,
    Function,
    /// `Global` or `Function`, depending on the file.
    Safe,
    /// `ecmaFeatures.impliedStrict`
    Implied,
    /// The file is a module.
    Module,
}

const FUNCTION: Message = Message::new("function", "Use the function form of 'use strict'.");
const GLOBAL: Message = Message::new("global", "Use the global form of 'use strict'.");
const MULTIPLE: Message = Message::new("multiple", "Multiple 'use strict' directives.");
const NEVER: Message = Message::new("never", "Strict mode is not permitted.");
const UNNECESSARY: Message = Message::new("unnecessary", "Unnecessary 'use strict' directive.");
const MODULE: Message = Message::new("module", "'use strict' is unnecessary inside of modules.");
const IMPLIED: Message = Message::new(
    "implied",
    "'use strict' is unnecessary when implied strict mode is enabled.",
);
const UNNECESSARY_IN_CLASSES: Message = Message::new(
    "unnecessaryInClasses",
    "'use strict' is unnecessary inside of classes.",
);
const NON_SIMPLE_PARAMETER_LIST: Message = Message::new(
    "nonSimpleParameterList",
    "'use strict' directive inside a function with non-simple parameter list throws a syntax error since ES2016.",
);
const WRAP: Message = Message::new(
    "wrap",
    "Wrap {{name}} in a function with 'use strict' directive.",
);

impl Mode {
    /// What a directive is reported with that the mode does not allow.
    fn message(self) -> Message {
        match self {
            Mode::Never => NEVER,
            Mode::Global => GLOBAL,
            Mode::Function | Mode::Safe => FUNCTION,
            Mode::Implied => IMPLIED,
            Mode::Module => MODULE,
        }
    }

    /// ESLint's `shouldFix`
    fn should_fix(self) -> bool {
        matches!(self, Mode::Implied | Mode::Module)
    }
}

/// `Program.sourceType === "module"`. `@typescript-eslint/parser` overwrites what typescript-estree
/// says with the option it was given: an `import` or an `export` makes no module of a script.
fn is_module(file: &File<'_>) -> bool {
    file.language().scope_source_type() == SourceType::Module
}

fn is_use_strict(statement: Stmt<'_>) -> bool {
    matches!(statement.kind(), StmtKind::Expr(e) if e.as_string().is_some_and(|it| it.is("use strict")))
}

/// ESLint's `getUseStrictDirectives`
fn get_use_strict_directives<'a>(
    statements: Option<List<'a, Stmt<'a>>>,
) -> impl Iterator<Item = Stmt<'a>> {
    statements.into_iter().flatten().take_while(|it| is_use_strict(*it))
}

fn has_use_strict_directive(func: Func<'_>) -> bool {
    func.body_statements().and_then(List::first).is_some_and(is_use_strict)
}

/// ESLint's `isSimpleParameterList`: every parameter is an `Identifier`.
fn is_simple_parameter_list(func: Func<'_>) -> bool {
    func.params().iter().all(|param| {
        param.pat().tag() == PatTag::Ident
            && param.default().is_none()
            && !param.is_rest()
            && !param.is_parameter_property()
    })
}

/// What is around a function.
#[derive(Default)]
struct Surroundings {
    /// The body of a class.
    is_in_class: bool,
    is_in_function: bool,
    /// A function with a `'use strict'` directive.
    is_in_strict_function: bool,
}

impl Surroundings {
    fn of(func: Func<'_>) -> Surroundings {
        let mut around = Surroundings::default();
        let mut inner = Node::Func(func);
        for ancestor in inner.ancestors() {
            match ancestor {
                Node::Func(outer) if ast_utils::is_function_with_body(outer) => {
                    around.is_in_function = true;
                    around.is_in_strict_function |= has_use_strict_directive(outer);
                }
                Node::Class(_) if matches!(inner, Node::Member(_)) => around.is_in_class = true,
                _ => {}
            }
            inner = ancestor;
        }
        around
    }
}

fn report_directive<'a>(cx: &Cx<'a, Strict>, directive: Stmt<'a>, message: Message, fix: bool) {
    let report = cx.report(directive, message);
    if fix {
        report.fix(|fixer| fixer.remove(directive));
    }
}

impl Strict {
    fn check_program<'a>(&self, cx: &mut Cx<'a, Self>) {
        let mode = cx.state;
        let body = cx.file().body();
        let mut directives = get_use_strict_directives(Some(body));
        if mode != Mode::Global {
            directives.for_each(|it| report_directive(cx, it, mode.message(), mode.should_fix()));
        } else if directives.next().is_some() {
            directives.for_each(|it| report_directive(cx, it, MULTIPLE, true));
        } else if let (Some(first), Some(last)) = (body.first(), body.last()) {
            cx.report(Span::new(first.span().start, last.span().end), GLOBAL);
        }
    }

    fn check_function<'a>(&self, func: Func<'a>, cx: &mut Cx<'a, Self>) {
        if !ast_utils::is_function_with_body(func) {
            return;
        }
        let mode = cx.state;
        let mut directives = get_use_strict_directives(func.body_statements());
        let Some(first) = directives.next() else {
            if mode == Mode::Function {
                Self::check_function_without_directive(func, cx);
            }
            return;
        };
        if !is_simple_parameter_list(func) {
            cx.report(first, NON_SIMPLE_PARAMETER_LIST);
        } else if mode != Mode::Function {
            report_directive(cx, first, mode.message(), mode.should_fix());
            directives.for_each(|it| report_directive(cx, it, mode.message(), mode.should_fix()));
            return;
        } else {
            let around = Surroundings::of(func);
            if around.is_in_strict_function {
                report_directive(cx, first, UNNECESSARY, true);
            } else if around.is_in_class {
                report_directive(cx, first, UNNECESSARY_IN_CLASSES, true);
            }
        }
        directives.for_each(|it| report_directive(cx, it, MULTIPLE, true));
    }

    /// In the mode `Function`.
    fn check_function_without_directive<'a>(func: Func<'a>, cx: &Cx<'a, Self>) {
        // A static block is in a class.
        if func.enclosing().is_some_and(Func::has_body) {
            return;
        }
        let around = Surroundings::of(func);
        if around.is_in_function || around.is_in_class {
            return;
        }
        if is_simple_parameter_list(func) {
            cx.report(func.estree_span(), FUNCTION);
        } else {
            cx.report(func.estree_span(), WRAP)
                .data("name", ast_utils::get_function_name_with_kind(func));
        }
    }
}

impl Rule for Strict {
    const META: Meta = Meta::eslint("strict", Kind::Suggestion).fixable(Fixable::Code);
    /// The mode in this file. Never `Safe`.
    type State<'a> = Mode;

    fn new(options: &Options) -> Self {
        Strict {
            mode: match options.str(0) {
                Some("never") => Mode::Never,
                Some("global") => Mode::Global,
                Some("function") => Mode::Function,
                _ => Mode::Safe,
            },
        }
    }

    fn register<'a>(&self, on: &mut Listeners<'a, Self>, file: &'a File<'a>) -> Mode {
        on.funcs(Self::check_function);
        on.finish(Self::check_program);
        let language = file.language();
        match self.mode {
            _ if is_module(file) => Mode::Module,
            _ if language.implied_strict => Mode::Implied,
            Mode::Safe if language.global_return || language.source_type == SourceType::CommonJs => {
                Mode::Global
            }
            Mode::Safe => Mode::Function,
            mode => mode,
        }
    }
}
