use bun_lint::prelude::*;

/// Require error handling in callbacks.
pub struct HandleCallbackErr {
    error_argument: ErrorArgument,
}

enum ErrorArgument {
    Name(Box<[u8]>),
    /// It starts with `^`. `None` if it is not a valid regular expression.
    Pattern(Option<Regex>),
}

const EXPECTED: Message = Message::new("expected", "Expected error to be handled.");

/// The first identifier that the parameters of `func` bind.
fn first_parameter(func: Func<'_>) -> Option<Pat<'_>> {
    let mut first = None;
    for param in func.params_with_this() {
        param.pat().for_each_binding(&mut |pat| {
            first.get_or_insert(pat);
        });
        if first.is_some() {
            break;
        }
    }
    first
}

impl HandleCallbackErr {
    fn matches_configured_error_name(&self, name: &[u8]) -> bool {
        match &self.error_argument {
            ErrorArgument::Name(expected) => **expected == *name,
            ErrorArgument::Pattern(pattern) => pattern.as_ref().is_some_and(|it| it.test(name)),
        }
    }

    fn check_for_error<'a>(&self, func: Func<'a>, cx: &mut Cx<'a, Self>) {
        if !func.has_body() || func.kind() == FnKind::StaticBlock {
            return;
        }
        if let Some(parameter) = first_parameter(func)
            && let Some(name) = parameter.as_ident()
            && self.matches_configured_error_name(name.bytes())
            && parameter.symbol().is_none_or(|it| it.references().next().is_none())
        {
            cx.report(func.estree_span(), EXPECTED);
        }
    }
}

impl Rule for HandleCallbackErr {
    const META: Meta = Meta::eslint("handle-callback-err", Kind::Suggestion).deprecated();
    type State<'a> = ();

    fn new(options: &Options) -> Self {
        let argument = options.str(0).filter(|it| !it.is_empty()).unwrap_or("err");
        HandleCallbackErr {
            error_argument: match argument.starts_with('^') {
                true => ErrorArgument::Pattern(Regex::new(argument, "u").ok()),
                false => ErrorArgument::Name(argument.as_bytes().into()),
            },
        }
    }

    fn register<'a>(&self, on: &mut Listeners<'a, Self>, _: &'a File<'a>) {
        on.funcs(Self::check_for_error);
    }
}
