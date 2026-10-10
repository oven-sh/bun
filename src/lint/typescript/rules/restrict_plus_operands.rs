use bun_lint::prelude::*;
use bun_lint::types::tsutils::{intersection_constituents, is_object_type, union_constituents};
use bun_lint::types::utils::{
    get_constrained_type_at_location, get_type_name, is_type_any_type, is_type_flag_set,
};
use bun_lint::types::{Type, TypeFlags};

/// Require both operands of addition to be the same type and be `bigint`, `number`, or `string`.
pub struct RestrictPlusOperands {
    allow_any: bool,
    allow_boolean: bool,
    allow_nullish: bool,
    allow_number_and_string: bool,
    allow_reg_exp: bool,
    skip_compound_assignments: bool,
    string_like: String,
}

const BIGINT_AND_NUMBER: Message = Message::new(
    "bigintAndNumber",
    "Numeric '+' operations must either be both bigints or both numbers. Got `{{left}}` + `{{right}}`.",
);
const INVALID: Message = Message::new(
    "invalid",
    "Invalid operand for a '+' operation. Operands must each be a number or {{stringLike}}. Got `{{type}}`.",
);
const MISMATCHED: Message = Message::new(
    "mismatched",
    "Operands of '+' operations must be a number or {{stringLike}}. Got `{{left}}` + `{{right}}`.",
);

fn get_type_constrained(node: Expr<'_>) -> Type<'_> {
    get_constrained_type_at_location(node).get_base_type_of_literal_type()
}

fn is_deeply_object_type(ty: Type) -> bool {
    match ty.is_intersection() {
        true => intersection_constituents(ty).iter().all(is_object_type),
        false => union_constituents(ty).iter().all(is_object_type),
    }
}

/// `getTypeName(typeChecker, type) === 'RegExp'`
fn is_named_reg_exp(ty: Type) -> bool {
    !ty.has_flags(TypeFlags::INTRINSIC | TypeFlags::STRING_LIKE) && get_type_name(ty) == b"RegExp"
}

impl RestrictPlusOperands {
    fn report_invalid<'a>(&self, cx: &Cx<'a, Self>, base_node: Expr<'a>, ty: Type<'a>) {
        // tsgolint points at the parentheses too.
        let place = if cx.language().is_oxlint { base_node.outer_span() } else { base_node.span() };
        cx.report(place, INVALID)
            .data("type", ty.to_text())
            .data("stringLike", self.string_like.clone());
    }

    /// Whether it had a complaint.
    fn check_operand<'a>(
        &self,
        cx: &Cx<'a, Self>,
        base_node: Expr<'a>,
        base_type: Type<'a>,
        other_type: Type<'a>,
    ) -> bool {
        if is_type_flag_set(base_type, TypeFlags::ES_SYMBOL_LIKE | TypeFlags::NEVER | TypeFlags::UNKNOWN)
            || (!self.allow_any && is_type_flag_set(base_type, TypeFlags::ANY))
            || (!self.allow_boolean && is_type_flag_set(base_type, TypeFlags::BOOLEAN_LIKE))
            || (!self.allow_nullish && is_type_flag_set(base_type, TypeFlags::NULL | TypeFlags::UNDEFINED))
        {
            self.report_invalid(cx, base_node, base_type);
            return true;
        }
        let mut had_individual_complaint = false;
        for sub_base_type in union_constituents(base_type) {
            if cx.has_reported_too_much() {
                return true;
            }
            let is_invalid = match is_named_reg_exp(sub_base_type) {
                true => !self.allow_reg_exp || other_type.has_flags(TypeFlags::NUMBER_LIKE),
                false => (!self.allow_any && is_type_any_type(sub_base_type)) || is_deeply_object_type(sub_base_type),
            };
            if is_invalid {
                // tsgolint reports an operand once, with the whole of its type.
                if cx.language().is_oxlint {
                    self.report_invalid(cx, base_node, base_type);
                    return true;
                }
                self.report_invalid(cx, base_node, sub_base_type);
                had_individual_complaint = true;
            }
        }
        had_individual_complaint
    }

    fn check_plus_operands<'a>(&self, node: Expr<'a>, left: Expr<'a>, right: Expr<'a>, cx: &Cx<'a, Self>) {
        let left_type = get_type_constrained(left);
        let right_type = get_type_constrained(right);
        if left_type == right_type
            && left_type.has_flags(TypeFlags::BIG_INT_LIKE | TypeFlags::NUMBER_LIKE | TypeFlags::STRING_LIKE)
        {
            return;
        }
        if left_type.is_unresolved() || right_type.is_unresolved() {
            return;
        }

        let left_had_complaint = self.check_operand(cx, left, left_type, right_type);
        let right_had_complaint = self.check_operand(cx, right, right_type, left_type);
        if left_had_complaint || right_had_complaint {
            return;
        }

        // oxlint points at the left side.
        let place = if cx.language().is_oxlint { left.outer_span() } else { node.span() };
        let labels = |labels: &mut Details| {
            labels.first(format!("Type: {}", bstr::BStr::new(&left_type.to_text())));
            labels.push(right.outer_span(), format!("Type: {}", bstr::BStr::new(&right_type.to_text())));
            labels.push(node, "");
        };
        for (base_type, other_type) in [(left_type, right_type), (right_type, left_type)] {
            if !self.allow_number_and_string
                && is_type_flag_set(base_type, TypeFlags::STRING_LIKE)
                && is_type_flag_set(other_type, TypeFlags::NUMBER_LIKE | TypeFlags::BIG_INT_LIKE)
            {
                cx.report(place, MISMATCHED)
                    .comments_apply_at(node.span())
                    .data("left", left_type.to_text())
                    .data("right", right_type.to_text())
                    .data("stringLike", self.string_like.clone())
                    .labels_with(labels);
                return;
            }
            if is_type_flag_set(base_type, TypeFlags::NUMBER_LIKE)
                && is_type_flag_set(other_type, TypeFlags::BIG_INT_LIKE)
            {
                cx.report(place, BIGINT_AND_NUMBER)
                    .comments_apply_at(node.span())
                    .data("left", left_type.to_text())
                    .data("right", right_type.to_text())
                    .labels_with(labels);
                return;
            }
        }
    }
}

