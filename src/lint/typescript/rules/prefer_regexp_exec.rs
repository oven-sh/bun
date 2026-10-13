use bun_core::strings;
use bun_lint::prelude::*;
use bun_lint::types::tsutils::union_constituents;
use bun_lint::types::utils::get_type_name;
use bun_lint::types::Type;
use bun_lint::utils::eslint_utils::{find_variable_of, get_static_value};
use bun_lint::utils::ts_utils::{
    WrappingFixerParams, get_wrapping_fixer_for_chain_element, is_static_member_access_of_value,
};
use rustc_hash::FxHashMap;

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

/// tsgolint's `staticArgumentValue`.
#[derive(Copy, Clone)]
enum StaticArgumentValue<'a> {
    Unknown,
    String,
    RegExp { flags: &'a [u8] },
    Other,
}

/// tsgolint's `isStringLiteral`: the value of a string literal that is not in parentheses.
fn as_string_literal(node: Expr<'_>) -> Option<Name<'_>> {
    match node.kind() {
        ExprKind::String(value) if !node.is_parenthesized() => Some(value),
        _ => None,
    }
}

/// tsgolint's `isRegExpConstructorCall`: `RegExp(..)`, `new RegExp(..)`, also `RegExp?.(..)`.
fn as_reg_exp_constructor_call(node: Expr<'_>) -> Option<Call<'_>> {
    let (ExprKind::Call(call) | ExprKind::New(call)) = node.kind() else {
        return None;
    };
    let callee = call.callee();
    (callee.is_ident("RegExp") && !callee.is_parenthesized()).then_some(call)
}

/// The initializer of the variable, if a `const` declares it.
fn initializer_of_const<'a>(variable: Symbol<'a>) -> Option<Expr<'a>> {
    let pat = variable.declarations().find_map(|it| match it {
        Declaration::Var(pat) => Some(pat),
        _ => None,
    })?;
    match pat.parent() {
        Node::VarDecl(declaration) if matches!(declaration.var_kind(), VarKind::Const | VarKind::AwaitUsing) => {
            declaration.init()
        }
        _ => None,
    }
}

