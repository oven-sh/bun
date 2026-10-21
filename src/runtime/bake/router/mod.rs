//! Discovers routes from the filesystem, as instructed by the framework
//! configuration. Agnostic to all different paradigms. Supports incrementally
//! updating for DevServer, or serializing to a binary for use in production.

use bun_alloc::ArenaVecExt as _;
use bun_paths::strings;
use core::mem::size_of;

use bun_alloc::{AllocError, Arena};
use bun_collections::{ArrayHashMap, BoundedArray, StringArrayHashMap};
use bun_jsc::{JSGlobalObject, JSValue, JsResult, StringJsc, StrongOptional};
use bun_paths as paths;
use bun_resolver::{DirInfo, Resolver};

use crate::bake::dev_server::route_bundle::IndexOptional as RouteBundleIndexOptional;

pub(crate) mod js;
mod pattern;
mod style;
mod tiny_log;

pub(crate) use js::JSFrameworkRouter;
pub(crate) use pattern::*;
pub(crate) use style::*;
pub(crate) use tiny_log::*;

/// Metadata for route files is specified out of line, either in DevServer where
/// it is an IncrementalGraph(.server).FileIndex or the production build context
/// where it is an entrypoint index.
pub(crate) enum OpaqueFileIdMarker {}
pub(crate) type OpaqueFileId = bun_core::GenericIndex<u32, OpaqueFileIdMarker>;
pub(crate) type OpaqueFileIdOptional = Option<OpaqueFileId>;

pub(crate) struct FrameworkRouter {
    /// Absolute project root. Only used to shorten file paths in errors. A `Type::abs_root` can be outside it.
    pub(crate) root: Box<[u8]>,
    pub(crate) types: Box<[Type]>,
    pub(crate) routes: Vec<Route>,
    /// Keys are full URL, with leading /, no trailing /
    /// Value is Route Index
    pub(crate) static_routes: StaticRouteMap,
    /// A flat list of all dynamic patterns.
    ///
    /// Used to detect routes that have the same effective URL. Examples:
    /// - `/hello/[foo]/bar` and `/hello/[baz]/bar`
    /// - `/(one)/abc/def` and `/(two)/abc/def`
    ///
    /// Note that file that match to the same exact route are already caught as
    /// errors since the Route cannot store a list of files. Examples:
    /// - `/about/index.tsx` and `/about.tsx` with style `.nextjs-pages`
    /// Key in this map is EncodedPattern.
    ///
    /// Root files are not caught using this technique, since every route tree has a
    /// root. This check is special cased.
    // TODO: no code to sort this data structure
    pub(crate) dynamic_routes: DynamicRouteMap,

    /// Arena allocator for pattern strings.
    ///
    /// This should be passed into `EncodedPattern::init_from_parts` or should be the
    /// allocator used to allocate `StaticRoute.route_path`.
    ///
    /// Q: Why use this and not just free the strings for `EncodedPattern` and
    ///    `StaticRoute` manually?
    ///
    /// A: Inside `fr.insert(...)` we iterate over `EncodedPattern/StaticRoute`,
    ///    turning them into a bunch of `Route.Part`s, and we discard the original
    ///    `EncodePattern/StaticRoute` structure.
    ///
    ///    In this process it's too easy to lose the original base pointer and
    ///    length of the entire allocation. So we'll just allocate everything in
    ///    this arena to ensure that everything gets freed.
    pub(crate) pattern_string_arena: Arena,
}

pub(crate) type StaticRouteMap = StringArrayHashMap<RouteIndex>;
pub(crate) type DynamicRouteMap = ArrayHashMap<EncodedPattern, RouteIndex, EffectiveUrlContext>;

/// A logical route, for which layouts are looked up on after resolving a route.
pub(crate) struct Route {
    // Payload bytes borrow from the sibling `pattern_string_arena` field — a
    // self-referential borrow Rust lifetimes cannot express, so it is detached
    // to `'static` via `to_owned_part()` at insertion. See `to_owned_part` for
    // the safety invariant (arena outlives every `Route`).
    pub(crate) part: Part<'static>,
    pub r#type: TypeIndex,

