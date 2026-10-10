use bun_lint_oxlint::ast_util::{as_object_expression, get_inner_expression, static_name};
use crate::oxlint::vue::{
    DestructuredDefaults, as_inner_object_expression, define_component_object, exported_object,
    find_property, first_type_argument, for_each_define_props_type_signature, is_optional_signature, is_vue_file,
    is_vue_setup, key_name, object_properties, span_of_key,
};
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;
use rustc_hash::FxHashSet;

/// Enforce props with default values to be optional.
pub struct NoRequiredPropWithDefault;

const NO_REQUIRED_PROP_WITH_DEFAULT: Message = Message::new("", "Prop \"{{prop_name}}\" should be optional.");
const MAKE_OPTIONAL: Message = Message::new(
    "",
    "Remove the `required: true` option, or drop the `required` key entirely to make this prop optional.",
);

type Context<'c, 'a> = &'c Cx<'a, NoRequiredPropWithDefault>;
type Keys<'a> = FxHashSet<Name<'a>>;

#[derive(Default)]
pub struct State<'a> {
    defaults: DestructuredDefaults<'a>,
}

impl Rule for NoRequiredPropWithDefault {
    const META: Meta = Meta::oxlint(Plugin::Vue, "no-required-prop-with-default", Kind::Problem).has_suggestions();
    const ON: On = On::new().exprs(&[ExprTag::Call]).stmts(&[StmtTag::ExportDefault]);
    type State<'a> = State<'a>;

    fn new(_: &Options) -> Self {
        NoRequiredPropWithDefault
    }

    fn narrow<'a>(&self, file: &'a File<'a>) -> On {
        let mut on = On::new();
        let is_setup = is_vue_file(file) && is_vue_setup(file);
        if is_setup && file.mentions("defineProps") || file.mentions("defineComponent") {
            on = on.exprs(&[ExprTag::Call]);
        }
        if is_vue_file(file) && !is_vue_setup(file) && file.mentions("props") {
            on = on.stmts(&[StmtTag::ExportDefault]);
        }
        on
    }

    fn start<'a>(&self, _: &'a File<'a>) -> Option<State<'a>> {
        Some(State::default())
    }

    fn expr<'a>(&self, e: Expr<'a>, cx: &mut Cx<'a, Self>) {
        let file = cx.file();
        let is_setup = is_vue_file(file) && is_vue_setup(file);
        if is_setup && file.mentions("defineProps") {
            run_on_setup(e, cx);
        } else {
            check_define_component(e, cx);
        }
    }

    fn stmt<'a>(&self, stmt: Stmt<'a>, cx: &mut Cx<'a, Self>) {
        handle_object_expression(exported_object(stmt), cx);
    }
}

/// `defineComponent({ props: { name: { required: true, default: "a" } } })`
fn check_define_component<'a>(e: Expr<'a>, cx: Context<'_, 'a>) {
    handle_object_expression(e.as_call().filter(|it| it.args().len() == 1).and_then(define_component_object), cx);
}

fn run_on_setup<'a>(e: Expr<'a>, cx: &mut Cx<'a, NoRequiredPropWithDefault>) {
    let Some(call_expr) = e.as_call() else {
        return;
    };
    let args = call_expr.args();
    let as_expression = |at: usize| args.get(at).filter(|it| it.tag() != ExprTag::Spread);
    match get_inner_expression(call_expr.callee()).as_ident().map(Name::bytes) {
        Some(b"defineProps") => match args.first() {
            // `const props = defineProps({ name: { required: true, default: "a" } })`,
            // `const { name = "a" } = defineProps({ name: { required: true } })`
            Some(first) => {
                if let Some(properties) = as_object_expression(first) {
                    handle_prop_object(properties, &cx.state.defaults.around(e).unwrap_or_default(), cx);
                }
            }
            // `const { name = "a" } = defineProps<Props>()`
            None => {
                if let (Some(first_type_argument), Some(key_hash)) = (first_type_argument(call_expr), cx.state.defaults.around(e)) {
                    handle_type_argument(first_type_argument, &key_hash, cx);
                }
            }
        },
        // `withDefaults(defineProps<Props>(), { name: "a" })`
        Some(b"withDefaults") if args.len() == 2 => {
            if let (Some(first), Some(second)) = (as_expression(0), as_expression(1))
                && let Some(defaults) = as_inner_object_expression(second).filter(|it| !it.is_empty())
                && let Some(define_props) = get_inner_expression(first).as_call()
                && define_props.callee().is_ident("defineProps")
                && !define_props.callee().is_parenthesized()
                && !get_inner_expression(first).is_chain_root()
                && let Some(first_type_argument) = first_type_argument(define_props)
            {
                handle_type_argument(first_type_argument, &object_properties(defaults).filter_map(key_name).collect(), cx);
            }
        }
        Some(_) => check_define_component(e, cx),
        None => {}
    }
}

fn handle_type_argument<'a>(ts_type: TypeNode<'a>, key_hash: &Keys<'a>, cx: Context<'_, 'a>) {
    for_each_define_props_type_signature(ts_type, &mut |item| {
        if matches!(item.kind(), MemberKind::Property | MemberKind::Method)
            && let Some(key) = item.key()
            && let Some(key_name) = static_name(key).filter(|it| !is_optional_signature(item) && key_hash.contains(it))
        {
            let key_span = span_of_key(key, cx.file());
            let report = cx.report(item, NO_REQUIRED_PROP_WITH_DEFAULT).data("prop_name", key_name);
            if cx.file().comments_in(Span::new(key_span.start, key_span.end + 1)).next().is_none() {
                report.suggest(MAKE_OPTIONAL, |fixer| fixer.insert_after(key_span, "?"));
            }
        }
    });
}

fn handle_object_expression<'a>(properties: Option<List<'a, Prop<'a>>>, cx: Context<'_, 'a>) {
    let props = properties.and_then(|it| find_property(it, "props")).and_then(Prop::value).and_then(as_inner_object_expression);
    if let Some(props) = props {
        handle_prop_object(props, &FxHashSet::default(), cx);
    }
}

/// `key_hash`: the props that have a default value elsewhere.
fn handle_prop_object<'a>(properties: List<'a, Prop<'a>>, key_hash: &Keys<'a>, cx: Context<'_, 'a>) {
    for inner_prop in object_properties(properties) {
        let (Some(inner_key), Some(options)) = (key_name(inner_prop), inner_prop.value().and_then(as_inner_object_expression)) else {
            continue;
        };
        let mut has_default_key = key_hash.contains(&inner_key);
        let mut required_true_span = None;
        for item in object_properties(options) {
            let Some(item_key) = key_name(item) else {
                continue;
            };
            has_default_key |= item_key.is("default");
            if item_key.is("required") {
                match item.value().filter(|it| !it.is_parenthesized()).map(|it| (it.tag(), it.span())) {
                    Some((ExprTag::True, span)) => required_true_span = Some(span),
                    Some((ExprTag::False, _)) => break,
                    _ => continue,
                }
            }
            if has_default_key && let Some(span) = required_true_span {
                let report = cx.report(inner_prop, NO_REQUIRED_PROP_WITH_DEFAULT).data("prop_name", inner_key);
                report.suggest(MAKE_OPTIONAL, |fixer| fixer.replace(span, "false"));
                break;
            }
        }
    }
}
