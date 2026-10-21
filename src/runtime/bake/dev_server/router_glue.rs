//! Glue between the file system router and the dev server.

use super::*;

pub(super) enum OpaqueFileIdOrOptional {
    Id(OpaqueFileId),
    Optional(router::OpaqueFileIdOptional),
}

impl From<router::OpaqueFileIdOptional> for OpaqueFileIdOrOptional {
    fn from(v: router::OpaqueFileIdOptional) -> Self {
        Self::Optional(v)
    }
}

#[repr(transparent)]
#[derive(Copy, Clone)]
struct SafeFileId(u32);

impl SafeFileId {
    fn new(side: bake::Side, index: u32) -> Self {
        SafeFileId((side as u32) | (index << 1))
    }
    fn side(self) -> bake::Side {
        if (self.0 & 1) == 0 {
            bake::Side::Client
        } else {
            bake::Side::Server
        }
    }
    fn index(self) -> u32 {
        (self.0 >> 1) & 0x3FFF_FFFF
    }
}

/// The page and layout files of a route whose router type also runs them in the browser
/// (`client_pages`), as absolute paths. Empty for any other route.
#[derive(Default)]
pub(crate) struct ClientPageFiles {
    pub(crate) page: Option<Box<[u8]>>,
    /// From the inner-most layout to the root one.
    pub(crate) layouts: Vec<Box<[u8]>>,
}

impl ClientPageFiles {
    pub(super) fn iter(&self) -> impl Iterator<Item = &[u8]> {
        self.page.iter().chain(self.layouts.iter()).map(|p| &**p)
    }
}

/// The server matches its own routes first, so it never serves this page.
fn report_hidden_page(route_path: &[u8], rel_path: &[u8]) {
    Output::err_generic(
        "The server has a route \"{}\", which hides the page {}",
        (bstr::BStr::new(route_path), bstr::BStr::new(rel_path)),
    );
    Output::flush();
}

impl DevServer {
    /// Reports each page that a route of the server hides: a route with the same path as a page
    /// that has no parameter.
    pub(super) fn report_pages_hidden_by_server_routes(&self) {
        let Some(server) = self.server else { return };
        let keys = self.server_graph.bundled_files.keys();
        for (route_path, route_index) in self.router.static_routes.iter() {
            if !server.has_route(route_path) {
                continue;
            }
            let Some(page) = self.router.route_ptr(*route_index).file_page else {
                continue;
            };
            let mut buf = paths::path_buffer_pool::get();
            let rel_path = self.relative_path(
                &mut *buf,
                &keys[from_opaque_file_id::<{ bake::Side::Server }>(page).get() as usize],
            );
            report_hidden_page(route_path, rel_path);
        }
    }

    pub(super) fn client_page_files(&self, route_index: router::RouteIndex) -> ClientPageFiles {
        let mut route = self.router.route_ptr(route_index);
        if !self.router.type_ptr_const(route.r#type).client_pages {
            return ClientPageFiles::default();
        }
        let keys = self.server_graph.bundled_files.keys();
        let path = |id: OpaqueFileId| -> Box<[u8]> {
            Box::from(&*keys[from_opaque_file_id::<{ bake::Side::Server }>(id).get() as usize])
        };
        let mut files = ClientPageFiles {
            page: route.file_page.map(path),
            layouts: Vec::new(),
        };
        loop {
            if let Some(id) = route.file_layout {
                files.layouts.push(path(id));
            }
            let Some(parent) = route.parent else { break };
            route = self.router.route_ptr(parent);
        }
        files
    }

    /// Interface function for FrameworkRouter
    pub(crate) fn get_file_id_for_router(
        &mut self,
        abs_path: &[u8],
        associated_route: router::RouteIndex,
        file_kind: router::FileKind,
    ) -> crate::Result<OpaqueFileId> {
        let index = self
            .server_graph
            .insert_stale_extra(
                abs_path,
                bake::Graph::Server,
                incremental_graph::RouteKind::Route,
            )
            .map_err(crate::Error::from)?;
        self.route_lookup.put(
            index,
            RouteIndexAndRecurseFlag::new(associated_route, file_kind == router::FileKind::Layout),
        )?;
        Ok(to_opaque_file_id::<{ bake::Side::Server }>(index))
    }