impl Rule for RestrictPlusOperands {
    const META: Meta = Meta::typescript("restrict-plus-operands", Kind::Problem)
        .presets(Presets::RECOMMENDED_TYPE_CHECKED.union(Presets::STRICT_TYPE_CHECKED))
        .requires_types();
    const ON: On = On::new().enter(NodeTags::new().exprs(&[ExprTag::Binary, ExprTag::Assign]));
    no_state!();

    fn new(options: &Options) -> Self {
        let options = options.object(0);
        let allow_any = options.bool_or("allowAny", true);
        let allow_boolean = options.bool_or("allowBoolean", true);
        let allow_nullish = options.bool_or("allowNullish", true);
        let allow_reg_exp = options.bool_or("allowRegExp", true);
        let string_likes: Vec<&str> = [
            (allow_any, "`any`"),
            (allow_boolean, "`boolean`"),
            (allow_nullish, "`null`"),
            (allow_reg_exp, "`RegExp`"),
            (allow_nullish, "`undefined`"),
        ]
        .into_iter()
        .filter_map(|(is_allowed, name)| is_allowed.then_some(name))
        .collect();
        let string_like = match string_likes.as_slice() {
            [] => "string".to_owned(),
            [only] => format!("string, allowing a string + {only}"),
            all => format!("string, allowing a string + any of: {}", all.join(", ")),
        };
        RestrictPlusOperands {
            allow_any,
            allow_boolean,
            allow_nullish,
            allow_number_and_string: options.bool_or("allowNumberAndString", true),
            allow_reg_exp,
            skip_compound_assignments: options.bool_or("skipCompoundAssignments", false),
            string_like,
        }
    }

    fn narrow<'a>(&self, _: &'a File<'a>) -> On {
        let mut kinds = NodeTags::new().exprs(&[ExprTag::Binary]);
        if !self.skip_compound_assignments {
            kinds = kinds.exprs(&[ExprTag::Assign]);
        }
        On::new().enter(kinds)
    }

    // The outer one first, as upstream: a sum that is an operand can be reported twice at one place.
    fn enter<'a>(&self, node: Node<'a>, cx: &mut Cx<'a, Self>) {
        let Node::Expr(node) = node else {
            return;
        };
        match node.tag() {
            ExprTag::Binary => {
                if let ExprKind::Binary { op: BinOp::Add, left, right } = node.kind() {
                    self.check_plus_operands(node, left, right, cx);
                }
            }
            ExprTag::Assign => {
                if let ExprKind::Assign { op: Some(BinOp::Add), target, value } = node.kind() {
                    self.check_plus_operands(node, target, value, cx);
                }
            }
            _ => {}
        }
    }
}
