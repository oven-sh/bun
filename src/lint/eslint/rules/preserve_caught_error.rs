use bun_lint::prelude::*;
use bun_lint::utils::ancestor_memo::AncestorMemo;
use bun_lint_oxlint::ast_util::{is_global_reference, symbol_of};

/// Disallow losing originally caught error when re-throwing custom errors.
pub struct PreserveCaughtError {
    requires_catch_parameter: bool,
    /// The names of the additional error classes, each with the index of the options among the
    /// arguments of its constructor. Of two with the same name, the later one counts.
    error_class_names: Vec<(Box<[u8]>, usize)>,
}

const MISSING_CAUSE: Message = Message::new(
    "missingCause",
    "There is no `cause` attached to the symptom error being thrown.",
);
const INCORRECT_CAUSE: Message = Message::new(
    "incorrectCause",
    "The symptom error is being thrown with an incorrect `cause`.",
);
const INCLUDE_CAUSE: Message = Message::new(
    "includeCause",
    "Include the original caught error as the `cause` of the symptom error.",
);
const MISSING_CATCH_ERROR_PARAM: Message = Message::new(
    "missingCatchErrorParam",
    "The caught error is not accessible because the catch clause lacks the error parameter. Start referencing the caught error using the catch parameter.",
);
const PARTIALLY_LOST_ERROR: Message = Message::new(
    "partiallyLostError",
    "Re-throws cannot preserve the caught error as a part of it is being lost due to destructuring.",
);
const CAUGHT_ERROR_SHADOWED: Message = Message::new(
    "caughtErrorShadowed",
    "The caught error is being attached as `cause`, but is shadowed by a closer scoped redeclaration.",
);

const BUILT_IN_ERROR_TYPES: &[&str] = &[
    "Error",
    "EvalError",
    "RangeError",
    "ReferenceError",
    "SyntaxError",
    "TypeError",
    "URIError",
    "AggregateError",
];

/// The ones that oxlint 1.87 knows.
const OXLINT_ERROR_TYPES: &[&str] = &["Error", "TypeError", "AggregateError"];

/// What to pass for the arguments before the options.
const AGGREGATE_ERROR_PLACEHOLDERS: &[&str] = &["[]", "\"\""];
const ERROR_PLACEHOLDERS: &[&str] = &["\"\""];
const NO_PLACEHOLDERS: &[&str] = &[];

enum Cause<'a> {
    /// Too complicated to be analyzed and fixed.
    Unknown,
    Missing,
    Found {
        property: Prop<'a>,
        has_multiple_definitions: bool,
    },
}

/// ESLint's `getErrorCause`: the last `cause` counts. In oxlint's `has_cause_property` it is the first that is written
/// as a name, only a spread before it can have one, a spread among the arguments can be after the options too, and what
/// is not an object in braces has none.
fn get_error_cause<'a>(args: List<'a, Expr<'a>>, options_index: usize, is_oxlint: bool) -> Cause<'a> {
    let looked_at = if is_oxlint { usize::MAX } else { options_index + 1 };
    if args.iter().take(looked_at).any(|arg| arg.tag() == ExprTag::Spread) {
        return Cause::Unknown;
    }
    let Some(options) = args.get(options_index) else {
        return Cause::Missing;
    };
    let properties = match options.kind() {
        ExprKind::Object(properties) if !(is_oxlint && options.is_parenthesized()) => properties,
        _ if is_oxlint => return Cause::Missing,
        _ => return Cause::Unknown,
    };
    let (mut last, mut count) = (None, 0);
    for property in properties {
        if property.kind() == PropKind::Spread {
            return Cause::Unknown;
        }
        let is_cause = match is_oxlint {
            true => matches!(property.key().map(|key| key.kind()), Some(KeyKind::Ident(name)) if name.is("cause")),
            false => ast_utils::get_static_property_name(property).is_some_and(|name| *name == *b"cause"),
        };
        if is_cause {
            (last, count) = (Some(property), count + 1);
            if is_oxlint {
                break;
            }
        }
    }
    match last {
        Some(property) => Cause::Found { property, has_multiple_definitions: count > 1 },
        None => Cause::Missing,
    }
}

/// By a statement: the `try` statement in whose `catch` block it is, or `None` in a function in that
/// block.
type ParentCatches<'a> = AncestorMemo<'a, Option<Stmt<'a>>>;

