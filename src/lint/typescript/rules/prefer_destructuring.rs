use bun_lint::prelude::*;
use bun_lint::types::utils::is_type_any_type;
use bun_lint::types::{Type, tsutils};
use bun_lint_eslint::rules::prefer_destructuring::{Config, PREFER_DESTRUCTURING};

/// Require destructuring from arrays and/or objects.
pub struct PreferDestructuring {
    base: Config,
    enforce_for_declaration_with_type_annotation: bool,
    /// `getNormalizedEnabledType(nodeType, 'object')`. It differs from what the base rule reads: here the options are merged
    /// into the defaults.
    object_in_variable_declarator: bool,
    object_in_assignment_expression: bool,
}

fn is_type_any_or_iterable_type(ty: Type) -> bool {
    if is_type_any_type(ty) {
        return true;
    }
    if !ty.is_union() {
        return tsutils::get_well_known_symbol_property_of_type(ty, "iterator").is_some();
    }
    ty.types().iter().all(is_type_any_or_iterable_type)
}

/// The `object` of `node`, if that is `object[0]`: `isArrayLiteralIntegerIndexAccess`.
fn object_of_integer_index_access(node: Expr<'_>) -> Option<Expr<'_>> {
    let ExprKind::Index { obj, index, chain: Chain::No } = node.kind() else {
        return None;
    };
    match index.kind() {
        ExprKind::Number(n) if n.is_finite() && n.fract() == 0.0 => Some(obj),
        _ => None,
    }
}

impl PreferDestructuring {
    /// Whether the base rule is to run. `is_object_enabled`: for the kind of node that `report_node` is.
    fn check_index_access<'a>(
        &self,
        right: Expr<'a>,
        report_node: Node<'a>,
        is_object_enabled: bool,
        cx: &Cx<'a, Self>,
    ) -> bool {
        let Some(object) = object_of_integer_index_access(right).filter(|it| it.tag() != ExprTag::Super) else {
            return true;
        };
        let object_type = object.ty();
        if object_type.is_unresolved() {
            return false;
        }
        if is_type_any_or_iterable_type(object_type) {
            return true;
        }
        if self.base.enforce_for_renamed_properties && is_object_enabled {
            cx.report(report_node, PREFER_DESTRUCTURING).data("type", "object");
        }
        false
    }

    fn check_variable_declarator<'a>(&self, node: VarDecl<'a>, cx: &mut Cx<'a, Self>) {
        let Some(init) = node.init().filter(|it| matches!(it.tag(), ExprTag::Dot | ExprTag::Index)) else {
            return;
        };
        let has_type_annotation = node.ty().is_some();
        if has_type_annotation && !self.enforce_for_declaration_with_type_annotation {
            return;
        }
        if self.check_index_access(init, node.into(), self.object_in_variable_declarator, cx) {
            self.base.check_variable_declarator(node, cx, !has_type_annotation);
        }
    }

    fn check_assignment_expression<'a>(&self, node: Expr<'a>, cx: &mut Cx<'a, Self>) {
        let ExprKind::Assign { op: None, value, .. } = node.kind() else {
            return;
        };
        if !matches!(value.tag(), ExprTag::Dot | ExprTag::Index) || utils::is_assignment_target(node) {
            return;
        }
        if self.check_index_access(value, node.into(), self.object_in_assignment_expression, cx) {
            self.base.check_assignment_expression(node, cx);
        }
    }
}

impl Rule for PreferDestructuring {
    const META: Meta = Meta::typescript("prefer-destructuring", Kind::Suggestion)
        .fixable(Fixable::Code)
        .requires_types()
        .extends_base_rule("prefer-destructuring");
    type State<'a> = ();

    fn new(options: &Options) -> Self {
        let enabled_types = options.object(0);
        let is_object_enabled = |node_type: &str| match enabled_types.has("object") || enabled_types.has("array") {
            true => enabled_types.bool_or("object", false),
            false => enabled_types.object(node_type).bool_or("object", true),
        };
        PreferDestructuring {
            base: Config::new(options),
            enforce_for_declaration_with_type_annotation: options
                .object(1)
                .bool_or("enforceForDeclarationWithTypeAnnotation", false),
            object_in_variable_declarator: is_object_enabled("VariableDeclarator"),
            object_in_assignment_expression: is_object_enabled("AssignmentExpression"),
        }
    }

    fn register<'a>(&self, on: &mut Listeners<'a, Self>, _: &'a File<'a>) {
        on.var_decls(Self::check_variable_declarator);
        on.exprs([ExprTag::Assign], Self::check_assignment_expression);
    }
}
