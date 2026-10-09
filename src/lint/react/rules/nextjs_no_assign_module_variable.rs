use bun_lint::prelude::*;
use bun_lint::rule::Plugin;

/// Prevents the assignment or declaration of variables named `module` in Next.js applications.
pub struct NoAssignModuleVariable;

const NO_ASSIGN_MODULE_VARIABLE: Message = Message::new("", "Do not assign to the variable `module`.");

impl Rule for NoAssignModuleVariable {
    const META: Meta = Meta::oxlint(Plugin::Nextjs, "no-assign-module-variable", Kind::Problem);
    type State<'a> = ();

    fn new(_: &Options) -> Self {
        NoAssignModuleVariable
    }

    fn register<'a>(&self, on: &mut Listeners<'a, Self>, file: &'a File<'a>) {
        if !file.mentions("module") {
            return;
        }
        on.var_decls(|_, declarator, cx| {
            let id = declarator.pat();
            let is_catch_parameter = || matches!(declarator.parent(), Node::Stmt(stmt) if stmt.tag() == StmtTag::Try);
            if id.as_ident().is_some_and(|name| name.is("module")) && !is_catch_parameter() {
                cx.report(id, NO_ASSIGN_MODULE_VARIABLE);
            }
        });
    }
}
