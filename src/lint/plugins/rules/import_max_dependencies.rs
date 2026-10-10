use crate::module_visitor::{self, Systems, Visitor};
use bun_lint_oxlint::import::{import_declarations, import_entries};
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;
use rustc_hash::FxHashSet;

/// Enforce the maximum number of dependencies a module can have.
pub struct MaxDependencies {
    /// As oxlint reads it.
    max: u32,
    /// `None`: there are options, and no `max` among them. Nothing is more than `undefined`.
    written_max: Option<f64>,
    ignore_type_imports: bool,
}

const EXCEEDED: Message = Message::new("", "Maximum number of dependencies ({{max}}) exceeded.");
const MAX_DEPENDENCIES: Message =
    Message::new("", "File has too many dependencies ({{module_count}}). Maximum allowed is {{max}}.");

const SYSTEMS: Systems = Systems { esmodule: true, commonjs: true, amd: false };

impl Rule for MaxDependencies {
    const META: Meta = Meta::plugin(Plugin::Import, "max-dependencies", Kind::Suggestion);
    const ON: On = On::new().finish();
    type State<'a> = ();

    fn new(options: &Options) -> Self {
        let as_u32 = |n: f64| (n.fract() == 0.0 && (0.0..=f64::from(u32::MAX)).contains(&n)).then_some(n as u32);
        if let Some(max) = options.number(0).and_then(as_u32) {
            return MaxDependencies { max, written_max: None, ignore_type_imports: false };
        }
        let written_max = if options.is_empty() { Some(10.0) } else { options.object(0).number("max") };
        let options = options.object(0);
        MaxDependencies {
            max: options.number("max").and_then(as_u32).unwrap_or(10),
            written_max,
            ignore_type_imports: options.bool_or("ignoreTypeImports", false),
        }
    }

    fn start<'a>(&self, file: &'a File<'a>) -> Option<()> {
        if file.language().is_oxlint {
            return import_declarations(file).nth(self.max as usize).is_some().then_some(());
        }
        (self.written_max.is_some() && Visitor::of(SYSTEMS).may_visit(file)).then_some(())
    }

    fn finish(&self, cx: &mut Cx<'_, Self>) {
        let mut dependency_sources: FxHashSet<&[u8]> = FxHashSet::default();
        // Whether it is the first that is too many.
        let mut add = |source, is_type: bool| {
            !(self.ignore_type_imports && is_type)
                && dependency_sources.insert(source)
                && dependency_sources.len() == self.max as usize + 1
        };
        // oxlint looks at the names that `import`s at the top level declare, and points at the first that is too many.
        if cx.language().is_oxlint {
            let mut first_exceeding = None;
            for entry in import_entries(cx.file()) {
                if add(entry.declaration.spec().bytes(), entry.is_type()) {
                    first_exceeding = entry.declaration.spec_span();
                }
            }
            if let Some(span) = first_exceeding {
                cx.report(span, MAX_DEPENDENCIES).data("module_count", dependency_sources.len()).data("max", self.max);
            }
            return;
        }
        let visited = module_visitor::visit(cx.file(), SYSTEMS);
        for it in &visited {
            let is_import_type = |it: Stmt| matches!(it.kind(), StmtKind::Import(it) if it.is_type_only());
            add(it.specifier, matches!(it.importer, Node::Stmt(it) if is_import_type(it)));
        }
        if let (Some(last_node), Some(max)) = (visited.last(), self.written_max)
            && dependency_sources.len() as f64 > max
        {
            cx.report(last_node.source, EXCEEDED).data("max", text::number_to_string(max));
        }
    }
}