/// ESLint's `findParentCatch`: the `try` statement in whose `catch` block `statement` is, outside of
/// any function in that block, and the parameter of the `catch`.
fn find_parent_catch<'a>(
    statement: Stmt<'a>,
    known: &mut ParentCatches<'a>,
) -> Option<(Stmt<'a>, Option<VarDecl<'a>>)> {
    // oxlint looks into arrow functions and static blocks.
    let is_oxlint = statement.file().language().is_oxlint;
    let parent = known.find(statement.into(), |child, ancestor| match ancestor {
        Node::Func(func) if is_oxlint && (func.is_arrow() || func.kind() == FnKind::StaticBlock) => None,
        Node::Func(_) => Some(None),
        Node::Stmt(parent) => matches!(
            parent.kind(),
            StmtKind::Try { handler: Some(handler), .. } if Node::Stmt(handler) == child
        )
        .then_some(Some(parent)),
        _ => None,
    });
    match parent??.kind() {
        StmtKind::Try { param, .. } => Some((parent??, param)),
        _ => None,
    }
}

/// ESLint's `findInsertionTokenAfterParens`: `first_token`, or the last of the closing parentheses
/// that follow it, up to `last_token`.
fn find_insertion_token_after_parens<'a>(first_token: Token<'a>, last_token: Token<'a>, file: &'a File<'a>) -> Token<'a> {
    let mut token = first_token;
    while let Some(next) = file.token_after(token)
        && next.end() <= last_token.end()
        && ast_utils::is_closing_paren_token(&next)
    {
        token = next;
    }
    token
}

/// ESLint's `addArgumentsToEmptyCall`. There may be no parentheses: `new Error`, `new (Error)`.
fn add_arguments_to_empty_call<'a>(fixer: Fixer<'a>, thrown: Expr<'a>, call: Call<'a>, arguments: &[u8]) -> Option<Fix> {
    let file = fixer.file();
    let call_closing_paren_token = file.last_token(thrown)?;
    let last_callee_token = file.last_token(call.callee())?;
    let paren_token = file
        .tokens_between(last_callee_token, call_closing_paren_token)
        .find(ast_utils::is_opening_paren_token);
    if let Some(paren_token) = paren_token {
        return Some(fixer.insert_after(paren_token, arguments));
    }
    let insertion_token = find_insertion_token_after_parens(last_callee_token, call_closing_paren_token, file);
    Some(fixer.insert_after(insertion_token, [&b"("[..], arguments, b")"].concat()))
}

/// ESLint's `appendArguments`: after the last argument and the parentheses around it.
fn append_arguments<'a>(fixer: Fixer<'a>, thrown: Expr<'a>, call: Call<'a>, arguments: &[u8]) -> Option<Fix> {
    let file = fixer.file();
    let last_argument_token = file.last_token(call.args().last()?)?;
    let last_token_before_arg_list_paren = file.tokens_in(thrown).nth_back(1)?;
    let insertion_token =
        find_insertion_token_after_parens(last_argument_token, last_token_before_arg_list_paren, file);
    Some(fixer.insert_after(insertion_token, arguments))
}

/// Adds `cause: caught` to the options of the error that `thrown`, which is `call`, constructs.
/// `placeholders`: what to pass for the arguments before the options that are missing. If there are
/// none, the signature is not known, and nothing is made up.
fn include_cause<'a>(
    fixer: Fixer<'a>,
    thrown: Expr<'a>,
    call: Call<'a>,
    options_index: usize,
    placeholders: &[&str],
    caught: Name<'a>,
) -> Option<Fix> {
    let args = call.args();
    if let Some(options) = args.get(options_index) {
        let ExprKind::Object(properties) = options.kind() else {
            return None;
        };
        return Some(match properties.last() {
            Some(last) => fixer.insert_after(last, [&b", cause: "[..], caught.bytes()].concat()),
            None => {
                let open_brace = Span::new(options.span().start, options.span().start + 1);
                fixer.insert_after(open_brace, [&b"cause: "[..], caught.bytes()].concat())
            }
        });
    }
    let count = args.len();
    if count < options_index && placeholders.is_empty() {
        return None;
    }
    let mut arguments = Vec::new();
    if count > 0 {
        arguments.extend_from_slice(b", ");
    }
    for placeholder in placeholders.get(count..).unwrap_or_default() {
        arguments.extend_from_slice(placeholder.as_bytes());
        arguments.extend_from_slice(b", ");
    }
    arguments.extend_from_slice(b"{ cause: ");
    arguments.extend_from_slice(caught.bytes());
    arguments.extend_from_slice(b" }");
    match count {
        0 => add_arguments_to_empty_call(fixer, thrown, call, &arguments),
        _ => append_arguments(fixer, thrown, call, &arguments),
    }
}

