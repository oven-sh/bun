use bun_core::strings;
use bun_lint::prelude::*;
use bun_lint::types::Type;
use bun_lint::types::tsutils::union_constituents;
use bun_lint::types::utils::get_type_name;
use bun_lint::utils::eslint_utils::get_static_value;
use bun_lint::utils::ts_utils::{
    WrappingFixerParams, get_wrapping_fixer_for_chain_element, is_static_member_access_of_value,
};

/// Enforce `RegExp#exec` over `String#match` if no global flag is provided.
pub struct PreferRegexpExec;

const REG_EXP_EXEC_OVER_STRING_MATCH: Message =
    Message::new("regExpExecOverStringMatch", "Use the `RegExp#exec()` method instead.");

enum ArgumentType {
    Other,
    String,
    RegExp,
    Both,
}

fn is_string_type(ty: Type) -> bool {
    get_type_name(ty) == b"string"
}

fn collect_argument_types(ty: Type) -> ArgumentType {
    let (mut has_string, mut has_reg_exp) = (false, false);
    for part in union_constituents(ty) {
        match get_type_name(part).as_slice() {
            b"RegExp" => has_reg_exp = true,
            b"string" => has_string = true,
            _ => {}
        }
    }
    match (has_string, has_reg_exp) {
        (false, false) => ArgumentType::Other,
        (true, false) => ArgumentType::String,
        (false, true) => ArgumentType::RegExp,
        (true, true) => ArgumentType::Both,
    }
}

/// Whether the syntax proves that there is no `g` flag. If not, there may or may not be one.
fn definitely_does_not_contain_global_flag(node: Expr) -> bool {
    let (ExprKind::Call(call) | ExprKind::New(call)) = node.kind() else {
        return false;
    };
    if node.is_chain_root() || !call.callee().is_ident("RegExp") {
        return false;
    }
    let Some(flags) = call.args().get(1) else {
        return true;
    };
    get_static_value(flags, Some(node.file().scope()))
        .is_some_and(|value| !value.as_str().is_some_and(|flags| strings::contains_char(flags, b'g')))
}

impl PreferRegexpExec {
    fn check<'a>(&self, call_node: Expr<'a>, cx: &mut Cx<'a, Self>) {
        let ExprKind::Call(call) = call_node.kind() else {
            return;
        };
        let member_node = call.callee();
        let (object_node, property) = match member_node.kind() {
            ExprKind::Dot { obj, name, .. } => (obj, name.span()),
            ExprKind::Index { obj, index, .. } => (obj, index.span()),
            _ => return,
        };
        let Some(argument_node) = call.args().first().filter(|_| call.args().len() == 1) else {
            return;
        };
        // `(a?.match)(b)` calls a `ChainExpression`.
        if member_node.is_chain_root() || !is_static_member_access_of_value(member_node, &["match"]) {
            return;
        }
        if !is_string_type(object_node.ty()) {
            return;
        }

        // Regular expressions with the global flag are not reported.
        match get_static_value(argument_node, Some(cx.file().scope())) {
            None if !definitely_does_not_contain_global_flag(argument_node) => return,
            Some(value) if value.as_regex().is_some_and(|(_, flags)| strings::contains_char(flags, b'g')) => return,
            _ => {}
        }

        if let ExprKind::String(pattern) = argument_node.kind() {
            let Ok(reg_exp) = Regex::from_bytes(pattern.bytes(), b"") else {
                return;
            };
            cx.report(property, REG_EXP_EXEC_OVER_STRING_MATCH).fix(|fixer| {
                get_wrapping_fixer_for_chain_element(
                    fixer,
                    WrappingFixerParams {
                        node: call_node,
                        inner_nodes: &[object_node],
                        wrap: |code: &[&[u8]]| [&b"/"[..], reg_exp.source(), b"/.exec(", code[0], b")"].concat(),
                    },
                )
            });
            return;
        }

        let prefix: &[u8] = match collect_argument_types(argument_node.ty()) {
            ArgumentType::RegExp => b"",
            ArgumentType::String => b"RegExp(",
            ArgumentType::Other | ArgumentType::Both => return,
        };
        cx.report(property, REG_EXP_EXEC_OVER_STRING_MATCH).fix(|fixer| {
            get_wrapping_fixer_for_chain_element(
                fixer,
                WrappingFixerParams {
                    node: call_node,
                    inner_nodes: &[object_node, argument_node],
                    wrap: |code: &[&[u8]]| {
                        let suffix: &[u8] = if prefix.is_empty() { b"" } else { b")" };
                        [prefix, code[1], suffix, b".exec(", code[0], b")"].concat()
                    },
                },
            )
        });
    }
}

impl Rule for PreferRegexpExec {
    const META: Meta = Meta::typescript("prefer-regexp-exec", Kind::Suggestion)
        .fixable(Fixable::Code)
        .presets(Presets::STYLISTIC_TYPE_CHECKED)
        .requires_types();
    type State<'a> = ();

    fn new(_: &Options) -> Self {
        PreferRegexpExec
    }

    fn register<'a>(&self, on: &mut Listeners<'a, Self>, _: &'a File<'a>) {
        on.exprs([ExprTag::Call], Self::check);
    }
}