/// The value of a call of the `RegExp` constructor, which tsgolint knows if the arguments are string literals.
fn get_static_reg_exp_constructor_call_value(node: Expr<'_>) -> StaticArgumentValue<'_> {
    let Some(call) = as_reg_exp_constructor_call(node) else {
        return StaticArgumentValue::Unknown;
    };
    let args = call.args();
    let (pattern_node, flags_node) = (args.first(), args.get(1));
    let (pattern, flags) = (pattern_node.and_then(as_string_literal), flags_node.and_then(as_string_literal));
    if pattern_node.is_some() != pattern.is_some() || flags_node.is_some() != flags.is_some() {
        return StaticArgumentValue::Unknown;
    }
    if pattern.is_some_and(|it| Regex::from_bytes(it.bytes(), b"").is_err()) {
        return StaticArgumentValue::Unknown;
    }
    StaticArgumentValue::RegExp { flags: flags.map_or(&b""[..], |it| it.bytes()) }
}

/// tsgolint's `getStaticArgumentValue`.
fn get_static_argument_value(mut node: Expr<'_>) -> StaticArgumentValue<'_> {
    let mut visited = Vec::new();
    loop {
        node = match node.kind() {
            ExprKind::String(_) => return StaticArgumentValue::String,
            ExprKind::Regex(literal) => return StaticArgumentValue::RegExp { flags: literal.flags() },
            ExprKind::Number(_) | ExprKind::True | ExprKind::False | ExprKind::Null => {
                return StaticArgumentValue::Other;
            }
            ExprKind::Template(template) if template.quasi_count() == 1 => return StaticArgumentValue::Other,
            ExprKind::As { expr, .. } | ExprKind::AsConst(expr) | ExprKind::NonNull(expr) => expr,
            ExprKind::Ident(_) => {
                let variable = find_variable_of(node).filter(|it| !visited.contains(it));
                let Some(initializer) = variable.and_then(initializer_of_const) else {
                    return StaticArgumentValue::Unknown;
                };
                visited.extend(variable);
                initializer
            }
            _ => return get_static_reg_exp_constructor_call_value(node),
        };
    }
}

/// Whether the syntax proves that there is no `g` flag. If not, there may or may not be one.
fn definitely_does_not_contain_global_flag(node: Expr) -> bool {
    if node.file().language().is_oxlint {
        // tsgolint looks at the syntax of the flags only.
        let Some(call) = as_reg_exp_constructor_call(node) else {
            return false;
        };
        return match call.args().get(1).map(|flags| flags.kind()) {
            None => true,
            Some(ExprKind::String(flags)) => !strings::contains_char(flags.bytes(), b'g'),
            Some(ExprKind::Ident(name)) => name.is("undefined"),
            Some(ExprKind::Unary { op: UnOp::Void, .. }) => true,
            Some(_) => false,
        };
    }
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

impl Rule for PreferRegexpExec {
    const META: Meta = Meta::typescript("prefer-regexp-exec", Kind::Suggestion)
        .fixable(Fixable::Code)
        .presets(Presets::STYLISTIC_TYPE_CHECKED)
        .requires_types();
    const ON: On = On::new().exprs(&[ExprTag::Call]);
    /// Whether the value of a variable can have the global flag. All its references are looked at to find its value.
    type State<'a> = FxHashMap<Symbol<'a>, bool>;

    fn new(_: &Options) -> Self {
        PreferRegexpExec
    }

    fn start<'a>(&self, _: &'a File<'a>) -> Option<FxHashMap<Symbol<'a>, bool>> {
        Some(FxHashMap::default())
    }

    fn expr<'a>(&self, call_node: Expr<'a>, cx: &mut Cx<'a, Self>) {
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
        let is_oxlint = cx.language().is_oxlint;
        let is_match = match is_oxlint {
            // For tsgolint a callee in parentheses is no member access.
            true => {
                !member_node.is_parenthesized()
                    && matches!(cx.file().type_checker().get_accessed_property_name(member_node), Some(b"match"))
            }
            // `(a?.match)(b)` calls a `ChainExpression`.
            false => !member_node.is_chain_root() && is_static_member_access_of_value(member_node, &["match"]),
        };
        if !is_match {
            return;
        }
        if !is_string_type(object_node.ty()) {
            return;
        }

        // Regular expressions with the global flag are not reported.
        let is_static_value_unknown = if is_oxlint {
            match get_static_argument_value(argument_node) {
                StaticArgumentValue::RegExp { flags } if strings::contains_char(flags, b'g') => return,
                value => matches!(value, StaticArgumentValue::Unknown),
            }
        } else {
            let scope = cx.file().scope();
            let can_have_global_flag = || match get_static_value(argument_node, Some(scope)) {
                None => !definitely_does_not_contain_global_flag(argument_node),
                Some(value) => value.as_regex().is_some_and(|(_, flags)| strings::contains_char(flags, b'g')),
            };
            let can_have_global_flag = match find_variable_of(argument_node) {
                Some(variable) => *cx.state.entry(variable).or_insert_with(can_have_global_flag),
                None => can_have_global_flag(),
            };
            if can_have_global_flag {
                return;
            }
            false
        };

        if let ExprKind::String(pattern) = argument_node.kind()
            // For tsgolint a string literal in parentheses is not one.
            && !(is_oxlint && argument_node.is_parenthesized())
        {
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

        let argument_types = collect_argument_types(argument_node.ty());
        // tsgolint gives up on a value that it does not know only if its type has `RegExp`.
        if is_static_value_unknown
            && matches!(argument_types, ArgumentType::RegExp | ArgumentType::Both)
            && !definitely_does_not_contain_global_flag(argument_node)
        {
            return;
        }
        let prefix: &[u8] = match argument_types {
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
