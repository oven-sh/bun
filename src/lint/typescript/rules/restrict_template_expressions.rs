use bun_lint::prelude::*;
use bun_lint::types::utils::{
    TypeOrValueSpecifier, get_constrained_type_at_location, get_type_name, is_global_reg_exp_type,
    matches_type_or_base_type, parse_type_or_value_specifiers, type_matches_some_specifier,
};
use bun_lint::types::{IdMap, IdSet, Type, TypeFlags};

/// Enforce template literal expressions to be of `string` type.
pub struct RestrictTemplateExpressions {
    allow: Vec<TypeOrValueSpecifier>,
    /// `string`, and what `allowAny`, `allowBoolean`, `allowNullish`, `allowNumber` and `allowNever`
    /// add to it.
    allowed_flags: TypeFlags,
    allow_array: bool,
    allow_reg_exp: bool,
}

const INVALID_TYPE: Message =
    Message::new("invalidType", "Invalid type \"{{type}}\" of template literal expression.");

impl RestrictTemplateExpressions {
    /// `on_the_way`: the arrays that `inner_type` is in. `type A = A[]` has no end.
    fn recursively_check_type<'a>(&self, inner_type: Type<'a>, on_the_way: &mut IdSet<Type<'a>>) -> bool {
        if inner_type.is_unresolved() || !bun_core::StackCheck::init().is_safe_to_recurse() {
            return true;
        }
        if inner_type.is_union() {
            return inner_type.types().iter().all(|it| self.recursively_check_type(it, on_the_way));
        }
        if inner_type.is_intersection() {
            return inner_type.types().iter().any(|it| self.recursively_check_type(it, on_the_way));
        }
        inner_type.has_flags(self.allowed_flags)
            || !self.allow.is_empty()
                && matches_type_or_base_type(|it| type_matches_some_specifier(it, &self.allow), inner_type)
            || self.allow_array
                && inner_type.is_array_or_tuple_type()
                && inner_type.get_number_index_type().is_some_and(|it| {
                    if !on_the_way.insert(inner_type) {
                        return true;
                    }
                    let is_allowed = self.recursively_check_type(it, on_the_way);
                    on_the_way.remove(inner_type);
                    is_allowed
                })
            || self.allow_reg_exp
                && match inner_type.file().language().is_oxlint {
                    true => is_global_reg_exp_type(inner_type),
                    false => get_type_name(inner_type) == b"RegExp",
                }
    }
}

impl Rule for RestrictTemplateExpressions {
    const META: Meta = Meta::typescript("restrict-template-expressions", Kind::Problem)
        .presets(Presets::RECOMMENDED_TYPE_CHECKED.union(Presets::STRICT_TYPE_CHECKED))
        .requires_types();
    const ON: On = On::new().exprs(&[ExprTag::Template]);
    /// Whether a type is allowed. Each constituent of a union is looked at, and many expressions have the same type.
    type State<'a> = IdMap<Type<'a>, bool>;

    fn new(options: &Options) -> Self {
        let options = options.object(0);
        let mut allowed_flags = TypeFlags::STRING_LIKE;
        for (option, default, flags) in [
            ("allowAny", true, TypeFlags::ANY),
            ("allowBoolean", true, TypeFlags::BOOLEAN_LIKE),
            ("allowNullish", true, TypeFlags::NULL.union(TypeFlags::UNDEFINED)),
            ("allowNumber", true, TypeFlags::NUMBER_LIKE.union(TypeFlags::BIG_INT_LIKE)),
            ("allowNever", false, TypeFlags::NEVER),
        ] {
            if options.bool_or(option, default) {
                allowed_flags |= flags;
            }
        }
        RestrictTemplateExpressions {
            allow: match options.has("allow") {
                true => parse_type_or_value_specifiers(options.array("allow")),
                false => vec![TypeOrValueSpecifier::Lib {
                    name: vec![b"Error".to_vec(), b"URL".to_vec(), b"URLSearchParams".to_vec()],
                }],
            },
            allowed_flags,
            allow_array: options.bool_or("allowArray", false),
            allow_reg_exp: options.bool_or("allowRegExp", true),
        }
    }

    fn start<'a>(&self, _: &'a File<'a>) -> Option<IdMap<Type<'a>, bool>> {
        Some(IdMap::new())
    }

    fn expr<'a>(&self, node: Expr<'a>, cx: &mut Cx<'a, Self>) {
        let ExprKind::Template(template) = node.kind() else {
            return;
        };
        if template.exprs().is_empty()
            || matches!(node.parent(), Node::Expr(parent) if parent.tag() == ExprTag::TaggedTemplate)
        {
            return;
        }
        for expression in template.exprs() {
            let expression_type = get_constrained_type_at_location(expression);
            let is_allowed = *cx.state.get_or_insert_with(expression_type, || {
                self.recursively_check_type(expression_type, &mut IdSet::new())
            });
            if !is_allowed {
                // tsgolint reports the ParenthesizedExpression.
                let report = match cx.language().is_oxlint {
                    true => cx.report(expression.outer_span(), INVALID_TYPE),
                    false => cx.report(expression, INVALID_TYPE),
                };
                report.data("type", expression_type.to_text()).labels_with(|labels| {
                    labels.first(format!("Type: {}", bstr::BStr::new(&expression_type.to_text())));
                    labels.push(expression.outer_span(), "");
                });
            }
        }
    }
}
