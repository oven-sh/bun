//! How router files become build entry points.

use super::*;

/// After a production bundle is generated, prerendering needs to be able to
/// look up the generated chunks associated with each route's `OpaqueFileId`
/// This data structure contains that mapping, and is also used by bundle_v2
/// to enqueue the entry points.
///
/// Canonical definition lives in `bun_bundler::bake_types::production` (lower
/// tier) so the bundler and runtime share ONE nominal type.
pub(crate) use bun_bundler::bake_types::production::EntryPointMap;

impl router::InsertionHandler for EntryPointMap {
    fn get_file_id_for_router(
        &mut self,
        abs_path: &[u8],
        _: router::RouteIndex,
        _: router::FileKind,
    ) -> Result<OpaqueFileId, bun_alloc::AllocError> {
        self.get_or_put_entry_point(abs_path, bake::Side::Server)
            .map(|id| OpaqueFileId::init(id.get()))
            .map_err(|_| bun_alloc::AllocError)
    }

    fn on_router_syntax_error(
        &mut self,
        _rel_path: &[u8],
        _fail: router::TinyLog,
    ) -> Result<(), bun_alloc::AllocError> {
        // EntryPointMap does not handle this, so a malformed route pattern
        // during a production build must crash loudly rather than be swallowed.
        bun_core::todo_panic!("onRouterSyntaxError for EntryPointMap")
    }

    fn on_router_collision_error(
        &mut self,
        rel_path: &[u8],
        other_id: OpaqueFileId,
        ty: router::FileKind,
    ) -> Result<(), bun_alloc::AllocError> {
        bun_core::err_generic!(
            "Multiple {} matching the same route pattern is ambiguous",
            ty.collision_noun()
        );
        bun_core::pretty_errorln!("  - <blue>{}<r>", BStr::new(rel_path));
        bun_core::pretty_errorln!(
            "  - <blue>{}<r>",
            BStr::new(resolve_path::relative(
                &self.root,
                self.files.keys()[other_id.get() as usize].abs_path()
            ))
        );
        Output::flush();
        Ok(())
    }
}
