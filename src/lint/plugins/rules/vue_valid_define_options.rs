use bun_lint_oxlint::ast_util::as_object_expression;
use crate::oxlint::vue::{calls_of, is_vue_file, is_vue_setup, key_name, object_properties};
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;

/// Enforce valid use of the `defineOptions` compiler macro.
pub struct ValidDefineOptions;

const REFERENCING_LOCALLY: Message = Message::new("", "`defineOptions` is referencing locally declared variables.");
const MULTIPLE: Message = Message::new("", "`defineOptions` has been called multiple times.");
const NOT_DEFINED: Message = Message::new("", "Options are not defined.");
const DISALLOW_PROP: Message =
    Message::new("", "`defineOptions()` cannot be used to declare `{{prop_name}}`. Use `{{instead_macro}}()` instead.");
const TYPE_ARGS: Message = Message::new("", "`defineOptions()` cannot accept type arguments.");

impl Rule for ValidDefineOptions {
    const META: Meta = Meta::oxlint(Plugin::Vue, "valid-define-options", Kind::Problem);
    const ON: On = On::new().finish();
    type State<'a> = ();

    fn new(_: &Options) -> Self {
        ValidDefineOptions
    }

    fn start<'a>(&self, file: &'a File<'a>) -> Option<()> {
        if !is_vue_file(file) || !is_vue_setup(file) || !file.mentions("defineOptions") {
            return None;
        }
        Some(())
    }

    fn finish(&self, cx: &mut Cx<'_, Self>) {
        let calls = calls_of(cx.file(), "defineOptions");
        // The identifiers of the file that are the names of what it declares, in the order of the source. With where that is.
        let mut identifiers: Vec<(Expr, Option<Span>)> = Vec::new();
        if !calls.is_empty() {
            let all = cx.file().exprs_of_kind(ExprTag::Ident).filter(|it| !it.is_in_type_query());
            identifiers.extend(all.filter_map(|it| Some((it, name_span_of_local_declaration(it)?))));
            utils::sort::sort_unstable_by_key(&mut identifiers, |it| it.0.span().start);
        }
        for (call_expr, call) in &calls {
            if let Some(type_args) = call.type_args().angle_brackets_span() {
                cx.report(type_args, TYPE_ARGS);
            }
            let Some(first_arg_expr) = call.args().first().filter(|it| it.tag() != ExprTag::Spread) else {
                cx.report(call_expr, NOT_DEFINED);
                continue;
            };
            for name in as_object_expression(first_arg_expr).into_iter().flat_map(object_properties).filter_map(key_name) {
                let instead_macro = match name.bytes() {
                    b"props" => "defineProps",
                    b"emits" => "defineEmits",
                    b"expose" => "defineExpose",
                    b"slots" => "defineSlots",
                    _ => continue,
                };
                cx.report(call_expr, DISALLOW_PROP).data("prop_name", name).data("instead_macro", instead_macro);
            }
            let options_span = first_arg_expr.outer_span();
            let inside = identifiers.iter().skip(identifiers.partition_point(|it| it.0.span().start < options_span.start));
            for (ident, declared_at) in inside.take_while(|it| it.0.span().start < options_span.end) {
                if !declared_at.is_some_and(|it| options_span.contains(it)) {
                    cx.report(ident, REFERENCING_LOCALLY);
                }
            }
        }
        // After all else that is reported at a call.
        for (call_expr, _) in calls.iter().filter(|_| calls.len() > 1) {
            cx.report(call_expr, MULTIPLE);
        }
    }
}

/// It goes by the name: where the file declares a variable of that name at its top level which is not imported and no constant.
/// `None` if it does not.
fn name_span_of_local_declaration(ident: Expr) -> Option<Option<Span>> {
    let symbol = ident.as_ident().and_then(|name| ident.file().top_level_scope().get_name(name));
    let declaration = symbol.and_then(|it| it.declarations().next())?;
    let is_non_local = match declaration.node() {
        _ if declaration.kind() == Some(DeclarationKind::ImportBinding) && !matches!(declaration, Declaration::ImportEquals(_)) => true,
        // `const a = 1`
        Some(Node::VarDecl(declarator)) => {
            declarator.var_kind() == VarKind::Const
                && declarator.init().is_some_and(|it| {
                    !it.is_parenthesized()
                        && matches!(
                            it.tag(),
                            ExprTag::String
                                | ExprTag::Number
                                | ExprTag::True
                                | ExprTag::False
                                | ExprTag::Null
                                | ExprTag::BigInt
                                | ExprTag::Regex
                        )
                })
        }
        _ => false,
    };
    (!is_non_local).then(|| declaration.name_span())
}
