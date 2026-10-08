use bun_lint::language::Parser;
use bun_lint::prelude::*;

/// Disallow use of `this` in contexts where the value of `this` is `undefined`.
pub struct NoInvalidThis {
    cap_is_constructor: bool,
}

const UNEXPECTED_THIS: Message = Message::new("unexpectedThis", "Unexpected 'this'.");

/// `Program.sourceType === "module"`
// TODO(api): replace by ast::File::is_module_program
fn is_module(file: &File<'_>) -> bool {
    match file.language().parser {
        // typescript-estree also says so of a script that has an `import` or an `export`.
        Parser::TypeScript => {
            file.language().scope_source_type() == SourceType::Module || file.has_module_syntax()
        }
        _ => file.is_module(),
    }
}

/// `accessor a = function () {}`
fn is_value_of_accessor(func: Func<'_>) -> bool {
    matches!(func.owner(), Node::Expr(value)
        if matches!(value.parent(), Node::Member(member)
            if member.flags().contains(Flags::ACCESSOR) && member.init() == Some(value)))
}

/// Whether the `this` that is `e` is something else than `undefined`.
fn is_valid(e: Expr<'_>, cap_is_constructor: bool, is_valid_in_keys_of_fields: bool) -> bool {
    let mut child = Node::Expr(e);
    for ancestor in child.ancestors() {
        match ancestor {
            Node::Func(func) if !func.is_arrow() && func.has_body() => {
                return is_value_of_accessor(func)
                    || !ast_utils::is_default_this_binding(func, cap_is_constructor)
                    || !func.scope().is_some_and(Scope::is_strict);
            }
            Node::Member(member) if member.kind() == MemberKind::Property => {
                let is_field = !member.is_signature() && !member.flags().contains(Flags::ABSTRACT);
                if member.init().map(Node::Expr) == Some(child) || (is_valid_in_keys_of_fields && is_field) {
                    return true;
                }
            }
            // At the top level of a script it is the global object.
            Node::File(file) => {
                return !(is_module(file) || (file.language().global_return && file.top_level_scope().is_strict()));
            }
            _ => {}
        }
        child = ancestor;
    }
    true
}

/// `is_valid_in_keys_of_fields`: typescript-eslint accepts `this` anywhere in a field of a class,
/// not only in its value.
pub fn check<'a, R: Rule>(
    e: Expr<'a>,
    cap_is_constructor: bool,
    is_valid_in_keys_of_fields: bool,
    cx: &Cx<'a, R>,
) {
    if !e.is_jsx_tag_name() && !is_valid(e, cap_is_constructor, is_valid_in_keys_of_fields) {
        cx.report(e, UNEXPECTED_THIS);
    }
}

impl Rule for NoInvalidThis {
    const META: Meta = Meta::eslint("no-invalid-this", Kind::Suggestion);
    type State<'a> = ();

    fn new(options: &Options) -> Self {
        NoInvalidThis {
            cap_is_constructor: options.object(0).bool_or("capIsConstructor", true),
        }
    }

    fn register<'a>(&self, on: &mut Listeners<'a, Self>, _: &'a File<'a>) {
        on.exprs([ExprTag::This], |rule, e, cx| check(e, rule.cap_is_constructor, false, cx));
    }
}
