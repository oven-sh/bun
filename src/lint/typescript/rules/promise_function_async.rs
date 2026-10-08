use bun_lint::prelude::*;
use bun_lint::types::utils::{contains_all_types_by_name, is_type_flag_set};
use bun_lint::types::{Type, TypeFlags};
use bun_lint::utils::ts_utils::get_function_head_loc;
use smallvec::SmallVec;

/// Require any function or method that returns a Promise to be marked async.
pub struct PromiseFunctionAsync {
    allow_any: bool,
    all_allowed_promise_names: Vec<Vec<u8>>,
    check_arrow_functions: bool,
    check_function_declarations: bool,
    check_function_expressions: bool,
    check_method_declarations: bool,
}

const MISSING_ASYNC: Message =
    Message::new("missingAsync", "Functions that return promises must be async.");
const MISSING_ASYNC_HYBRID_RETURN: Message = Message::new(
    "missingAsyncHybridReturn",
    "Functions that return promises must be async. Consider adding an explicit return type annotation if the function is intended to return a union of promise and non-promise types.",
);

fn add_async<'a>(fixer: Fixer<'a>, node: Func<'a>) -> Option<Fix> {
    let file = fixer.file();
    // The `MethodDefinition`, or the `Property` with `method: true`.
    let (method, last_decorator, key_start) = match node.owner() {
        Node::Member(member) => {
            let key_start = match (member.key(), member.constructor_keyword()) {
                (Some(key), _) => key.inner_span(file).start,
                (None, keyword) => keyword?.start(),
            };
            let last_decorator = member.modifiers().iter().rfind(|it| it.decorator().is_some());
            (member.span(), last_decorator, key_start)
        }
        Node::Expr(value) if node.kind() == FnKind::Method => {
            let Node::Prop(property) = value.parent() else {
                return None;
            };
            (property.span(), None, property.key()?.inner_span(file).start)
        }
        _ => return Some(fixer.insert_before(node.estree_span(), "async ")),
    };

    // The token to put `async` before.
    let mut key_token = match last_decorator {
        Some(last_decorator) => file.token_after(last_decorator)?,
        None => file.first_token(method)?,
    };
    while (key_token.kind() == TokenKind::Keyword
        || key_token.kind() == TokenKind::Identifier && key_token.is("override"))
        && key_token.start() < key_start
    {
        key_token = file.token_after(key_token)?;
    }
    let insert_space = !file.is_space_between(file.token_before(key_token)?, key_token);
    Some(fixer.insert_before(key_token, if insert_space { " async " } else { "async " }))
}

impl PromiseFunctionAsync {
    fn check<'a>(&self, node: Func<'a>, cx: &mut Cx<'a, Self>) {
        if node.is_async() || !node.has_body() {
            return;
        }
        let is_checked = match node.kind() {
            FnKind::Arrow => self.check_arrow_functions,
            FnKind::Decl => self.check_function_declarations,
            FnKind::Expr => self.check_function_expressions,
            FnKind::Method | FnKind::Constructor => match node.owner() {
                // The type of a constructor has no call signatures.
                Node::Member(member) => {
                    self.check_method_declarations
                        && !member.is_constructor()
                        && !member.flags().contains(Flags::ABSTRACT)
                }
                // In an object literal it is a `FunctionExpression` in a `Property`.
                _ => self.check_function_expressions,
            },
            _ => false,
        };
        if is_checked {
            self.validate_node(node, cx);
        }
    }

    fn validate_node<'a>(&self, node: Func<'a>, cx: &mut Cx<'a, Self>) {
        let signatures = node.type_at_location().get_call_signatures();
        if signatures.is_empty() {
            return;
        }
        let return_types: SmallVec<[Type<'a>; 4]> =
            signatures.iter().map(|signature| signature.get_return_type()).collect();
        if return_types.iter().any(|ty| ty.is_unresolved()) {
            return;
        }

        if !self.allow_any
            && return_types.iter().any(|ty| is_type_flag_set(*ty, TypeFlags::ANY | TypeFlags::UNKNOWN))
        {
            // Without a fix: what is returned is unknown.
            cx.report(get_function_head_loc(node), MISSING_ASYNC);
            return;
        }

        let names = &self.all_allowed_promise_names;
        // Without an explicit return type, one part of the return type that is a Promise is enough.
        let match_any_instead = node.return_type().is_none();
        if !return_types.iter().all(|ty| contains_all_types_by_name(*ty, true, names, match_any_instead)) {
            return;
        }
        let is_hybrid_return_type = return_types.iter().any(|ty| {
            ty.is_union() && !ty.types().iter().all(|part| contains_all_types_by_name(part, true, names, false))
        });
        let message = match is_hybrid_return_type {
            true => MISSING_ASYNC_HYBRID_RETURN,
            false => MISSING_ASYNC,
        };
        cx.report(get_function_head_loc(node), message).fix(|fixer| add_async(fixer, node));
    }
}

impl Rule for PromiseFunctionAsync {
    const META: Meta = Meta::typescript("promise-function-async", Kind::Suggestion)
        .fixable(Fixable::Code)
        .requires_types();
    type State<'a> = ();

    fn new(options: &Options) -> Self {
        let options = options.object(0);
        let mut all_allowed_promise_names = vec![b"Promise".to_vec()];
        let allowed_promise_names = options.strings("allowedPromiseNames");
        all_allowed_promise_names.extend(allowed_promise_names.iter().map(|name| name.as_bytes().to_vec()));
        PromiseFunctionAsync {
            allow_any: options.bool_or("allowAny", true),
            all_allowed_promise_names,
            check_arrow_functions: options.bool_or("checkArrowFunctions", true),
            check_function_declarations: options.bool_or("checkFunctionDeclarations", true),
            check_function_expressions: options.bool_or("checkFunctionExpressions", true),
            check_method_declarations: options.bool_or("checkMethodDeclarations", true),
        }
    }

    fn register<'a>(&self, on: &mut Listeners<'a, Self>, _: &'a File<'a>) {
        on.funcs(Self::check);
    }
}
