use bun_core::strings;
use bun_lint::prelude::*;
use bun_lint::types::tsutils::{
    intersection_constituents, is_intrinsic_undefined_type, union_constituents,
};
use bun_lint::types::utils::{get_constrained_type_at_location, requires_quoting};
use bun_lint::types::{Type, TypeFlags, TypeFormatFlags};
use bun_lint::utils::eslint_utils::{is_closing_brace_token, is_opening_brace_token};
use rustc_hash::FxHashSet;
use smallvec::SmallVec;

/// Require switch-case statements to be exhaustive.
pub struct SwitchExhaustivenessCheck {
    allow_default_case_for_exhaustive_switch: bool,
    consider_default_exhaustive_for_unions: bool,
    /// `None`: `/^no default$/iu`
    default_case_comment_pattern: Option<Regex>,
    require_default_for_non_union: bool,
}

const ADD_MISSING_CASES: Message =
    Message::new("addMissingCases", "Add branches for missing cases.");
const DANGEROUS_DEFAULT_CASE: Message = Message::new(
    "dangerousDefaultCase",
    "The switch statement is exhaustive, so the default case is unnecessary.",
);
const SWITCH_IS_NOT_EXHAUSTIVE: Message = Message::new(
    "switchIsNotExhaustive",
    "Switch is not exhaustive. Cases not matched: {{missingBranches}}",
);

fn type_to_string(ty: Type) -> Vec<u8> {
    ty.to_text_with(
        None,
        TypeFormatFlags::ALLOW_UNIQUE_ES_SYMBOL_TYPE
            | TypeFormatFlags::USE_ALIAS_DEFINED_OUTSIDE_CURRENT_SCOPE
            | TypeFormatFlags::USE_FULLY_QUALIFIED_TYPE,
    )
}

fn is_type_literal_like_type(ty: Type) -> bool {
    ty.has_flags(
        TypeFlags::LITERAL | TypeFlags::UNDEFINED | TypeFlags::NULL | TypeFlags::UNIQUE_ES_SYMBOL,
    )
}

/// `"foo" | "bar"` has only literal types. `"foo" | number` and `"foo" | (string & { bar: 1 })` have
/// others, and a default case is never superfluous for them.
fn does_type_contain_non_literal_type(ty: Type) -> bool {
    union_constituents(ty).iter().any(|ty| {
        intersection_constituents(ty).iter().all(|sub_type| !is_type_literal_like_type(sub_type))
    })
}

/// `case ..: { throw .. }` for the type, which is printed as `printed`.
fn missing_case(missing_branch_type: Type, printed: &[u8], symbol_name: Option<&[u8]>) -> Vec<u8> {
    let missing_branch_name = missing_branch_type.get_symbol().map(|it| it.escaped_name());
    let mut case_test = match missing_branch_type.has_flags(TypeFlags::ES_SYMBOL_LIKE) {
        true => missing_branch_name.unwrap_or_default().to_vec(),
        false => printed.to_vec(),
    };
    if let Some(symbol_name) = symbol_name.filter(|it| !it.is_empty())
        && let Some(missing_branch_name) = missing_branch_name
        && requires_quoting(missing_branch_name)
    {
        case_test = symbol_name.to_vec();
        case_test.extend_from_slice(b"['");
        for &byte in missing_branch_name {
            match byte {
                b'\'' => case_test.extend_from_slice(b"\\'"),
                b'\n' => case_test.extend_from_slice(b"\\n"),
                b'\r' => case_test.extend_from_slice(b"\\r"),
                _ => case_test.push(byte),
            }
        }
        case_test.extend_from_slice(b"']");
    }

    let mut code = b"case ".to_vec();
    code.extend_from_slice(&case_test);
    code.extend_from_slice(b": { throw new Error('Not implemented yet: ");
    for &byte in &case_test {
        if matches!(byte, b'\\' | b'\'') {
            code.push(b'\\');
        }
        code.push(byte);
    }
    code.extend_from_slice(b" case') }");
    code
}

