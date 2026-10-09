use bun_lint_oxlint::import::import_declarations;
use bun_lint_oxlint::text::{file_name, glob_match};
use bun_core::strings;
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;

/// Forbid namespace (also known as wildcard `*`) imports.
pub struct NoNamespace {
    ignore: Vec<Box<[u8]>>,
}

const NO_NAMESPACE: Message = Message::new("", "Usage of namespaced aka wildcard \"*\" imports prohibited");

impl Rule for NoNamespace {
    const META: Meta = Meta::oxlint(Plugin::Import, "no-namespace", Kind::Suggestion);
    type State<'a> = ();

    fn new(options: &Options) -> Self {
        NoNamespace { ignore: options.object(0).strings("ignore").iter().map(|it| it.as_bytes().into()).collect() }
    }

    fn register<'a>(&self, on: &mut Listeners<'a, Self>, file: &'a File<'a>) {
        if file.has_stmts([StmtTag::Import]) {
            on.finish(|rule, cx| {
                for import in import_declarations(cx.file()) {
                    if let Some(local) = import.namespace().filter(|_| !rule.ignores(import.spec().bytes())) {
                        cx.report(local, NO_NAMESPACE);
                    }
                }
            });
        }
    }
}

impl NoNamespace {
    fn ignores(&self, source: &[u8]) -> bool {
        self.ignore.iter().any(|pattern| {
            let target = match strings::contains_char(pattern, b'/') {
                true => source,
                false => file_name(source),
            };
            glob_match(pattern, target)
        })
    }
}
