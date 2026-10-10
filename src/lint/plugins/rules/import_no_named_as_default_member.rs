use bun_lint_oxlint::ast_util::static_property_name;
use bun_lint_oxlint::import::{ImportImportName, import_entries};
use bun_lint_oxlint::module_record::{Loaded, debug, get_loaded_module, is_waiting_for_modules};
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;
use rustc_hash::FxHashSet;

/// Forbid using an exported name as a property on a default export.
pub struct NoNamedAsDefaultMember;

const NO_NAMED_AS_DEFAULT_MEMBER: Message = Message::new("", "{{module_name}} also has a named export {{export_name}}");

impl Rule for NoNamedAsDefaultMember {
    const META: Meta = Meta::oxlint(Plugin::Import, "no-named-as-default-member", Kind::Problem).needs_modules();
    const ON: On = On::new().finish();
    type State<'a> = ();

    fn new(_: &Options) -> Self {
        NoNamedAsDefaultMember
    }

    fn start<'a>(&self, file: &'a File<'a>) -> Option<()> {
        if is_waiting_for_modules(file) || file.modules().is_none() {
            return None;
        }
        Some(())
    }

    fn finish(&self, cx: &mut Cx<'_, Self>) {
        let file = cx.file();
        // Once, if a name is declared several times.
        let mut seen = FxHashSet::default();
        for entry in import_entries(file).filter(|it| seen.insert(it.local_name().name())) {
            let ImportImportName::Default(local) = entry.import_name else {
                continue;
            };
            let Some(remote) = get_loaded_module(file, entry.declaration.spec().bytes()) else {
                continue;
            };
            if remote.record.exported_bindings.is_empty() {
                continue;
            }
            let Some(symbol) = file.top_level_scope().get_name(local.name()) else {
                return;
            };
            for ident in symbol.references().filter_map(Reference::expr).filter(|it| !it.is_parenthesized()) {
                check(ident, remote, entry.declaration.spec(), cx);
            }
        }
    }
}

fn check<'a>(ident: Expr<'a>, remote: Loaded<'a>, specifier: Name<'a>, cx: &Cx<'a, NoNamedAsDefaultMember>) {
    let report = |at: Span, export_name: Name<'a>| {
        if remote.exports(export_name.bytes()) {
            cx.report(at, NO_NAMED_AS_DEFAULT_MEMBER)
                .data("module_name", debug(ident.text()))
                .data("export_name", debug(export_name.bytes()))
                .data("export", export_name)
                .data("suggested_module_name", debug(specifier.bytes()));
        }
    };
    match ident.parent() {
        Node::Expr(member) if member.object() == Some(ident) && !member.is_jsx_tag_name() && !member.is_in_type_query() => {
            if let Some(property) = static_property_name(member) {
                report(member.span(), property);
            }
        }
        Node::VarDecl(declarator) if declarator.init() == Some(ident) => {
            if let PatKind::Object(properties) = declarator.pat().kind() {
                for name in properties.iter().filter_map(|it| it.key()?.name()) {
                    report(declarator.span(), name);
                }
            }
        }
        _ => {}
    }
}