    pub(crate) fn on_router_syntax_error(
        &self,
        rel_path: &[u8],
        log: &router::TinyLog,
    ) -> Result<(), AllocError> {
        // TODO: maybe this should track the error, send over HmrSocket?
        log.print(rel_path);
        Ok(())
    }

    pub(crate) fn on_router_collision_error(
        &self,
        rel_path: &[u8],
        other_id: OpaqueFileId,
        ty: router::FileKind,
    ) -> Result<(), AllocError> {
        // TODO: maybe this should track the error, send over HmrSocket?
        Output::err_generic(
            "Multiple {} matching the same route pattern is ambiguous",
            (ty.collision_noun(),),
        );
        bun_core::pretty_errorln!("  - <blue>{}<r>", bstr::BStr::new(rel_path));
        let mut buf = paths::path_buffer_pool::get();
        bun_core::pretty_errorln!(
            "  - <blue>{}<r>",
            bstr::BStr::new(self.relative_path(
                &mut *buf,
                &self.server_graph.bundled_files.keys()
                    [from_opaque_file_id::<{ bake::Side::Server }>(other_id).get() as usize]
            ))
        );
        Output::flush();
        Ok(())
    }
}

impl router::InsertionHandler for DevServer {
    fn get_file_id_for_router(
        &mut self,
        abs_path: &[u8],
        associated_route: router::RouteIndex,
        kind: router::FileKind,
    ) -> Result<OpaqueFileId, AllocError> {
        DevServer::get_file_id_for_router(self, abs_path, associated_route, kind)
            .map_err(|_| AllocError)
    }
    fn on_router_syntax_error(
        &mut self,
        rel_path: &[u8],
        fail: router::TinyLog,
    ) -> Result<(), AllocError> {
        DevServer::on_router_syntax_error(self, rel_path, &fail)
    }
    fn on_router_collision_error(
        &mut self,
        rel_path: &[u8],
        other_id: OpaqueFileId,
        file_kind: router::FileKind,
    ) -> Result<(), AllocError> {
        DevServer::on_router_collision_error(self, rel_path, other_id, file_kind)
    }
}

pub(super) fn to_opaque_file_id<const SIDE: bake::Side>(
    index: incremental_graph::FileIndex<SIDE>,
) -> OpaqueFileId {
    if cfg!(debug_assertions) {
        return OpaqueFileId::init(SafeFileId::new(SIDE, index.get()).0);
    }
    OpaqueFileId::init(index.get())
}

pub(super) fn from_opaque_file_id<const SIDE: bake::Side>(
    id: OpaqueFileId,
) -> incremental_graph::FileIndex<SIDE> {
    if cfg!(debug_assertions) {
        let safe = SafeFileId(id.get());
        debug_assert!(SIDE == safe.side());
        return incremental_graph::FileIndex::<SIDE>::init(safe.index());
    }
    incremental_graph::FileIndex::<SIDE>::init(id.get())
}

impl DevServer {
    /// Returns posix style path, suitible for URLs and reproducible hashes.
    /// The caller must provide a PathBuffer from the pool.
    pub(crate) fn relative_path<'a>(
        &self,
        relative_path_buf: &'a mut PathBuffer,
        path: &'a [u8],
    ) -> &'a [u8] {
        if !paths::is_absolute(path) {
            return path;
        }

        if path.len() > self.root.len()
            && path[self.root.len()] == b'/'
            && path.starts_with(&self.root)
        {
            return &path[self.root.len() + 1..];
        }

        if path.len() + self.root.len() * 2 >= paths::MAX_PATH_BYTES {
            return path;
        }

        // `relative_platform_buf` with ALWAYS_COPY=true writes into
        // `relative_path_buf[..len]` (same invariant `relative_buf_z` relies
        // on); capture the length, drop the shared borrow, then re-slice
        // mutably to convert separators in place.
        let rel_len = bun_paths::resolve_path::relative_platform_buf::<
            bun_paths::resolve_path::platform::Auto,
            true,
        >(&mut relative_path_buf[..], &self.root, path)
        .len();
        bun_paths::resolve_path::platform_to_posix_in_place::<u8>(
            &mut relative_path_buf[..rel_len],
        );
        &relative_path_buf[..rel_len]
    }
}
