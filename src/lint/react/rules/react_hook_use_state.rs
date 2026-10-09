use crate::react::is_react_function_call;
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;

/// Ensure destructuring and symmetric naming of useState hook value and setter variables.
pub struct HookUseState {
    allow_destructured_state: bool,
}

const REQUIRE_TO_DESTRUCT: Message = Message::new("", "useState call is not destructured into value + setter pair");
const FOLLOW_NAMING_CONVENTION: Message =
    Message::new("", "useState call does not follow the [thing, setThing] naming convention");

impl Rule for HookUseState {
    const META: Meta = Meta::oxlint(Plugin::React, "hook-use-state", Kind::Suggestion);
    type State<'a> = ();

    fn new(options: &Options) -> Self {
        HookUseState { allow_destructured_state: options.object(0).bool_or("allowDestructuredState", false) }
    }

    fn register<'a>(&self, on: &mut Listeners<'a, Self>, file: &'a File<'a>) {
        if !file.mentions("useState") {
            return;
        }
        on.exprs([ExprTag::Call], |rule, e, cx| {
            if !e.as_call().is_some_and(|call| is_react_function_call(call, "useState")) {
                return;
            }
            let var = match e.parent() {
                Node::VarDecl(var) if !e.is_parenthesized() && !e.is_chain_root() => var,
                Node::Stmt(statement)
                    if statement.tag() == StmtTag::Return && !e.is_parenthesized() && !e.is_chain_root() =>
                {
                    return;
                }
                _ => {
                    cx.report(e, REQUIRE_TO_DESTRUCT);
                    return;
                }
            };
            let array_pattern = var.pat();
            let PatKind::Array(elements) = array_pattern.kind() else {
                cx.report(var, REQUIRE_TO_DESTRUCT);
                return;
            };
            if elements.len() != 2 || elements.iter().any(PatElem::is_rest) {
                cx.report(array_pattern, REQUIRE_TO_DESTRUCT);
                return;
            }
            // A hole is fine.
            let (Some(value_node), Some(setter_node)) =
                (elements.get(0).and_then(PatElem::pat), elements.get(1).and_then(PatElem::pat))
            else {
                return;
            };
            let message = match (value_node.as_ident(), setter_node.as_ident()) {
                (_, None) => REQUIRE_TO_DESTRUCT,
                (None, Some(_)) if rule.allow_destructured_state => return,
                (None, Some(_)) => REQUIRE_TO_DESTRUCT,
                (Some(value), Some(setter)) if is_setter_of(setter.bytes(), value.bytes()) => return,
                (Some(_), Some(_)) => FOLLOW_NAMING_CONVENTION,
            };
            cx.report(array_pattern, message);
        });
    }
}

/// `setFooBar` or `setFOOBar` for `fooBar`.
fn is_setter_of(setter: &[u8], value: &[u8]) -> bool {
    let (lowercase_prefix, suffix) = value.split_at(value.iter().take_while(|it| it.is_ascii_lowercase()).count());
    let Some((prefix, rest)) = setter.strip_prefix(b"set").and_then(|it| it.split_at_checked(lowercase_prefix.len()))
    else {
        return false;
    };
    let is_capitalized = || match (prefix, lowercase_prefix) {
        ([first, others @ ..], [lowercase_first, lowercase_others @ ..]) => {
            *first == lowercase_first.to_ascii_uppercase() && others == lowercase_others
        }
        _ => false,
    };
    !lowercase_prefix.is_empty()
        && rest == suffix
        && (is_capitalized() || prefix == lowercase_prefix.to_ascii_uppercase())
}
