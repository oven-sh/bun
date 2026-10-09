use bun_lint::prelude::*;
use bun_lint::rule::Plugin;

/// Forbids any non-import statements before imports except directives.
pub struct First {
    absolute_first: bool,
}

const FIRST: Message = Message::new("", "Import statements must come first");
const ABSOLUTE_FIRST: Message = Message::new("", "Relative imports before absolute imports are prohibited");

fn is_relative_path(path: &[u8]) -> bool {
    path.starts_with(b"./") || path.starts_with(b"../") || path.starts_with(b"/")
}

impl Rule for First {
    const META: Meta = Meta::oxlint(Plugin::Import, "first", Kind::Suggestion);
    type State<'a> = ();

    fn new(options: &Options) -> Self {
        First { absolute_first: options.str(0) == Some("absolute-first") }
    }

    fn register<'a>(&self, on: &mut Listeners<'a, Self>, file: &'a File<'a>) {
        if file.has_stmts([StmtTag::Import, StmtTag::ImportEquals]) {
            on.finish(Self::check);
        }
    }
}

impl First {
    fn check<'a>(&self, cx: &mut Cx<'a, Self>) {
        let (mut has_non_import, mut any_relative) = (false, false);
        for stmt in cx.file().body() {
            let source = match stmt.kind() {
                StmtKind::Import(import) => import.spec(),
                StmtKind::ImportEquals(import) if !stmt.is_exported() => match import.target() {
                    ImportEqualsTarget::Require(Some(source)) => source,
                    _ => continue,
                },
                _ => {
                    has_non_import |= stmt.directive().is_none();
                    continue;
                }
            };
            if self.absolute_first {
                if is_relative_path(source.bytes()) {
                    any_relative = true;
                } else if any_relative && let Some(span) = stmt.module_specifier_span() {
                    cx.report(span, ABSOLUTE_FIRST);
                }
            }
            if has_non_import {
                cx.report(stmt, FIRST);
            }
        }
    }
}