/// `default_case`: the range of the `default` clause, or of the comment that stands for one.
fn fix_switch<'a>(
    fixer: Fixer<'a>,
    node: Stmt<'a>,
    missing_cases: &[Vec<u8>],
    default_case: Option<Span>,
) -> Option<Fix> {
    let StmtKind::Switch { expr: discriminant, cases } = node.kind() else {
        return None;
    };
    let file = fixer.file();
    let last_case = cases.last();
    // Without cases, the indentation of the statement. The user is left to format it.
    let indented_as = match last_case {
        Some(last_case) => last_case.span().start,
        None => node.span().start,
    };
    let case_indent = vec![b' '; file.position(indented_as).column as usize];

    let mut code = Vec::new();
    if let Some(last_case) = last_case {
        if let Some(default_case) = default_case {
            for missing_case in missing_cases {
                code.extend_from_slice(missing_case);
                code.push(b'\n');
                code.extend_from_slice(&case_indent);
            }
            return Some(fixer.insert_before(default_case, code));
        }
        for missing_case in missing_cases {
            code.push(b'\n');
            code.extend_from_slice(&case_indent);
            code.extend_from_slice(missing_case);
        }
        return Some(fixer.insert_after(last_case, code));
    }

    let opening_brace = file.tokens_after(discriminant).find(is_opening_brace_token)?;
    let closing_brace = file.tokens_after(discriminant).find(is_closing_brace_token)?;
    code.push(b'{');
    for missing_case in missing_cases {
        code.push(b'\n');
        code.extend_from_slice(&case_indent);
        code.extend_from_slice(missing_case);
    }
    code.push(b'\n');
    code.extend_from_slice(&case_indent);
    code.push(b'}');
    Some(fixer.replace(Span::new(opening_brace.start(), closing_brace.end()), code))
}