    pub(crate) parent: Option<RouteIndex>,
    pub(crate) first_child: Option<RouteIndex>,
    pub(crate) next_sibling: Option<RouteIndex>,

    // Note: A route may be associated with no files, in which it is just a
    // construct for building the tree.
    pub(crate) file_page: OpaqueFileIdOptional,
    pub(crate) file_layout: OpaqueFileIdOptional,
    // pub file_not_found: OpaqueFileIdOptional,
    /// Only used by DevServer, if this route is 1. navigatable & 2. has been requested at least once
    pub(crate) bundle: RouteBundleIndexOptional,
}

impl Route {
    #[inline]
    fn file_ptr(&mut self, file_kind: FileKind) -> &mut OpaqueFileIdOptional {
        match file_kind {
            FileKind::Page => &mut self.file_page,
            FileKind::Layout => &mut self.file_layout,
            // FileKind::NotFound => &mut self.file_not_found,
        }
    }
}

#[derive(Copy, Clone, Eq, PartialEq, Debug, strum::IntoStaticStr)]
#[repr(u8)]
pub enum FileKind {
    #[strum(serialize = "page")]
    Page,
    #[strum(serialize = "layout")]
    Layout,
    // NotFound,
}

impl FileKind {
    /// The noun in "Multiple {} matching the same route pattern is ambiguous".
    pub(crate) fn collision_noun(self) -> &'static str {
        match self {
            FileKind::Page => "pages",
            FileKind::Layout => "layout",
        }
    }
}

pub(crate) enum RouteMarker {}
pub(crate) type RouteIndex = bun_core::GenericIndex<u32, RouteMarker>;

/// Native code for `FrameworkFileSystemRouterType`
pub(crate) struct Type {
    pub(crate) abs_root: Box<[u8]>,
    pub(crate) ignore_underscores: bool,
    pub(crate) ignore_dirs: Box<[Box<[u8]>]>,
    pub(crate) extensions: Box<[Box<[u8]>]>,
    pub(crate) style: Style,
    pub(crate) allow_layouts: bool,
    /// `FrameworkRouter` itself does not use this value. See `FileSystemRouterType::client_pages`.
    pub(crate) client_pages: bool,
    /// `FrameworkRouter` itself does not use this value.
    pub(crate) client_file: OpaqueFileIdOptional,
    /// `FrameworkRouter` itself does not use this value.
    pub(crate) server_file: OpaqueFileId,
    /// `FrameworkRouter` itself does not use this value.
    pub(crate) server_file_string: StrongOptional,
}

impl Default for Type {
    fn default() -> Self {
        Self {
            abs_root: Box::default(),
            ignore_underscores: false,
            ignore_dirs: Box::new([
                Box::<[u8]>::from(b".git".as_slice()),
                Box::<[u8]>::from(b"node_modules".as_slice()),
            ]),
            extensions: Box::default(),
            style: Style::NextjsPages,
            allow_layouts: false,
            client_pages: false,
            client_file: None,
            server_file: OpaqueFileId::init(0),
            server_file_string: StrongOptional::empty(),
        }
    }
}

impl Type {
    pub(crate) fn root_route_index(type_index: TypeIndex) -> RouteIndex {
        RouteIndex::init(type_index.get() as u32)
    }
}

pub(crate) enum TypeMarker {}
pub(crate) type TypeIndex = bun_core::GenericIndex<u8, TypeMarker>;

impl FrameworkRouter {
    pub(crate) fn init_empty(
        root: &[u8],
        mut types: Box<[Type]>,
    ) -> Result<FrameworkRouter, AllocError> {
        debug_assert!(paths::is_absolute(root));

        let mut routes: Vec<Route> = Vec::with_capacity(types.len());
        // errdefer: Vec drops on error path automatically

        for (type_index, ty) in types.iter_mut().enumerate() {
            ty.abs_root = strings::paths::without_trailing_slash_windows_path(&ty.abs_root).into();
            debug_assert!(paths::is_absolute(&ty.abs_root));

            routes.push(Route {
                part: Part::Text(b""),
                r#type: TypeIndex::init(u8::try_from(type_index).expect("int cast")),
                parent: None,
                next_sibling: None,
                first_child: None,
                file_page: None,
                file_layout: None,
                // file_not_found: None,
                bundle: RouteBundleIndexOptional::None,
            });
        }
        Ok(FrameworkRouter {
            root: strings::paths::without_trailing_slash_windows_path(root).into(),
            types,
            routes,
            dynamic_routes: DynamicRouteMap::default(),
            static_routes: StaticRouteMap::default(),
            pattern_string_arena: Arena::new(),
        })
    }
}