/// What ESLint suggests is a fix for oxlint 1.87, with its own text for `{}`, and none for `new Error` without
/// parentheses and for more arguments than it knows. `param`: the parameter of the `catch`, which is part of the fix as
/// it is, so that no other fix renames or removes it in the same pass.
fn include_cause_as_oxlint<'a>(
    fixer: Fixer<'a>,
    (thrown, call): (Expr<'a>, Call<'a>),
    is_aggregate_error: bool,
    (caught, param): (Name<'a>, Span),
) -> Option<[Fix; 2]> {
    let file = fixer.file();
    let args = call.args();
    // What it comes after, and what is written before and after `cause: caught`.
    let (place, before, after): (Span, &[u8], &[u8]) = match (args.len(), args.last()) {
        (0, _) => {
            let (after_callee, last) = (file.last_token(call.callee())?, file.last_token(thrown)?);
            let open = file.tokens_between(after_callee, last).find(ast_utils::is_opening_paren_token)?;
            (open.span(), if is_aggregate_error { b"[], \"\", { " } else { b"\"\", { " }, b" }")
        }
        (1, Some(last)) => (last.outer_span(), if is_aggregate_error { b", \"\", { " } else { b", { " }, b" }"),
        (2, Some(last)) if is_aggregate_error => (last.outer_span(), b", { ", b" }"),
        (2, Some(last)) if !last.is_parenthesized() => match last.kind() {
            ExprKind::Object(properties) => match properties.last() {
                Some(property) => (property.span(), b", ", b""),
                None => (Span::empty(last.span().end.saturating_sub(1)), b" ", b" "),
            },
            _ => return None,
        },
        _ => return None,
    };
    let text = [before, b"cause: ", caught.bytes(), after].concat();
    Some([fixer.replace(param, file.slice(param)), fixer.insert_after(place, text)])
}

impl PreserveCaughtError {
    fn check<'a>(&self, statement: Stmt<'a>, cx: &mut Cx<'a, Self>) {
        let StmtKind::Throw(thrown) = statement.kind() else {
            return;
        };
        let is_oxlint = cx.language().is_oxlint;
        // It does not look into parentheses.
        if is_oxlint && thrown.is_parenthesized() {
            return;
        }
        // In an optional chain it is a `ChainExpression` that is thrown or called.
        let call = match thrown.kind() {
            ExprKind::New(call) => call,
            ExprKind::Call(call) if call.chain() == Chain::No => call,
            _ => return,
        };
        let callee = call.callee();
        if is_oxlint && callee.is_parenthesized() {
            return;
        }
        let (class_name, can_be_built_in) = match callee.kind() {
            ExprKind::Ident(name) if is_oxlint => (name, name.is_any(OXLINT_ERROR_TYPES)),
            ExprKind::Ident(name) => (name, name.is_any(BUILT_IN_ERROR_TYPES)),
            ExprKind::Dot { name, chain: Chain::No, .. } if !name.bytes().starts_with(b"#") => (name.name(), false),
            _ => return,
        };
        let mut configured = self.error_class_names.iter().rev();
        // oxlint has no such option.
        let configured = configured.find(|it| *it.0 == *class_name.bytes() && !is_oxlint).map(|it| it.1);
        if !can_be_built_in && configured.is_none() {
            return;
        }
        let Some((try_statement, param)) = find_parent_catch(statement, &mut cx.state) else {
            return;
        };
        // For oxlint what only declares a type does not hide the class.
        let is_global = if is_oxlint { is_global_reference(callee) } else { ast_utils::is_global_reference(callee) };
        let (options_index, placeholders) =
            match (can_be_built_in && is_global, configured) {
                (true, _) if class_name.is("AggregateError") => (2, AGGREGATE_ERROR_PLACEHOLDERS),
                (true, _) => (1, ERROR_PLACEHOLDERS),
                (false, Some(options_index)) => (options_index, NO_PLACEHOLDERS),
                (false, None) => return,
            };

        let param_span = param.map_or_else(Span::default, |param| param.pat().span());
        let caught = match param.map(|param| param.pat().kind()) {
            Some(PatKind::Ident(name)) => name,
            // oxlint goes on as with a name, which nothing is the value of, and points at the statement.
            Some(_) if is_oxlint => {
                if !matches!(get_error_cause(call.args(), options_index, true), Cause::Unknown) {
                    cx.report(statement, PARTIALLY_LOST_ERROR);
                }
                return;
            }
            Some(_) => {
                if let Some(catch_clause) = try_statement.catch_clause_span() {
                    cx.report(catch_clause, PARTIALLY_LOST_ERROR);
                }
                return;
            }
            None => {
                // oxlint says it of the `catch`, whatever is thrown in it.
                if self.requires_catch_parameter && !is_oxlint {
                    cx.report(statement, MISSING_CATCH_ERROR_PARAM);
                }
                return;
            }
        };

