use crate::oxlint;
use bun_lint::modules::{ModuleId, Modules, requests_of};
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;
use rustc_hash::FxHashSet;

/// Disallow barrel files containing `export *` statements when the total number of modules exceeds a threshold.
pub struct NoBarrelFile {
    threshold: u32,
}

const NO_BARREL_FILE: Message =
    Message::new("", "Barrel file detected, {{total}} modules are loaded which exceeds the threshold of {{threshold}}.");

impl Rule for NoBarrelFile {
    const META: Meta = Meta::oxlint(Plugin::Oxc, "no-barrel-file", Kind::Suggestion).needs_modules();
    type State<'a> = ();

    fn new(options: &Options) -> Self {
        let threshold = options.object(0).number("threshold").filter(|it| it.fract() == 0.0 && (0.0..=f64::from(u32::MAX)).contains(it));
        NoBarrelFile { threshold: threshold.map_or(100, |it| it as u32) }
    }

    fn register<'a>(&self, on: &mut Listeners<'a, Self>, file: &'a File<'a>) {
        if !file.has_stmts([StmtTag::ExportStar]) {
            return;
        }
        match modules_of(file) {
            // What the other files import is read when it is asked for.
            Some(modules) if !modules.is_complete() => {
                let flavor = oxlint::flavor_of_modules(file);
                modules.follow_packages();
                modules.record(file.path(), &requests_of(file, flavor), true, flavor);
            }
            _ => on.finish(Self::check),
        }
    }
}

/// Without the plugin `import` oxlint knows nothing about the other files.
fn modules_of<'a>(file: &'a File<'a>) -> Option<&'a dyn Modules> {
    file.modules().filter(|_| file.path() != b"<text>" && file.settings().get(b"$withoutModules").is_none())
}

impl NoBarrelFile {
    fn check(&self, cx: &mut Cx<'_, Self>) {
        let file = cx.file();
        let modules = modules_of(file);
        // Where each module is named that imports others, and how many.
        let (mut total, mut counts) = (0u32, Vec::new());
        // `export * as a from "m"` comes first.
        for has_alias in [true, false] {
            for statement in file.body() {
                let StmtKind::ExportStar { spec: Some(specifier), alias, .. } = statement.kind() else {
                    continue;
                };
                if alias.is_some() != has_alias {
                    continue;
                }
                // The module itself.
                total += 1;
                let remote_module = modules.and_then(|it| Some((it, it.resolve(file.path(), specifier.bytes(), false)?.module)));
                if let Some(count) = remote_module.and_then(|(modules, module)| count_loaded_modules(modules, module)) {
                    total += count;
                    counts.extend(statement.module_specifier_span().map(|span| (span, count)));
                }
            }
        }
        if total > self.threshold {
            cx.report(counts.first().map(|it| it.0).unwrap_or_default(), NO_BARREL_FILE)
                .data("total", total)
                .data("threshold", self.threshold)
                .labels_with(|labels| {
                    if counts.is_empty() {
                        labels.first("File defined here.");
                    }
                    for (i, (span, count)) in counts.iter().enumerate() {
                        let text = format!("{count} module{}", if *count > 1 { "s" } else { "" });
                        match i {
                            0 => labels.first(text),
                            _ => labels.push(*span, text),
                        }
                    }
                });
        }
    }
}

/// How many modules `module` imports, directly or not. It can be one of them. `None` if it imports nothing.
fn count_loaded_modules(modules: &dyn Modules, module: ModuleId) -> Option<u32> {
    if modules.imports(module).is_empty() {
        return None;
    }
    let (mut traversed, mut pending) = (FxHashSet::default(), vec![module]);
    while let Some(module) = pending.pop() {
        pending.extend(modules.imports(module).iter().map(|it| it.module).filter(|it| traversed.insert(*it)));
    }
    Some(traversed.len() as u32)
}