impl SwitchExhaustivenessCheck {
    /// The comment after the last case that says that the default case is left out on purpose.
    fn get_comment_default_case<'a>(
        &self,
        cases: List<'a, Case<'a>>,
        file: &'a File<'a>,
    ) -> Option<Span> {
        let default_case_comment = file.comments_after(cases.last()?).next_back()?;
        let value = strings::trim_js_whitespace(default_case_comment.comment_value());
        let is_default_case = match &self.default_case_comment_pattern {
            Some(comment_reg_exp) => comment_reg_exp.test(value),
            None => value.eq_ignore_ascii_case(b"no default"),
        };
        is_default_case.then(|| default_case_comment.span())
    }

    fn check<'a>(&self, node: Stmt<'a>, cx: &mut Cx<'a, Self>) {
        let StmtKind::Switch { expr: discriminant, cases } = node.kind() else {
            return;
        };
        let default_clause = cases.iter().find(|switch_case| switch_case.is_default());
        if default_clause.is_some()
            && self.consider_default_exhaustive_for_unions
            && self.allow_default_case_for_exhaustive_switch
        {
            return;
        }

        let discriminant_type = get_constrained_type_at_location(discriminant);
        if discriminant_type.is_unresolved() {
            return;
        }
        let tests = cases.iter().filter_map(|switch_case| switch_case.test());
        let case_types: SmallVec<[Type<'a>; 16]> =
            tests.map(get_constrained_type_at_location).collect();
        // The "missing", the "optional" and the "undefined" type are different types, which all
        // have `TypeFlags::UNDEFINED`.
        let has_undefined_case = case_types.iter().any(|&it| is_intrinsic_undefined_type(it));
        let many_case_types: Option<FxHashSet<Type<'a>>> =
            case_types.spilled().then(|| case_types.iter().copied().collect());
        let is_case_type = |ty: Type<'a>| match &many_case_types {
            Some(case_types) => case_types.contains(&ty),
            None => case_types.contains(&ty),
        };

        let mut missing_literal_branch_types: SmallVec<[Type<'a>; 8]> = SmallVec::new();
        for union_part in union_constituents(discriminant_type) {
            for intersection_part in intersection_constituents(union_part) {
                if is_case_type(intersection_part)
                    || !is_type_literal_like_type(intersection_part)
                    || has_undefined_case && is_intrinsic_undefined_type(intersection_part)
                {
                    continue;
                }
                missing_literal_branch_types.push(intersection_part);
            }
        }
        if missing_literal_branch_types.is_empty()
            && self.allow_default_case_for_exhaustive_switch
            && !self.require_default_for_non_union
        {
            return;
        }

        let default_case = match default_clause {
            Some(default_clause) => Some(default_clause.span()),
            None => self.get_comment_default_case(cases, cx.file()),
        };

        // `checkSwitchExhaustive`
        if !missing_literal_branch_types.is_empty()
            && !(self.consider_default_exhaustive_for_unions && default_case.is_some())
        {
            let mut missing: Vec<(Type<'a>, Vec<u8>)> =
                missing_literal_branch_types.iter().map(|&it| (it, type_to_string(it))).collect();
            // tsgolint leaves them in the order of the union.
            if !cx.language().is_oxlint {
                utils::sort::sort_by(&mut missing, |a, b| strings::locale_compare(&a.1, &b.1));
            }

            let mut missing_branches = Vec::new();
            for (i, (missing_type, printed)) in missing.iter().enumerate() {
                if i > 0 {
                    missing_branches.extend_from_slice(b" | ");
                }
                if missing_type.has_flags(TypeFlags::ES_SYMBOL_LIKE) {
                    missing_branches.extend_from_slice(b"typeof ");
                    match missing_type.get_symbol() {
                        Some(symbol) => missing_branches.extend_from_slice(symbol.escaped_name()),
                        None => missing_branches.extend_from_slice(b"undefined"),
                    }
                } else {
                    missing_branches.extend_from_slice(printed);
                }
            }

            cx.report(discriminant, SWITCH_IS_NOT_EXHAUSTIVE)
                .data("missingBranches", missing_branches)
                .suggest(ADD_MISSING_CASES, |fixer| {
                    let symbol_name = discriminant_type.get_symbol().map(|it| it.escaped_name());
                    let missing_cases: Vec<Vec<u8>> = missing
                        .iter()
                        .map(|(missing_type, printed)| {
                            missing_case(*missing_type, printed, symbol_name)
                        })
                        .collect();
                    fix_switch(fixer, node, &missing_cases, default_case)
                });
        }

        // `checkSwitchUnnecessaryDefaultCase`
        if !self.allow_default_case_for_exhaustive_switch
            && missing_literal_branch_types.is_empty()
            && let Some(default_case) = default_case
            && !does_type_contain_non_literal_type(discriminant_type)
        {
            cx.report(default_case, DANGEROUS_DEFAULT_CASE);
        }

        // `checkSwitchNoUnionDefaultCase`
        if self.require_default_for_non_union
            && default_case.is_none()
            && does_type_contain_non_literal_type(discriminant_type)
        {
            cx.report(discriminant, SWITCH_IS_NOT_EXHAUSTIVE)
                .data("missingBranches", "default")
                .suggest(ADD_MISSING_CASES, |fixer| {
                    let default = b"default: { throw new Error('default case') }".to_vec();
                    fix_switch(fixer, node, &[default], default_case)
                });
        }
    }
}

impl Rule for SwitchExhaustivenessCheck {
    const META: Meta = Meta::typescript("switch-exhaustiveness-check", Kind::Suggestion)
        .has_suggestions()
        .requires_types();
    const ON: On = On::new().stmts(&[StmtTag::Switch]);
    no_state!();

    fn new(options: &Options) -> Self {
        let options = options.object(0);
        SwitchExhaustivenessCheck {
            allow_default_case_for_exhaustive_switch: options
                .bool_or("allowDefaultCaseForExhaustiveSwitch", true),
            consider_default_exhaustive_for_unions: options
                .bool_or("considerDefaultExhaustiveForUnions", false),
            default_case_comment_pattern: options.regex("defaultCaseCommentPattern", "u"),
            require_default_for_non_union: options.bool_or("requireDefaultForNonUnion", false),
        }
    }

    fn stmt<'a>(&self, node: Stmt<'a>, cx: &mut Cx<'a, Self>) {
        self.check(node, cx);
    }
}