impl FrameworkRouter {
    pub(crate) fn memory_cost(&self) -> usize {
        let mut cost: usize = size_of::<FrameworkRouter>();
        cost += self.routes.capacity() * size_of::<Route>();
        // The `ArrayHashMap` stores three column `Vec`s (keys, values, 32-bit
        // hashes), so the footprint is `capacity * (sizeof K + sizeof V + sizeof u32)`.
        cost += self.static_routes.capacity()
            * (size_of::<Box<[u8]>>() + size_of::<RouteIndex>() + size_of::<u32>());
        cost += self.dynamic_routes.capacity()
            * (size_of::<EncodedPattern>() + size_of::<RouteIndex>() + size_of::<u32>());
        cost
    }

    pub(crate) fn scan_all(
        &mut self,
        r: &mut Resolver,
        ctx: &mut dyn InsertionHandler,
    ) -> Result<(), AllocError> {
        for i in 0..self.types.len() {
            self.scan(TypeIndex::init(u8::try_from(i).expect("int cast")), r, ctx)?;
        }
        Ok(())
    }
}

#[derive(thiserror::Error, Debug, strum::IntoStaticStr)]
pub enum InsertError {
    #[error("RouteCollision")]
    RouteCollision,
    #[error("OutOfMemory")]
    OutOfMemory,
}
bun_core::oom_from_alloc!(InsertError);

// Runtime enum carrying both pattern shapes; profile if hot.
pub(crate) enum InsertPattern {
    Static(StaticPattern),
    Dynamic(EncodedPattern),
}

