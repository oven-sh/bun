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

/// Scans routes for `bun build --app`. Counts invalid routes so the build can fail.
pub(super) struct RouteScan<'a> {
    pub(super) entry_points: &'a mut EntryPointMap,
    pub(super) invalid_routes: usize,
}

impl router::InsertionHandler for RouteScan<'_> {
    fn get_file_id_for_router(
        &mut self,
        abs_path: &[u8],
        _: router::RouteIndex,
        _: router::FileKind,
    ) -> Result<OpaqueFileId, bun_alloc::AllocError> {
        self.entry_points
            .get_or_put_entry_point(abs_path, bake::Side::Server)
            .map(|id| OpaqueFileId::init(id.get()))
            .map_err(|_| bun_alloc::AllocError)
    }

    fn on_router_syntax_error(
        &mut self,
        rel_path: &[u8],
        fail: router::TinyLog,
    ) -> Result<(), bun_alloc::AllocError> {
        fail.print(rel_path);
        self.invalid_routes += 1;
        Ok(())
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
                &self.entry_points.root,
                self.entry_points.files.keys()[other_id.get() as usize].abs_path()
            ))
        );
        Output::flush();
        Ok(())
    }
}
