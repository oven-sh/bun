use bun_lint_oxlint::ast_util::{get_inner_expression, is_specific_id};
use bun_lint_oxlint::import::export_default;
use crate::oxlint::vue::is_vue_file;
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;

/// Require components to be the default export.
pub struct RequireDefaultExport;

const MISSING_DEFAULT_EXPORT: Message = Message::new("", "Missing default export.");
const MUST_BE_DEFAULT_EXPORT: Message = Message::new("", "Component must be the default export.");

impl Rule for RequireDefaultExport {
    const META: Meta = Meta::oxlint(Plugin::Vue, "require-default-export", Kind::Problem);
    const ON: On = On::new().finish();
    type State<'a> = ();

    fn new(_: &Options) -> Self {
        RequireDefaultExport
    }

    fn start<'a>(&self, file: &'a File<'a>) -> Option<()> {
        let script = file.vue_script();
        if !is_vue_file(file) || script.is_setup || script.other_is_setup {
            return None;
        }
        Some(())
    }

    fn finish(&self, cx: &mut Cx<'_, Self>) {
        let file = cx.file();
        if export_default(file).is_some() {
            return;
        }
        // `defineComponent(..)`, `Vue.component(..)`
        let mut callees = file.exprs_of_kind(ExprTag::Call).filter_map(Expr::callee).map(get_inner_expression);
        let has_define_component = callees.any(|it| match it.kind() {
            ExprKind::Ident(name) => name.is("defineComponent"),
            ExprKind::Dot { obj, name, .. } if !it.is_chain_root() => name.name().is("component") && is_specific_id(obj, "Vue"),
            _ => false,
        });
        // The `</script>` after the script.
        let end = file.span().end;
        let message = if has_define_component { MUST_BE_DEFAULT_EXPORT } else { MISSING_DEFAULT_EXPORT };
        let position = file.position(end);
        cx.report(Span::empty(end), message).end_at(Position { column: position.column + "</script>".len() as u32, ..position });
    }
}