impl FrameworkRouter {
    /// Insert a new file, potentially creating a Route for that file.
    /// Moves ownership of EncodedPattern into the FrameworkRouter.
    ///
    /// This function is designed so that any insertion order will create an
    /// equivalent routing tree, but it does not guarantee that route indices
    /// would match up if a different insertion order was picked.
    pub(crate) fn insert(
        &mut self,
        ty: TypeIndex,
        pattern: InsertPattern,
        file_kind: FileKind,
        file_path: &[u8],
        ctx: &mut dyn InsertionHandler,
        // When `InsertError::RouteCollision` is returned, this is set to the existing file index.
        out_colliding_file_id: &mut OpaqueFileId,
    ) -> Result<(), InsertError> {
        // The root route is the index of the type
        let root_route = Type::root_route_index(ty);

        // Set up iterators (one will be None depending on pattern variant)
        let (mut static_it, mut dynamic_it) = match &pattern {
            InsertPattern::Static(p) => (Some(p.iterate()), None),
            InsertPattern::Dynamic(p) => (None, Some(p.iterate())),
        };
        // Note: a closure can't express that the returned `Part<'a>` borrows from the
        // iterator's `'a` (Rust infers fresh anon lifetimes per `'_`). Use a local fn item.
        fn next_part<'a>(
            s: &mut Option<StaticPatternIterator<'a>>,
            d: &mut Option<EncodedPatternIterator<'a>>,
        ) -> Option<Part<'a>> {
            if let Some(it) = s {
                it.next()
            } else {
                d.as_mut().unwrap().next()
            }
        }

        let new_route_index: RouteIndex = 'brk: {
            let Some(mut current_part) = next_part(&mut static_it, &mut dynamic_it) else {
                break 'brk root_route;
            };

            let mut route_index = root_route;
            'outer: loop {
                let mut next = self.route_ptr(route_index).first_child;
                while let Some(current) = next {
                    if current_part.eql(&self.route_ptr(current).part) {
                        match next_part(&mut static_it, &mut dynamic_it) {
                            None => break 'brk current, // found it!
                            Some(p) => current_part = p,
                        }
                        route_index = current;
                        continue 'outer;
                    }
                    next = match self.route_ptr(next.unwrap()).next_sibling {
                        Some(s) => Some(s),
                        None => break,
                    };
                }

                // Must add to this child
                let mut new_route_index = self.new_route(Route {
                    // SAFETY: `current_part` borrows from `pattern_string_arena`
                    // (owned by `self`), which outlives every `Route` stored in
                    // `self.routes`.
                    part: unsafe { current_part.to_owned_part() },
                    r#type: ty,
                    parent: Some(route_index),
                    first_child: None,
                    next_sibling: None,
                    file_page: None,
                    file_layout: None,
                    bundle: RouteBundleIndexOptional::None,
                })?;

                if let Some(attach) = next {
                    self.route_ptr_mut(attach).next_sibling = Some(new_route_index);
                } else {
                    self.route_ptr_mut(route_index).first_child = Some(new_route_index);
                }

                // Build each part out as another node in the routing graph. This makes
                // inserting routes simpler to implement, but could technically be avoided.
                while let Some(next_part_val) = next_part(&mut static_it, &mut dynamic_it) {
                    let newer_route_index = self.new_route(Route {
                        // SAFETY: `next_part_val` borrows from
                        // `pattern_string_arena` (owned by `self`), which
                        // outlives every `Route` stored in `self.routes`.
                        part: unsafe { next_part_val.to_owned_part() },
                        r#type: ty,
                        parent: Some(new_route_index),
                        first_child: None,
                        next_sibling: None,
                        file_page: None,
                        file_layout: None,
                        bundle: RouteBundleIndexOptional::None,
                    })?;
                    self.route_ptr_mut(new_route_index).first_child = Some(newer_route_index);
                    new_route_index = newer_route_index;
                }

                break 'brk new_route_index;
            }
        };

        let file_id = ctx.get_file_id_for_router(file_path, new_route_index, file_kind)?;

        let new_route = self.route_ptr_mut(new_route_index);
        if let Some(existing) = *new_route.file_ptr(file_kind) {
            if existing == file_id {
                return Ok(()); // exact match already exists. Hot-reloading code hits this
            }
            *out_colliding_file_id = existing;
            return Err(InsertError::RouteCollision);
        }
        *new_route.file_ptr(file_kind) = Some(file_id);

        if file_kind == FileKind::Page {
            // Another page with a different file path but the same URL pattern: `(a)/about.tsx`
            // and `(b)/about.tsx`, or `[a].tsx` and `[b].tsx`.
            let aliased = match pattern {
                InsertPattern::Static(p) => {
                    let key: &[u8] = if p.route_path().is_empty() {
                        b"/"
                    } else {
                        p.route_path()
                    };
                    let gop = self.static_routes.get_or_put(key)?;
                    if gop.found_existing {
                        Some(*gop.value_ptr)
                    } else {
                        *gop.value_ptr = new_route_index;
                        None
                    }
                }
                InsertPattern::Dynamic(p) => {
                    let gop = self.dynamic_routes.get_or_put(p)?;
                    if gop.found_existing {
                        Some(*gop.value_ptr)
                    } else {
                        *gop.value_ptr = new_route_index;
                        None
                    }
                }
            };
            if let Some(existing_route) = aliased {
                self.route_ptr_mut(new_route_index).file_page = None;
                if let Some(existing) = self.route_ptr(existing_route).file_page {
                    *out_colliding_file_id = existing;
                }
                return Err(InsertError::RouteCollision);
            }
        }
        Ok(())
    }
}

/// An enforced upper bound of 64 unique patterns allows routing to use no heap allocation
#[derive(Default)]
pub(crate) struct MatchedParams {
    pub(crate) params: BoundedArray<MatchedParamEntry, { MatchedParams::MAX_COUNT }>,
}

#[derive(Copy, Clone)]
pub(crate) struct MatchedParamEntry {
    // Borrow from the input `path`/`pattern` buffers; both outlive the
    // `MatchedParams` stack frame. See `RawSlice` invariant.
    pub key: bun_ptr::RawSlice<u8>,
    pub value: bun_ptr::RawSlice<u8>,
}

