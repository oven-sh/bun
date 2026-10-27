use bun_lint::prelude::*;
use bun_lint::types::IdMap;
use bun_lint::utils::ancestor_memo::AncestorMemo;

/// Disallow use of `this` in contexts where the value of `this` is `undefined`.
pub struct NoInvalidThis {
    cap_is_constructor: bool,
}

const UNEXPECTED_THIS: Message = Message::new("unexpectedThis", "Unexpected 'this'.");

/// `Program.sourceType === "module"`. `@typescript-eslint/parser` overwrites typescript-estree's value with the option
/// it was given, so an `import` or `export` doesn't turn a script into a module.
fn is_module(file: &File<'_>) -> bool {
    file.language().scope_source_type() == SourceType::Module
}

/// `accessor a = function () {}`
fn is_value_of_accessor(func: Func<'_>) -> bool {
    matches!(func.owner(), Node::Expr(value)
        if matches!(value.parent(), Node::Member(member)
            if member.flags().contains(Flags::ACCESSOR) && member.init() == Some(value)))
}

/// Cached facts about `this` in a file.
#[derive(Default)]
pub struct Known<'a> {
    /// For a node, whether a `this` there is something other than `undefined`.
    at: AncestorMemo<'a, bool>,
    /// Same for a `this` directly in a function that isn't a method.
    in_function: IdMap<Func<'a>, bool>,
    bindings: ast_utils::ThisBindingMemo<'a>,
}

/// True if `e`, a `this`, is something other than `undefined`.
fn is_valid<'a>(
    e: Expr<'a>,
    cap_is_constructor: bool,
    is_valid_in_keys_of_fields: bool,
    known: &mut Known<'a>,
) -> bool {
    let Known { at, in_function, bindings } = known;
    let is_valid = at.find(Node::Expr(e), |child, ancestor| match ancestor {
        Node::Func(func) if !func.is_arrow() && func.has_body() => Some(
            // A method is never called with the default `this`.
            matches!(func.owner(), Node::Member(_))
                || *in_function.get_or_insert_with(func, || {
                    is_value_of_accessor(func)
                        || !ast_utils::is_default_this_binding_with(func, cap_is_constructor, bindings)
                        || !func.scope().is_some_and(Scope::is_strict)
                }),
        ),
        Node::Member(member) if member.kind() == MemberKind::Property => {
            let is_field = !member.is_signature() && !member.flags().contains(Flags::ABSTRACT);
            (member.init().map(Node::Expr) == Some(child) || (is_valid_in_keys_of_fields && is_field)).then_some(true)
        }
        // At the top level of a script, `this` is the global object.
        Node::File(file) => {
            Some(!(is_module(file) || (file.language().global_return && file.top_level_scope().is_strict())))
        }
        _ => None,
    });
    is_valid.unwrap_or(true)
}

/// With `is_valid_in_keys_of_fields`, `this` is accepted anywhere in a class field, not only in its value, like in
/// typescript-eslint.
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
    const ON: On = On::new().exprs(&[ExprTag::This]);
    type State<'a> = Known<'a>;

    fn new(options: &Options) -> Self {
        NoInvalidThis {
            cap_is_constructor: options.object(0).bool_or("capIsConstructor", true),
        }
    }

    fn start<'a>(&self, _: &'a File<'a>) -> Option<Known<'a>> {
        Some(Known::default())
    }

    fn expr<'a>(&self, e: Expr<'a>, cx: &mut Cx<'a, Self>) {
        check(e, self.cap_is_constructor, false, cx);
    }
}
