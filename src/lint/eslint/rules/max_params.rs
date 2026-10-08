use bun_lint::prelude::*;

/// Enforce a maximum number of parameters in function definitions.
pub struct MaxParams(Config);

const EXCEED: Message = Message::new(
    "exceed",
    "{{name}} has too many parameters ({{count}}). Maximum allowed is {{max}}.",
);

enum CountThis {
    Never,
    ExceptVoid,
    Always,
}

/// The options, and the check. typescript-eslint's rule of the same name is the same rule.
pub struct Config {
    /// `None`: `{ "maximum": 0 }`, with which upstream compares to `undefined` and reports nothing.
    max: Option<usize>,
    count_this: CountThis,
    /// typescript-eslint hands the core rule a copy of the function without `this: void`.
    removes_void_this: bool,
}

impl Config {
    pub fn new(options: &Options) -> Config {
        let object = options.object(0);
        let max = match object.has("maximum") || object.has("max") {
            true => object.usize("maximum").filter(|it| *it != 0).or_else(|| object.usize("max")),
            false => Some(options.number(0).map_or(3, |it| it as usize)),
        };
        let count_this = match (object.str("countThis"), object.bool("countVoidThis")) {
            (Some("never"), _) => CountThis::Never,
            (Some("always"), _) | (None, Some(true)) => CountThis::Always,
            _ => CountThis::ExceptVoid,
        };
        Config {
            max,
            count_this,
            removes_void_this: false,
        }
    }

    /// For typescript-eslint's rule.
    pub fn new_for_typescript_eslint(options: &Options) -> Config {
        let config = Config::new(options);
        Config {
            removes_void_this: !matches!(config.count_this, CountThis::Always),
            ..config
        }
    }

    pub fn check<'a, R: Rule>(&self, func: Func<'a>, cx: &Cx<'a, R>) {
        let Some(max) = self.max else {
            return;
        };
        let is_checked = match func.kind() {
            FnKind::Decl | FnKind::Expr | FnKind::Arrow | FnKind::FunctionType => true,
            // Without a body it is a `TSEmptyBodyFunctionExpression` or a `TSMethodSignature`.
            FnKind::Method | FnKind::Getter | FnKind::Setter | FnKind::Constructor => func.has_body(),
            _ => false,
        };
        if !is_checked {
            return;
        }
        let counts_this = func.this_param().is_some_and(|this| match self.count_this {
            CountThis::Never => false,
            CountThis::ExceptVoid => !this.ty().is_some_and(|ty| ty.is_keyword(Keyword::Void)),
            CountThis::Always => true,
        });
        let count = func.params().len() + usize::from(counts_this);
        if count > max {
            let name = ast_utils::get_function_name_with_kind(func);
            let mut head = ast_utils::get_function_head_loc(func);
            // In the copy, the parameter that is left looks like the one of `a => {}`.
            if self.removes_void_this
                && func.is_arrow()
                && func.arrow_span() != Some(head)
                && func.params().len() == 1
                && func.this_param().is_some_and(|this| this.ty().is_some_and(|ty| ty.is_keyword(Keyword::Void)))
                && let Some(only) = func.params().first()
            {
                head.end = only.span().start;
            }
            cx.report(head, EXCEED)
                .data("name", text::upper_case_first(&name).into_owned())
                .data("count", count)
                .data("max", max);
        }
    }
}

impl Rule for MaxParams {
    const META: Meta = Meta::eslint("max-params", Kind::Suggestion);
    type State<'a> = ();

    fn new(options: &Options) -> Self {
        MaxParams(Config::new(options))
    }

    fn register<'a>(&self, on: &mut Listeners<'a, Self>, _: &'a File<'a>) {
        on.funcs(|rule, func, cx| rule.0.check(func, cx));
    }
}