impl MatchedParams {
    pub(crate) const MAX_COUNT: usize = 64;

    /// Convert the matched params to a JavaScript object
    /// Returns null if there are no params
    pub(crate) fn to_js(&self, global: &JSGlobalObject) -> JsResult<JSValue> {
        let params_array = self.params.const_slice();

        if params_array.is_empty() {
            return Ok(JSValue::NULL);
        }

        // Create a JavaScript object with params
        let obj = JSValue::create_empty_object(global, params_array.len());
        for param in params_array {
            let key_str = bun_core::String::clone_utf8(param.key.slice());
            let value_str = bun_core::String::clone_utf8(param.value.slice());

            obj.put_bun_string_one_or_array(global, &key_str, value_str.into_js(global)?)?;
        }
        Ok(obj)
    }
}

impl FrameworkRouter {
    /// Fast enough for development to be seamless, but avoids building a
    /// complicated data structure that production uses to efficiently map
    /// urls to routes instead of this tree-traversal algorithm.
    pub(crate) fn match_slow(&self, path: &[u8], params: &mut MatchedParams) -> Option<RouteIndex> {
        params.params = BoundedArray::default();

        // Every route pattern starts with '/', but a request target or a path from JS might not.
        if path.first() != Some(&b'/') {
            return None;
        }
        if let Some(static_route) = self.static_routes.get(path) {
            return Some(*static_route);
        }

        for (i, pattern) in self.dynamic_routes.keys().iter().enumerate() {
            if pattern.matches(path, params) {
                return Some(self.dynamic_routes.values()[i]);
            }
        }

        None
    }

    pub(crate) fn route_ptr(&self, i: RouteIndex) -> &Route {
        &self.routes[i.get() as usize]
    }

    pub(crate) fn route_ptr_mut(&mut self, i: RouteIndex) -> &mut Route {
        &mut self.routes[i.get() as usize]
    }

    pub(crate) fn type_ptr(&mut self, i: TypeIndex) -> &mut Type {
        &mut self.types[i.get() as usize]
    }

    pub(crate) fn type_ptr_const(&self, i: TypeIndex) -> &Type {
        &self.types[i.get() as usize]
    }

    fn new_route(&mut self, route_data: Route) -> Result<RouteIndex, AllocError> {
        let i = self.routes.len();
        self.routes.push(route_data);
        Ok(RouteIndex::init(u32::try_from(i).expect("int cast")))
    }
}

/// Interface for connecting FrameworkRouter to another codebase
pub(crate) trait InsertionHandler {
    fn get_file_id_for_router(
        &mut self,
        abs_path: &[u8],
        associated_route: RouteIndex,
        kind: FileKind,
    ) -> Result<OpaqueFileId, AllocError>;

    fn on_router_syntax_error(&mut self, rel_path: &[u8], fail: TinyLog) -> Result<(), AllocError>;

    fn on_router_collision_error(
        &mut self,
        rel_path: &[u8],
        other_id: OpaqueFileId,
        file_kind: FileKind,
    ) -> Result<(), AllocError>;
}

/// Hash context (wyhash final4, seed 0) for the `zig_hash_map` rebuild below.
///
/// `scan_inner` walks `DirEntry.data` to discover routes; the resulting child
/// order is the map's iteration order, and the linear-probe bucket walk is
/// what `test/bake/framework-router.test.ts` snapshots. `EntryMap` is a
/// `std::collections::HashMap`, which has a different layout, so we rebuild
/// into a `zig_hash_map` keyed/hashed deterministically before iterating.
struct ZigStringHashContext;
impl bun_collections::zig_hash_map::HashContext<Box<[u8]>> for ZigStringHashContext {
    #[inline]
    fn ctx_hash(key: &Box<[u8]>) -> u64 {
        // `bun_wyhash::hash` is the wyhash final4 variant with seed 0.
        // (Don't route through `auto_hash`/`OneShotHasher`
        // here: Rust's `<[u8] as Hash>` mixes in a length prefix, which would
        // shift the bucket layout the snapshot below depends on.)
        bun_wyhash::hash(key)
    }
    #[inline]
    fn ctx_eql(a: &Box<[u8]>, b: &Box<[u8]>) -> bool {
        a[..] == b[..]
    }
}

