use bun_lint::prelude::*;
use bun_lint::rule::Plugin;

/// Forbid the import of modules using absolute paths.
pub struct NoAbsolutePath {
    esmodule: bool,
    commonjs: bool,
    amd: bool,
}

const NO_ABSOLUTE_PATH: Message = Message::new("", "Do not import modules using an absolute path");

impl Rule for NoAbsolutePath {
    const META: Meta = Meta::oxlint(Plugin::Import, "no-absolute-path", Kind::Problem);
    type State<'a> = ();

    fn new(options: &Options) -> Self {
        let options = options.object(0);
        NoAbsolutePath {
            esmodule: options.bool_or("esmodule", true),
            commonjs: options.bool_or("commonjs", true),
            amd: options.bool_or("amd", false),
        }
    }

    fn register<'a>(&self, on: &mut Listeners<'a, Self>, file: &'a File<'a>) {
        if self.esmodule {
            on.stmts([StmtTag::Import], |_, stmt, cx| {
                if let StmtKind::Import(import) = stmt.kind()
                    && check_path_is_absolute(import.spec())
                    && let Some(source) = import.spec_span()
                {
                    cx.report(source, NO_ABSOLUTE_PATH);
                }
            });
        }
        if self.commonjs && file.mentions("require") || self.amd && file.mentions_any(&["require", "define"]) {
            on.exprs([ExprTag::Call], Self::check_call);
        }
    }
}

impl NoAbsolutePath {
    fn check_call<'a>(&self, e: Expr<'a>, cx: &mut Cx<'a, Self>) {
        let Some(call) = e.as_call() else {
            return;
        };
        let Some(func_name) = call.callee().as_ident().filter(|_| !call.callee().is_parenthesized()) else {
            return;
        };
        let (Some(first), count) = (call.args().first().filter(|it| !it.is_parenthesized()), call.args().len()) else {
            return;
        };
        match first.kind() {
            ExprKind::String(value) if count == 1 && self.commonjs && func_name.is("require") && check_path_is_absolute(value) => {
                cx.report(first, NO_ABSOLUTE_PATH);
            }
            ExprKind::Array(elements) if count == 2 && self.amd && func_name.is_any(&["require", "define"]) => {
                for element in elements {
                    if !element.is_parenthesized() && element.as_string().is_some_and(check_path_is_absolute) {
                        cx.report(element, NO_ABSOLUTE_PATH);
                    }
                }
            }
            _ => {}
        }
    }
}

/// `Path::is_absolute`, as it is where `/` separates.
fn check_path_is_absolute(path: Name) -> bool {
    path.bytes().starts_with(b"/")
}
