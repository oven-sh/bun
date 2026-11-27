//! `bun test --coverage`. The text of a file says what there is to cover, and the code that runs only counts.

#![warn(unused_must_use)]

mod bundle;
mod collector;
mod files;
mod filter;
mod format;
mod hints;
mod inline_map;
mod locs;
mod marks;
mod output;
mod positions;
mod report;
mod walk;

pub use collector::{Collector, CountedText, Loading, Transpiling, describe_compiled_file};
pub use files::Origin;
pub use filter::Project;
pub use marks::{Target, mark_nodes};

use bun_ast::Loader;
use bun_ast::coverage::{Anchors, MAX_COUNTERS};
use bun_sema::atom::Intern;
use bun_sema::hir::FileBuilder;
use bun_sema::resolve::ScriptKind;

/// `None` if there is no tree. The parser recovers from most errors, some of which are none for the transpiler.
fn with_tree<R>(
    loader: Loader,
    text: &[u8],
    then: impl FnOnce(&mut FileBuilder, &dyn Intern) -> R,
) -> Option<R> {
    let script_kind = match loader {
        Loader::Ts => ScriptKind::Ts,
        Loader::Tsx => ScriptKind::Tsx,
        _ => ScriptKind::Jsx,
    };
    bun_sema_parser::with_file_as_written(script_kind, text, |hir, atoms| {
        (!hir.has_errors).then(|| then(hir, atoms))
    })
}

pub fn find_anchors(loader: Loader, text: &[u8]) -> Option<Anchors> {
    with_tree(loader, text, |hir, _| walk::find_anchors(hir, text))
        .filter(|it| it.counters <= MAX_COUNTERS)
}
