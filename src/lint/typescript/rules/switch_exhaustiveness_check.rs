use bun_core::strings;
use bun_lint::prelude::*;
use bun_lint::types::tsutils::{
    intersection_constituents, is_intrinsic_undefined_type, union_constituents,
};
use bun_lint::types::utils::{get_constrained_type_at_location, requires_quoting};
use bun_lint::types::{IdSet, Type, TypeFlags, TypeFormatFlags};
use bun_lint::utils::eslint_utils::{is_closing_brace_token, is_opening_brace_token};
use smallvec::SmallVec;

/// Require switch-case statements to be exhaustive.
pub struct SwitchExhaustivenessCheck {
    allow_default_case_for_exhaustive_switch: bool,
    consider_default_exhaustive_for_unions: bool,
    /// `None`: `/^no default$/iu`
    default_case_comment_pattern: Option<Regex>,
    /// The pattern without the `u` flag, if it is invalid with it: regexp2, which compiles it for
    /// tsgolint, takes identity escapes as Annex B does.
    default_case_comment_pattern_annex_b: Option<Regex>,
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

fn type_to_string(ty: Type, is_oxlint: bool) -> Vec<u8> {
    let mut flags = TypeFormatFlags::DEFAULT;
    // tsgolint prints with the flags that `typeToString` has by default.
    if !is_oxlint {
        flags |= TypeFormatFlags::USE_FULLY_QUALIFIED_TYPE;
    }
    ty.to_text_with(None, flags)
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
        let is_oxlint = file.language().is_oxlint;
        let mut comments = file.comments_after(cases.last()?);
        // tsgolint takes the first comment that matches, typescript-eslint tests the last one.
        let default_case_comment = match is_oxlint {
            true => comments.find(|&comment| self.is_default_case_comment(comment, is_oxlint)),
            false => comments
                .next_back()
                .filter(|&comment| self.is_default_case_comment(comment, is_oxlint)),
        }?;
        Some(default_case_comment.span())
    }

    fn is_default_case_comment(&self, comment: Token<'_>, is_oxlint: bool) -> bool {
        let value = comment.comment_value();
        // tsgolint trims what `strings.TrimSpace` of Go trims.
        let value = match is_oxlint {
            true => strings::trim_unicode_whitespace(value),
            false => strings::trim_js_whitespace(value),
        };
        let comment_reg_exp = match &self.default_case_comment_pattern {
            None if is_oxlint => &self.default_case_comment_pattern_annex_b,
            pattern => pattern,
        };
        match comment_reg_exp {
            Some(comment_reg_exp) => comment_reg_exp.test(value),
            None => value.eq_ignore_ascii_case(b"no default"),
        }
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
        let mut case_types: IdSet<Type<'a>> = IdSet::new();
        // The "missing", the "optional" and the "undefined" type are different types, which all
        // have `TypeFlags::UNDEFINED`.
        let mut has_undefined_case = false;
        for case_type in tests.map(get_constrained_type_at_location) {
            has_undefined_case |= is_intrinsic_undefined_type(case_type);
            case_types.insert(case_type);
        }

        let mut missing_literal_branch_types: SmallVec<[Type<'a>; 8]> = SmallVec::new();
        for union_part in union_constituents(discriminant_type) {
            for intersection_part in intersection_constituents(union_part) {
                if case_types.contains(intersection_part)
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

        let is_oxlint = cx.language().is_oxlint;
        // tsgolint's node is the parenthesized expression.
        let report_discriminant = || match is_oxlint {
            true => cx.report(discriminant.outer_span(), SWITCH_IS_NOT_EXHAUSTIVE),
            false => cx.report(discriminant, SWITCH_IS_NOT_EXHAUSTIVE),
        };

        // `checkSwitchExhaustive`
        if !missing_literal_branch_types.is_empty()
            && !(self.consider_default_exhaustive_for_unions && default_case.is_some())
        {
            let mut missing: Vec<(Type<'a>, Vec<u8>)> = missing_literal_branch_types
                .iter()
                .map(|&it| (it, type_to_string(it, is_oxlint)))
                .collect();
            // tsgolint leaves them in the order of the union.
            if !is_oxlint {
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

            report_discriminant()
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
            report_discriminant()
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
        let default_case_comment_pattern = options.regex("defaultCaseCommentPattern", "u");
        let default_case_comment_pattern_annex_b = match default_case_comment_pattern {
            Some(_) => None,
            None => options.regex("defaultCaseCommentPattern", ""),
        };
        SwitchExhaustivenessCheck {
            allow_default_case_for_exhaustive_switch: options
                .bool_or("allowDefaultCaseForExhaustiveSwitch", true),
            consider_default_exhaustive_for_unions: options
                .bool_or("considerDefaultExhaustiveForUnions", false),
            default_case_comment_pattern,
            default_case_comment_pattern_annex_b,
            require_default_for_non_union: options.bool_or("requireDefaultForNonUnion", false),
        }
    }

    fn stmt<'a>(&self, node: Stmt<'a>, cx: &mut Cx<'a, Self>) {
        self.check(node, cx);
    }
}
