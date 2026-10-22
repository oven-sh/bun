use bun_lint::prelude::*;
use bun_lint::utils::eslint_utils::{ReferenceKind, ReferenceTracker, TraceMap};

const STORES: TraceMap<'static, ()> = TraceMap::new(&[(
    "svelte/store",
    TraceMap {
        esm: true,
        ..TraceMap::new(&[
            ("writable", TraceMap::EMPTY.call(())),
            ("readable", TraceMap::EMPTY.call(())),
            ("derived", TraceMap::EMPTY.call(())),
        ])
    },
)]);

/// `extractStoreReferences`: the calls to `svelte/store`'s `writable`, `readable` and `derived`.
pub(crate) fn store_calls<'a>(file: &'a File<'a>) -> Vec<Expr<'a>> {
    if !file.mentions("svelte/store") {
        return Vec::new();
    }
    let found = ReferenceTracker::new(file).iterate_esm_references(&STORES);
    (found.iter())
        .filter(|it| it.kind == ReferenceKind::Call)
        .filter_map(|it| it.expr())
        .collect()
}
