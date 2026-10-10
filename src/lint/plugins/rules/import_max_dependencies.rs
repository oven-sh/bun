use bun_lint_oxlint::import::{import_declarations, import_entries};
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;
use rustc_hash::FxHashSet;

/// Forbid modules to have too many dependencies (`import` statements only).
pub struct MaxDependencies {
    max: u32,
    ignore_type_imports: bool,
}

const MAX_DEPENDENCIES: Message =
    Message::new("", "File has too many dependencies ({{module_count}}). Maximum allowed is {{max}}.");

impl Rule for MaxDependencies {
    const META: Meta = Meta::oxlint(Plugin::Import, "max-dependencies", Kind::Suggestion);
    const ON: On = On::new().finish();
    type State<'a> = ();

    fn new(options: &Options) -> Self {
        let as_u32 = |n: f64| (n.fract() == 0.0 && (0.0..=f64::from(u32::MAX)).contains(&n)).then_some(n as u32);
        if let Some(max) = options.number(0).and_then(as_u32) {
            return MaxDependencies { max, ignore_type_imports: false };
        }
        let options = options.object(0);
        MaxDependencies {
            max: options.number("max").and_then(as_u32).unwrap_or(10),
            ignore_type_imports: options.bool_or("ignoreTypeImports", false),
        }
    }

    fn start<'a>(&self, file: &'a File<'a>) -> Option<()> {
        import_declarations(file).nth(self.max as usize).is_some().then_some(())
    }

    fn finish(&self, cx: &mut Cx<'_, Self>) {
        let mut dependency_sources = FxHashSet::default();
        let mut first_exceeding = None;
        for entry in import_entries(cx.file()) {
            if !(self.ignore_type_imports && entry.is_type())
                && dependency_sources.insert(entry.declaration.spec())
                && dependency_sources.len() == self.max as usize + 1
            {
                first_exceeding = entry.declaration.spec_span();
            }
        }
        if let Some(span) = first_exceeding {
            cx.report(span, MAX_DEPENDENCIES).data("module_count", dependency_sources.len()).data("max", self.max);
        }
    }
}
