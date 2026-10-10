use bun_lint::prelude::*;
use bun_lint::types::utils::{
    TypeOrValueSpecifier, get_constrained_type_at_location, get_type_name, matches_type_or_base_type,
    parse_type_or_value_specifiers, type_matches_some_specifier,
};
use bun_lint::types::{Type, TypeFlags};
use rustc_hash::FxHashMap;

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

/// How deep the elements of arrays are followed: `type A = A[]` has no end.
const MAX_DEPTH: u32 = 100;

impl RestrictTemplateExpressions {
    fn recursively_check_type(&self, inner_type: Type, depth: u32) -> bool {
        if depth > MAX_DEPTH || inner_type.is_unresolved() {
            return true;
        }
        if inner_type.is_union() {
            return inner_type.types().iter().all(|it| self.recursively_check_type(it, depth + 1));
        }
        if inner_type.is_intersection() {
            return inner_type.types().iter().any(|it| self.recursively_check_type(it, depth + 1));
        }
        inner_type.has_flags(self.allowed_flags)
            || !self.allow.is_empty()
                && matches_type_or_base_type(|it| type_matches_some_specifier(it, &self.allow), inner_type)
            || self.allow_array
                && inner_type.is_array_or_tuple_type()
                && inner_type.get_number_index_type().is_some_and(|it| self.recursively_check_type(it, depth + 1))
            || self.allow_reg_exp && get_type_name(inner_type) == b"RegExp"
    }
}

impl Rule for RestrictTemplateExpressions {
    const META: Meta = Meta::typescript("restrict-template-expressions", Kind::Problem)
        .presets(Presets::RECOMMENDED_TYPE_CHECKED.union(Presets::STRICT_TYPE_CHECKED))
        .requires_types();
    const ON: On = On::new().exprs(&[ExprTag::Template]);
    /// Whether a type is allowed. Each constituent of a union is looked at, and many expressions have the same type.
    type State<'a> = FxHashMap<Type<'a>, bool>;

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

    fn start<'a>(&self, _: &'a File<'a>) -> Option<FxHashMap<Type<'a>, bool>> {
        Some(FxHashMap::default())
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
            let is_allowed = || self.recursively_check_type(expression_type, 0);
            if !*cx.state.entry(expression_type).or_insert_with(is_allowed) {
                cx.report(expression, INVALID_TYPE).data("type", expression_type.to_text()).labels_with(|labels| {
                    labels.first(format!("Type: {}", bstr::BStr::new(&expression_type.to_text())));
                    labels.push(expression, "");
                });
            }
        }
    }
}