impl FrameworkRouter {
    pub(crate) fn scan(
        &mut self,
        ty: TypeIndex,
        r: &mut Resolver,
        ctx: &mut dyn InsertionHandler,
    ) -> Result<(), AllocError> {
        let abs_root: Box<[u8]> = self.types[ty.get() as usize].abs_root.clone();
        debug_assert!(!abs_root.ends_with(b"/"));
        debug_assert!(paths::is_absolute(&abs_root));
        let Some(root_info) = r.read_dir_info_ignore_error(&abs_root) else {
            return Ok(());
        };
        let mut arena_state = Arena::new();
        self.scan_inner(ty, r, &root_info, &mut arena_state, ctx)
    }

    fn scan_inner(
        &mut self,
        t_index: TypeIndex,
        r: &mut Resolver,
        dir_info: &DirInfo,
        arena_state: &mut Arena,
        ctx: &mut dyn InsertionHandler,
    ) -> Result<(), AllocError> {
        let fs = r.fs();
        // SAFETY: BACKREF — `r.fs()` is the process-global FileSystem singleton; valid for the
        // program lifetime. Resolver mutex serializes mutation. We hold a raw pointer (no borrow)
        // so `r.read_dir_info_ignore_error(&mut self)` below does not conflict.
        let fs_ref = unsafe { &*fs };
        // SAFETY: `fs` is the non-null process-global FileSystem singleton (see above);
        // `addr_of_mut!` only computes a field address without forming a reference.
        let fs_impl = unsafe { core::ptr::addr_of_mut!((*fs).fs) };

        {
            // Note: `entries.data` is backed by `std::collections::HashMap`,
            // whose iteration order is unspecified. The route-tree child order
            // is this iteration order (see `insert`), and
            // `test/bake/framework-router.test.ts` snapshots it. Rebuild into a
            // `zig_hash_map` (fixed wyhash/seed/probe) so the walk order is
            // deterministic. Absent hash collisions (the common case for small
            // dirs) the bucket order is fully determined by the hash, so
            // re-insertion order is irrelevant.
            let mut zig_order: bun_collections::zig_hash_map::HashMap<
                Box<[u8]>,
                *mut bun_resolver::fs::Entry,
                ZigStringHashContext,
            > = Default::default();
            {
                // Copy under `entries_mutex`: other threads rewrite the cached
                // `DirEntry` map in place under that lock. Dropped before the
                // walk so the `read_dir_info_ignore_error` recursion can re-lock.
                let _entries_lock = fs_ref.fs.entries_mutex.lock_guard();
                if let Some(entries) = dir_info.get_entries_const() {
                    for (k, &v) in entries.data.iter() {
                        let _ = zig_order.put(Box::from(&**k), v);
                    }
                }
            }
            let mut it = zig_order.iter();
            'outer: while let Some(entry) = it.next() {
                let file_ptr: *mut bun_resolver::fs::Entry = *entry.1;
                // SAFETY: EntryMap stores `*mut Entry` into the EntryStore singleton
                // (process lifetime); the lazy-stat rewrite in `kind()` below is
                // serialized on the per-entry `Entry.mutex`.
                let file = unsafe { &*file_ptr };
                let base = file.base();
                // Note: reshaped for borrowck — fetch type fields fresh each iteration.
                // SAFETY: `Entry::kind` mutates only the entry's lazily-cached kind; `file_ptr`
                // is the unique live reference to this entry during the scan, and `fs_impl`
                // points at the process-global FS implementation.
                match unsafe { (*file_ptr).kind(&raw mut *fs_impl, false) } {
                    bun_resolver::fs::EntryKind::Dir => {
                        let t = &self.types[t_index.get() as usize];
                        if t.ignore_underscores && base.starts_with(b"_") {
                            continue 'outer;
                        }

                        for banned_dir in t.ignore_dirs.iter() {
                            if strings::eql_long(base, banned_dir, true) {
                                continue 'outer;
                            }
                        }

                        if let Some(child_info) =
                            r.read_dir_info_ignore_error(fs_ref.abs(&[file.dir, file.base()]))
                        {
                            self.scan_inner(t_index, r, &child_info, arena_state, ctx)?;
                        }
                    }
                    bun_resolver::fs::EntryKind::File => {
                        let ext = paths::extension(base);

                        {
                            let t = &self.types[t_index.get() as usize];
                            if !t.extensions.is_empty() {
                                let mut found = false;
                                for allowed_ext in t.extensions.iter() {
                                    if strings::eql(ext, allowed_ext) {
                                        found = true;
                                        break;
                                    }
                                }
                                if !found {
                                    continue 'outer;
                                }
                            }
                        }

                        let t = &self.types[t_index.get() as usize];
                        let abs_path = fs_ref.abs(&[file.dir, file.base()]);

                        // Parse the pattern from the path relative to this type's root, which can be outside `self.root`.
                        let mut rel_path_buf = bun_paths::path_buffer_pool::get();
                        let rel_path_len = 1 + paths::resolve_path::relative_normalized_buf::<
                            paths::platform::Auto,
                            true,
                        >(
                            &mut rel_path_buf[1..], &t.abs_root, abs_path
                        )
                        .len();
                        rel_path_buf[0] = b'/';
                        paths::resolve_path::platform_to_posix_in_place(
                            &mut rel_path_buf[0..rel_path_len],
                        );
                        let rel_path: &[u8] = &rel_path_buf[0..rel_path_len];

                        // For a path outside `self.root`, each root segment becomes "../".
                        // `DevServer::relative_path` uses the same bound.
                        let in_root = abs_path.len() > self.root.len()
                            && abs_path.starts_with(&self.root)
                            && paths::is_sep_native(abs_path[self.root.len()]);
                        let label_fits =
                            in_root || abs_path.len() + self.root.len() * 2 < paths::MAX_PATH_BYTES;
                        let mut full_rel_path_buf = bun_paths::path_buffer_pool::get();
                        let full_rel_path: &[u8] = if label_fits {
                            let len = paths::resolve_path::relative_normalized_buf::<
                                paths::platform::Auto,
                                true,
                            >(
                                &mut full_rel_path_buf[..], &self.root, abs_path
                            )
                            .len();
                            paths::resolve_path::platform_to_posix_in_place(
                                &mut full_rel_path_buf[0..len],
                            );
                            &full_rel_path_buf[0..len]
                        } else {
                            rel_path
                        };

                        let mut log = TinyLog::empty();
                        // The arena is reset at the end of every arm via
                        // `reset_retain_with_limit(8M)` — keep the `mi_heap`
                        // warm between directory entries instead of paying
                        // `mi_heap_destroy + mi_heap_new` per file.
                        let parse_result =
                            t.style
                                .parse(rel_path, ext, &mut log, t.allow_layouts, arena_state);
                        let parsed = match parse_result {
                            Err(_) => {
                                // `cursor_at` is an index into `rel_path`. It only maps to
                                // `full_rel_path` inside their common suffix.
                                let common_suffix_len = rel_path
                                    .iter()
                                    .rev()
                                    .zip(full_rel_path.iter().rev())
                                    .take_while(|(a, b)| a == b)
                                    .count();
                                let from_end =
                                    rel_path.len().saturating_sub(log.cursor_at as usize);
                                let label = if from_end <= common_suffix_len {
                                    log.cursor_at = u32::try_from(full_rel_path.len() - from_end)
                                        .expect("int cast");
                                    full_rel_path
                                } else {
                                    rel_path
                                };
                                ctx.on_router_syntax_error(label, log)?;
                                arena_state.reset_retain_with_limit(8 * 1024 * 1024);
                                continue 'outer;
                            }
                            Ok(None) => {
                                arena_state.reset_retain_with_limit(8 * 1024 * 1024);
                                continue 'outer;
                            }
                            Ok(Some(p)) => p,
                        };

                        if parsed.kind == ParsedPatternKind::Page
                            && t.ignore_underscores
                            && base.starts_with(b"_")
                        {
                            arena_state.reset_retain_with_limit(8 * 1024 * 1024);
                            continue 'outer;
                        }

                        let mut static_total_len: usize = 0;
                        let mut param_count: usize = 0;
                        for part in parsed.parts {
                            match part {
                                Part::Text(data) => static_total_len += 1 + data.len(),
                                Part::Param(_) | Part::CatchAll(_) | Part::CatchAllOptional(_) => {
                                    param_count += 1
                                }
                                Part::Group(_) => {}
                            }
                        }

                        if param_count > 64 {
                            log.write(format_args!("Pattern cannot have more than 64 param"));
                            log.cursor_at = 0;
                            log.cursor_len = u32::try_from(full_rel_path.len()).expect("int cast");
                            ctx.on_router_syntax_error(full_rel_path, log)?;
                            arena_state.reset_retain_with_limit(8 * 1024 * 1024);
                            continue 'outer;
                        }

                        let mut out_colliding_file_id = OpaqueFileId::init(0);

                        let file_kind: FileKind = match parsed.kind {
                            ParsedPatternKind::Page => FileKind::Page,
                            ParsedPatternKind::Layout => FileKind::Layout,
                            ParsedPatternKind::Extra => {
                                let file_name = paths::basename(full_rel_path);
                                log.fail(
                                    format_args!(
                                        "Bun Bake currently does not support \"{}\" files",
                                        bstr::BStr::new(paths::stem(full_rel_path))
                                    ),
                                    full_rel_path.len() - file_name.len(),
                                    file_name.len(),
                                );
                                ctx.on_router_syntax_error(full_rel_path, log)?;
                                arena_state.reset_retain_with_limit(8 * 1024 * 1024);
                                continue 'outer;
                            }
                        };

                        let result = if param_count > 0 {
                            let pattern = EncodedPattern::init_from_parts(
                                parsed.parts,
                                &self.pattern_string_arena,
                            )?;
                            self.insert(
                                t_index,
                                InsertPattern::Dynamic(pattern),
                                file_kind,
                                fs_ref.abs(&[file.dir, file.base()]),
                                ctx,
                                &mut out_colliding_file_id,
                            )
                        } else {
                            let allocation = self
                                .pattern_string_arena
                                .alloc_slice_fill_default::<u8>(static_total_len);
                            let mut pos = 0usize;
                            for part in parsed.parts {
                                match part {
                                    Part::Text(data) => {
                                        allocation[pos] = b'/';
                                        pos += 1;
                                        allocation[pos..pos + data.len()].copy_from_slice(data);
                                        pos += data.len();
                                    }
                                    Part::Group(_) => {}
                                    Part::Param(_)
                                    | Part::CatchAll(_)
                                    | Part::CatchAllOptional(_) => unreachable!(),
                                }
                            }
                            debug_assert!(pos == allocation.len());
                            let pattern = StaticPattern {
                                route_path: bun_ptr::RawSlice::new(allocation),
                            };
                            self.insert(
                                t_index,
                                InsertPattern::Static(pattern),
                                file_kind,
                                fs_ref.abs(&[file.dir, file.base()]),
                                ctx,
                                &mut out_colliding_file_id,
                            )
                        };

                        match result {
                            Ok(()) => {}
                            Err(InsertError::OutOfMemory) => return Err(AllocError),
                            Err(InsertError::RouteCollision) => {
                                ctx.on_router_collision_error(
                                    full_rel_path,
                                    out_colliding_file_id,
                                    file_kind,
                                )?;
                            }
                        }

                        arena_state.reset_retain_with_limit(8 * 1024 * 1024);
                    }
                    bun_resolver::fs::EntryKind::Dangling => {}
                }
            }
        }
        Ok(())
    }
}

/// `wrap` shim over the trait-object form (`&mut dyn InsertionHandler`),
/// kept so callsites read `InsertionContext::wrap(&mut ctx)`.
pub(crate) enum InsertionContext {}
impl InsertionContext {
    /// Thin shim over the trait-object form (`&mut dyn InsertionHandler`).
    #[inline]
    pub(crate) fn wrap<T: InsertionHandler>(ctx: &mut T) -> &mut dyn InsertionHandler {
        ctx
    }
}