        let (property, has_multiple_definitions) = match get_error_cause(call.args(), options_index, is_oxlint) {
            Cause::Unknown => return,
            Cause::Missing => {
                let report = cx.report(statement, MISSING_CAUSE);
                match cx.language().is_oxlint {
                    true => report.fix(|fixer| {
                        include_cause_as_oxlint(fixer, (thrown, call), options_index == 2, (caught, param_span))
                    }),
                    false => report.suggest(INCLUDE_CAUSE, |fixer| {
                        include_cause(fixer, thrown, call, options_index, placeholders, caught)
                    }),
                };
                return;
            }
            Cause::Found { property, has_multiple_definitions } => (property, has_multiple_definitions),
        };
        let Some(value) = property.value() else {
            return;
        };

        let is_plain = matches!(property.kind(), PropKind::Init | PropKind::Shorthand);
        // oxlint does not look into parentheses.
        if !(is_plain && value.as_ident() == Some(caught) && !(is_oxlint && value.is_parenthesized())) {
            let value_span = property.func().map_or_else(|| value.span(), Func::span_from_params);
            // oxlint points at the statement.
            let place = if cx.language().is_oxlint { statement.span() } else { value_span };
            let report = cx.report(place, INCORRECT_CAUSE);
            // With several definitions of `cause`, a suggestion could be confusing.
            let replace = |fixer: Fixer<'a>| match property.kind() {
                PropKind::Init => fixer.replace(value, caught),
                _ => fixer.replace(property, [&b"cause: "[..], caught.bytes()].concat()),
            };
            if cx.language().is_oxlint {
                // It only knows the options of `Error` and `TypeError`.
                if options_index == 1 && call.args().len() == 2 && !has_multiple_definitions {
                    report.fix(|fixer| [fixer.replace(param_span, fixer.file().slice(param_span)), replace(fixer)]);
                }
            } else if !has_multiple_definitions {
                report.suggest(INCLUDE_CAUSE, replace);
            }
            return;
        }

        // For oxlint what only declares a type hides nothing.
        if is_oxlint {
            if symbol_of(value) != param.and_then(|it| it.pat().symbol()) {
                cx.report(statement, CAUGHT_ERROR_SHADOWED);
            }
            return;
        }
        let mut scopes = Node::Stmt(statement).scope().chain();
        let declaring = scopes.find(|scope| scope.get_name(caught).is_some());
        if !declaring.is_some_and(|it| it.kind() == ScopeKind::Catch && it.node() == Node::Stmt(try_statement)) {
            cx.report(statement, CAUGHT_ERROR_SHADOWED);
        }
    }
}

impl Rule for PreserveCaughtError {
    const META: Meta = Meta::eslint("preserve-caught-error", Kind::Suggestion)
        .has_suggestions()
        .recommended();
    const ON: On = On::new().stmts(&[StmtTag::Throw, StmtTag::Try]);
    type State<'a> = ParentCatches<'a>;

    fn new(options: &Options) -> Self {
        let config = options.object(0);
        let error_class_name = |item: &Json| -> Option<(Box<[u8]>, usize)> {
            match item.as_str() {
                Some(name) => Some((name.into(), 1)),
                None => {
                    let item = Object::of(Some(item));
                    let argument_position = item.usize("argumentPosition")?;
                    Some((item.str("name")?.as_bytes().into(), argument_position.checked_sub(1)?))
                }
            }
        };
        PreserveCaughtError {
            requires_catch_parameter: config.bool_or("requireCatchParameter", false),
            error_class_names: config.array("errorClassNames").iter().filter_map(error_class_name).collect(),
        }
    }

    fn start<'a>(&self, _: &'a File<'a>) -> Option<ParentCatches<'a>> {
        Some(ParentCatches::default())
    }

    fn stmt<'a>(&self, statement: Stmt<'a>, cx: &mut Cx<'a, Self>) {
        match statement.tag() {
            StmtTag::Throw => self.check(statement, cx),
            StmtTag::Try => {
                if !(self.requires_catch_parameter && cx.language().is_oxlint) {
                    return;
                }
                if matches!(statement.kind(), StmtKind::Try { param: None, .. })
                    && let Some(catch_clause) = statement.catch_clause_span()
                {
                    cx.report(catch_clause, MISSING_CATCH_ERROR_PARAM);
                }
            }
            _ => {}
        }
    }
}
