use bun_lint::prelude::*;
use bun_lint::utils::ancestor_memo::AncestorMemo;
use rustc_hash::FxHashMap;

/// Disallow use of `this` in contexts where the value of `this` is `undefined`.
pub struct NoInvalidThis {
    cap_is_constructor: bool,
}

const UNEXPECTED_THIS: Message = Message::new("unexpectedThis", "Unexpected 'this'.");

/// `Program.sourceType === "module"`. `@typescript-eslint/parser` overwrites what typescript-estree
/// says with the option it was given: an `import` or an `export` makes no module of a script.
fn is_module(file: &File<'_>) -> bool {
    file.language().scope_source_type() == SourceType::Module
}

/// `accessor a = function () {}`
fn is_value_of_accessor(func: Func<'_>) -> bool {
    matches!(func.owner(), Node::Expr(value)
        if matches!(value.parent(), Node::Member(member)
            if member.flags().contains(Flags::ACCESSOR) && member.init() == Some(value)))
}

/// What is known about the `this` of a file.
#[derive(Default)]
pub struct Known<'a> {
    /// Whether a `this` at a node is something else than `undefined`.
    at: AncestorMemo<'a, bool>,
    /// The same directly in a function that is not a method.
    in_function: FxHashMap<Func<'a>, bool>,
}

/// Whether the `this` that is `e` is something else than `undefined`.
fn is_valid<'a>(
    e: Expr<'a>,
    cap_is_constructor: bool,
    is_valid_in_keys_of_fields: bool,
    known: &mut Known<'a>,
) -> bool {
    let Known { at, in_function } = known;
    let is_valid = at.find(Node::Expr(e), |child, ancestor| match ancestor {
        Node::Func(func) if !func.is_arrow() && func.has_body() => Some(
            // A method is never called with the default `this`.
            matches!(func.owner(), Node::Member(_))
                || *in_function.entry(func).or_insert_with(|| {
                    is_value_of_accessor(func)
                        || !ast_utils::is_default_this_binding(func, cap_is_constructor)
                        || !func.scope().is_some_and(Scope::is_strict)
                }),
        ),
        Node::Member(member) if member.kind() == MemberKind::Property => {
            let is_field = !member.is_signature() && !member.flags().contains(Flags::ABSTRACT);
            (member.init().map(Node::Expr) == Some(child) || (is_valid_in_keys_of_fields && is_field)).then_some(true)
        }
        // At the top level of a script it is the global object.
        Node::File(file) => {
            Some(!(is_module(file) || (file.language().global_return && file.top_level_scope().is_strict())))
        }
        _ => None,
    });
    is_valid.unwrap_or(true)
}

/// `is_valid_in_keys_of_fields`: typescript-eslint accepts `this` anywhere in a field of a class,
/// not only in its value.
pub fn check<'a, R: Rule<State<'a> = Known<'a>>>(
    e: Expr<'a>,
    cap_is_constructor: bool,
    is_valid_in_keys_of_fields: bool,
    cx: &mut Cx<'a, R>,
) {
    if !e.is_jsx_tag_name() && !is_valid(e, cap_is_constructor, is_valid_in_keys_of_fields, &mut cx.state) {
        cx.report(e, UNEXPECTED_THIS);
    }
}

impl Rule for NoInvalidThis {
    const META: Meta = Meta::eslint("no-invalid-this", Kind::Suggestion);
    type State<'a> = Known<'a>;

    fn new(options: &Options) -> Self {
        NoInvalidThis {
            cap_is_constructor: options.object(0).bool_or("capIsConstructor", true),
        }
    }

    fn register<'a>(&self, on: &mut Listeners<'a, Self>, _: &'a File<'a>) -> Known<'a> {
        on.exprs([ExprTag::This], |rule, e, cx| check(e, rule.cap_is_constructor, false, cx));
        Known::default()
    }
}
