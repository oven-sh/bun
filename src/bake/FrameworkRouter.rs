//! Discovers routes from the filesystem, as instructed by the framework
//! configuration. Agnostic to all different paradigms. Supports incrementally
//! updating for DevServer, or serializing to a binary for use in production.

use core::fmt;
use core::mem::size_of;

use bun_alloc::{AllocError, Arena};
use bun_collections::{ArrayHashMap, BoundedArray, StringArrayHashMap};
use bun_core::Output;
use bun_jsc::{CallFrame, JSGlobalObject, JSValue, JsResult, Strong};
use bun_paths::{self as paths, PathBuffer, MAX_PATH_BYTES};
use bun_resolver::{DirInfo, Resolver};
use bun_str::strings;
use bun_wyhash;

use crate::dev_server::RouteBundleIndexOptional;

/// Metadata for route files is specified out of line, either in DevServer where
/// it is an IncrementalGraph(.server).FileIndex or the production build context
/// where it is an entrypoint index.
#[derive(Copy, Clone, Eq, PartialEq, Hash, Debug)]
#[repr(transparent)]
pub struct OpaqueFileId(u32);

impl OpaqueFileId {
    #[inline]
    pub const fn init(v: u32) -> Self {
        Self(v)
    }
    #[inline]
    pub const fn get(self) -> u32 {
        self.0
    }
    #[inline]
    pub const fn to_optional(self) -> Option<OpaqueFileId> {
        Some(self)
    }
}
// TODO(port): bun.GenericIndex.Optional is a packed sentinel (maxInt = none); using Option<T> here changes layout.
pub type OpaqueFileIdOptional = Option<OpaqueFileId>;

pub struct FrameworkRouter {
    /// Absolute path to root directory of the router.
    pub root: Box<[u8]>,
    pub types: Box<[Type]>,
    pub routes: Vec<Route>,
    /// Keys are full URL, with leading /, no trailing /
    /// Value is Route Index
    pub static_routes: StaticRouteMap,
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
    pub dynamic_routes: DynamicRouteMap,

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
    pub pattern_string_arena: Arena,
}

/// The above structure is optimized for incremental updates, but
/// production has a different set of requirements:
/// - Trivially serializable to a binary file (no pointers)
/// - As little memory indirection as possible.
/// - Routes cannot be updated after serialization.
pub struct Serialized {
    // TODO:
}

pub type StaticRouteMap = StringArrayHashMap<RouteIndex>;
// TODO(port): ArrayHashMap with custom context (EffectiveURLContext) — needs custom Hash/Eq adapter
pub type DynamicRouteMap = ArrayHashMap<EncodedPattern, RouteIndex, EffectiveUrlContext>;

/// A logical route, for which layouts are looked up on after resolving a route.
pub struct Route {
    // TODO(port): lifetime — payload bytes borrow from `pattern_string_arena` (ARENA class).
    // Erased to 'static via `to_owned_part()` at insertion; Phase B may switch to `*const [u8]`.
    pub part: Part<'static>,
    pub r#type: TypeIndex,

    pub parent: Option<RouteIndex>,
    pub first_child: Option<RouteIndex>,
    pub prev_sibling: Option<RouteIndex>,
    pub next_sibling: Option<RouteIndex>,

    // Note: A route may be associated with no files, in which it is just a
    // construct for building the tree.
    pub file_page: OpaqueFileIdOptional,
    pub file_layout: OpaqueFileIdOptional,
    // pub file_not_found: OpaqueFileIdOptional,

    /// Only used by DevServer, if this route is 1. navigatable & 2. has been requested at least once
    pub bundle: RouteBundleIndexOptional,
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

#[derive(Copy, Clone, Eq, PartialEq, Hash, Debug)]
#[repr(transparent)]
pub struct RouteIndex(u32); // Zig: u31
impl RouteIndex {
    #[inline]
    pub const fn init(v: u32) -> Self {
        debug_assert!(v <= (i32::MAX as u32));
        Self(v)
    }
    #[inline]
    pub const fn get(self) -> u32 {
        self.0
    }
    #[inline]
    pub const fn to_optional(self) -> Option<RouteIndex> {
        Some(self)
    }
}

/// Native code for `FrameworkFileSystemRouterType`
pub struct Type {
    pub abs_root: Box<[u8]>,
    pub prefix: Box<[u8]>,
    pub ignore_underscores: bool,
    pub ignore_dirs: Box<[Box<[u8]>]>,
    pub extensions: Box<[Box<[u8]>]>,
    pub style: Style,
    pub allow_layouts: bool,
    /// `FrameworkRouter` itself does not use this value.
    pub client_file: OpaqueFileIdOptional,
    /// `FrameworkRouter` itself does not use this value.
    pub server_file: OpaqueFileId,
    /// `FrameworkRouter` itself does not use this value.
    pub server_file_string: Strong,
}

impl Default for Type {
    fn default() -> Self {
        Self {
            abs_root: Box::default(),
            prefix: Box::<[u8]>::from(b"/".as_slice()),
            ignore_underscores: false,
            ignore_dirs: Box::new([
                Box::<[u8]>::from(b".git".as_slice()),
                Box::<[u8]>::from(b"node_modules".as_slice()),
            ]),
            extensions: Box::default(),
            style: Style::NextjsPages,
            allow_layouts: false,
            client_file: None,
            server_file: OpaqueFileId(0),
            server_file_string: Strong::empty(),
        }
    }
}

impl Type {
    pub fn root_route_index(type_index: TypeIndex) -> RouteIndex {
        RouteIndex::init(type_index.get() as u32)
    }
}

#[derive(Copy, Clone, Eq, PartialEq, Hash, Debug)]
#[repr(transparent)]
pub struct TypeIndex(u8);
impl TypeIndex {
    #[inline]
    pub const fn init(v: u8) -> Self {
        Self(v)
    }
    #[inline]
    pub const fn get(self) -> u8 {
        self.0
    }
}

impl FrameworkRouter {
    pub fn init_empty(root: &[u8], mut types: Box<[Type]>) -> Result<FrameworkRouter, AllocError> {
        debug_assert!(paths::is_absolute(root));

        let mut routes: Vec<Route> = Vec::with_capacity(types.len());
        // errdefer: Vec drops on error path automatically

        for (type_index, ty) in types.iter_mut().enumerate() {
            ty.abs_root = strings::without_trailing_slash_windows_path(&ty.abs_root).into();
            debug_assert!(strings::has_prefix(&ty.abs_root, root));

            // PERF(port): was appendAssumeCapacity
            routes.push(Route {
                part: Part::Text(b""),
                r#type: TypeIndex::init(u8::try_from(type_index).unwrap()),
                parent: None,
                prev_sibling: None,
                next_sibling: None,
                first_child: None,
                file_page: None,
                file_layout: None,
                // file_not_found: None,
                bundle: RouteBundleIndexOptional::none(),
            });
        }
        Ok(FrameworkRouter {
            root: strings::without_trailing_slash_windows_path(root).into(),
            types,
            routes,
            dynamic_routes: DynamicRouteMap::default(),
            static_routes: StaticRouteMap::default(),
            pattern_string_arena: Arena::new(),
        })
    }
}

impl FrameworkRouter {
    pub fn memory_cost(&self) -> usize {
        let mut cost: usize = size_of::<FrameworkRouter>();
        cost += self.routes.capacity() * size_of::<Route>();
        // TODO(port): StaticRouteMap/DynamicRouteMap DataList::capacity_in_bytes equivalent
        cost += self.static_routes.capacity_in_bytes();
        cost += self.dynamic_routes.capacity_in_bytes();
        cost
    }

    pub fn scan_all(
        &mut self,
        r: &mut Resolver,
        ctx: &mut dyn InsertionHandler,
    ) -> Result<(), AllocError> {
        for i in 0..self.types.len() {
            self.scan(TypeIndex::init(u8::try_from(i).unwrap()), r, ctx)?;
        }
        Ok(())
    }
}

/// Route patterns are serialized in a stable byte format so it can be treated
/// as a string, while easily decodable as []Part.
#[derive(Clone)]
pub struct EncodedPattern {
    // ARENA: backed by pattern_string_arena (raw slice; arena owns the bytes)
    pub data: *const [u8],
}

impl EncodedPattern {
    /// `/` is represented by zero bytes
    pub const ROOT: EncodedPattern = EncodedPattern {
        data: &[] as *const [u8],
    };

    #[inline]
    fn data(&self) -> &[u8] {
        // SAFETY: data points into pattern_string_arena which outlives self
        unsafe { &*self.data }
    }

    pub fn pattern_serialized_length(parts: &[Part]) -> usize {
        let mut size: usize = 0;
        for part in parts {
            size += size_of::<u32>() + part.payload().len();
        }
        size
    }

    pub fn init_from_parts(parts: &[Part], arena: &Arena) -> Result<EncodedPattern, AllocError> {
        let len = Self::pattern_serialized_length(parts);
        let slice = arena.alloc_slice_fill_default::<u8>(len);
        let mut cursor: &mut [u8] = slice;
        for part in parts {
            part.write_as_serialized(&mut cursor)
                .expect("unreachable: enough space");
        }
        debug_assert!(cursor.is_empty());
        Ok(EncodedPattern {
            data: &*slice as *const [u8],
        })
    }

    pub fn iterate(&self) -> EncodedPatternIterator<'_> {
        EncodedPatternIterator {
            pattern: self.data(),
            offset: 0,
        }
    }

    pub fn part_at(&self, byte_offset: usize) -> Option<Part> {
        EncodedPatternIterator {
            pattern: self.data(),
            offset: byte_offset,
        }
        .peek()
    }

    pub fn effective_url_hash(&self) -> usize {
        // The strategy is to write all bytes, then hash them. Avoiding
        // multiple hash calls on small chunks. Allocation is not needed
        // since the upper bound is known (file path limits)
        let mut stack_space = [0u8; MAX_PATH_BYTES * 2];
        let mut pos: usize = 0;
        let mut push = |s: &[u8]| {
            stack_space[pos..pos + s.len()].copy_from_slice(s);
            pos += s.len();
        };
        let mut it = self.iterate();
        while let Some(item) = it.next() {
            match item {
                Part::Text(text) => {
                    push(b"/");
                    push(text);
                }
                // param names are not visible
                Part::Param(_) => push(b":"),
                Part::CatchAll(_) => push(b":."),
                Part::CatchAllOptional(_) => push(b":?"),
                // groups are completely unobservable
                Part::Group(_) => continue,
            }
        }
        bun_wyhash::hash(&stack_space[..pos]) as usize
    }

    fn matches(&self, path: &[u8], params: &mut MatchedParams) -> bool {
        let mut param_num: usize = 0;
        let mut it = self.iterate();
        let mut i: usize = 1;
        while let Some(part) = it.next() {
            match part {
                Part::Text(expect) => {
                    if path.len() < i + expect.len()
                        || !(path.len() == i + expect.len() || path[i + expect.len()] == b'/')
                    {
                        return false;
                    }
                    if !strings::eql(&path[i..i + expect.len()], expect) {
                        return false;
                    }
                    i += 1 + expect.len();
                }
                Part::Param(name) => {
                    let end = strings::index_of_char_pos(path, b'/', i).unwrap_or(path.len());
                    // Check if we're about to exceed the maximum number of parameters
                    if param_num >= MatchedParams::MAX_COUNT {
                        // TODO: ideally we should throw a nice user message
                        Output::panic(format_args!(
                            "Route pattern matched more than {} parameters. Path: {}",
                            MatchedParams::MAX_COUNT,
                            bstr::BStr::new(path)
                        ));
                    }
                    params.params.set_len(u32::try_from(param_num + 1).unwrap());
                    params.params.buffer_mut()[param_num] = MatchedParamEntry {
                        key: name,
                        value: &path[i..end],
                    };
                    param_num += 1;
                    i = if end == path.len() { end } else { end + 1 };
                }
                Part::CatchAllOptional(name) | Part::CatchAll(name) => {
                    // Capture remaining path segments as individual parameters
                    if i < path.len() {
                        let mut segment_start = i;
                        while segment_start < path.len() {
                            let segment_end = strings::index_of_char_pos(path, b'/', segment_start)
                                .unwrap_or(path.len());
                            if segment_start < segment_end {
                                // Check if we're about to exceed the maximum number of parameters
                                if param_num >= MatchedParams::MAX_COUNT {
                                    // TODO: ideally we should throw a nice user message
                                    Output::panic(format_args!(
                                        "Route pattern matched more than {} parameters. Path: {}",
                                        MatchedParams::MAX_COUNT,
                                        bstr::BStr::new(path)
                                    ));
                                }
                                params.params.set_len(u32::try_from(param_num + 1).unwrap());
                                params.params.buffer_mut()[param_num] = MatchedParamEntry {
                                    key: name,
                                    value: &path[segment_start..segment_end],
                                };
                                param_num += 1;
                            }
                            segment_start = if segment_end == path.len() {
                                segment_end
                            } else {
                                segment_end + 1
                            };
                        }
                    }
                    return true;
                }
                Part::Group(_) => continue,
            }
        }
        i == path.len()
    }
}

pub struct EncodedPatternIterator<'a> {
    pattern: &'a [u8],
    offset: usize,
}

impl<'a> EncodedPatternIterator<'a> {
    pub fn read_with_size(&self) -> (Part<'a>, usize) {
        let header = SerializedHeader(u32::from_le_bytes(
            self.pattern[self.offset..self.offset + size_of::<u32>()]
                .try_into()
                .unwrap(),
        ));
        let payload =
            &self.pattern[self.offset + size_of::<u32>()..self.offset + size_of::<u32>() + header.len()];
        let part = match header.tag() {
            PartTag::Text => Part::Text(payload),
            PartTag::Param => Part::Param(payload),
            PartTag::CatchAllOptional => Part::CatchAllOptional(payload),
            PartTag::CatchAll => Part::CatchAll(payload),
            PartTag::Group => Part::Group(payload),
        };
        (part, size_of::<u32>() + header.len())
    }

    pub fn peek(&self) -> Option<Part<'a>> {
        if self.offset >= self.pattern.len() {
            return None;
        }
        Some(self.read_with_size().0)
    }
}

impl<'a> Iterator for EncodedPatternIterator<'a> {
    type Item = Part<'a>;
    fn next(&mut self) -> Option<Part<'a>> {
        if self.offset >= self.pattern.len() {
            return None;
        }
        let (part, len) = self.read_with_size();
        self.offset += len;
        Some(part)
    }
}

/// Hash context for DynamicRouteMap — hashes/compares by effective URL.
pub struct EffectiveUrlContext;
impl EffectiveUrlContext {
    pub fn hash(p: &EncodedPattern) -> u32 {
        p.effective_url_hash() as u32 // @truncate
    }
    pub fn eql(a: &EncodedPattern, b: &EncodedPattern, _: usize) -> bool {
        a.effective_url_hash() == b.effective_url_hash()
    }
}

/// Wrapper around a slice to provide same interface to be used in `insert`
/// but with the allocation being backed by a plain string, which each
/// part separated by slashes.
pub struct StaticPattern {
    // ARENA: backed by pattern_string_arena
    pub route_path: *const [u8],
}

impl StaticPattern {
    #[inline]
    fn route_path(&self) -> &[u8] {
        // SAFETY: route_path points into pattern_string_arena which outlives self
        unsafe { &*self.route_path }
    }

    pub fn iterate(&self) -> StaticPatternIterator<'_> {
        StaticPatternIterator {
            pattern: self.route_path(),
            offset: 0,
        }
    }
}

pub struct StaticPatternIterator<'a> {
    pattern: &'a [u8],
    offset: usize,
}

impl<'a> StaticPatternIterator<'a> {
    pub fn read_with_size(&self) -> (Part<'a>, usize) {
        let next_i = strings::index_of_char_pos(self.pattern, b'/', self.offset + 1)
            .unwrap_or(self.pattern.len());
        let text = &self.pattern[self.offset + 1..next_i];
        (Part::Text(text), text.len() + 1)
    }

    pub fn peek(&self) -> Option<Part<'a>> {
        if self.offset >= self.pattern.len() {
            return None;
        }
        Some(self.read_with_size().0)
    }
}

impl<'a> Iterator for StaticPatternIterator<'a> {
    type Item = Part<'a>;
    fn next(&mut self) -> Option<Part<'a>> {
        if self.offset >= self.pattern.len() {
            return None;
        }
        let (part, len) = self.read_with_size();
        self.offset += len;
        Some(part)
    }
}

/// A part of a URL pattern
#[derive(Copy, Clone)]
pub enum Part<'a> {
    /// Does not contain slashes. One per slash.
    Text(&'a [u8]),
    Param(&'a [u8]),
    /// Must be the last part of the pattern
    CatchAllOptional(&'a [u8]),
    /// Must be the last part of the pattern
    CatchAll(&'a [u8]),
    /// Does not affect URL matching, but does affect hierarchy.
    Group(&'a [u8]),
}

#[derive(Copy, Clone, Eq, PartialEq)]
#[repr(u8)]
enum PartTag {
    Text = 0,
    Param = 1,
    CatchAllOptional = 2,
    CatchAll = 3,
    Group = 4,
}

/// `packed struct(u32) { tag: u3, len: u29 }`
#[repr(transparent)]
#[derive(Copy, Clone)]
struct SerializedHeader(u32);

impl SerializedHeader {
    #[inline]
    fn new(tag: PartTag, len: u32) -> Self {
        debug_assert!(len < (1 << 29));
        Self((tag as u32) | (len << 3))
    }
    #[inline]
    fn tag(self) -> PartTag {
        // SAFETY: tag is written from PartTag, which is in range 0..=4
        unsafe { core::mem::transmute::<u8, PartTag>((self.0 & 0b111) as u8) }
    }
    #[inline]
    fn len(self) -> usize {
        (self.0 >> 3) as usize
    }
}

impl<'a> Part<'a> {
    #[inline]
    fn tag(&self) -> PartTag {
        match self {
            Part::Text(_) => PartTag::Text,
            Part::Param(_) => PartTag::Param,
            Part::CatchAllOptional(_) => PartTag::CatchAllOptional,
            Part::CatchAll(_) => PartTag::CatchAll,
            Part::Group(_) => PartTag::Group,
        }
    }

    #[inline]
    fn payload(&self) -> &'a [u8] {
        match *self {
            Part::Text(t)
            | Part::Param(t)
            | Part::CatchAllOptional(t)
            | Part::CatchAll(t)
            | Part::Group(t) => t,
        }
    }

    pub fn write_as_serialized(&self, writer: &mut impl bun_io::Write) -> Result<(), bun_core::Error> {
        if let Part::Text(text) = self {
            debug_assert!(!text.is_empty());
            debug_assert!(strings::index_of_char(text, b'/').is_none());
        }
        let payload = self.payload();
        let header = SerializedHeader::new(self.tag(), u32::try_from(payload.len()).unwrap());
        writer.write_all(&header.0.to_le_bytes())?;
        writer.write_all(payload)?;
        Ok(())
    }

    pub fn eql(&self, b: &Part<'_>) -> bool {
        if self.tag() != b.tag() {
            return false;
        }
        strings::eql(self.payload(), b.payload())
    }

    fn to_string_for_internal_use(&self, w: &mut impl fmt::Write) -> fmt::Result {
        match self {
            Part::Text(text) => write!(w, "/{}", bstr::BStr::new(text)),
            Part::Param(param_name) => write!(w, "/:{}", bstr::BStr::new(param_name)),
            Part::Group(label) => write!(w, "/({})", bstr::BStr::new(label)),
            Part::CatchAll(param_name) => write!(w, "/:*{}", bstr::BStr::new(param_name)),
            Part::CatchAllOptional(param_name) => write!(w, "/:*?{}", bstr::BStr::new(param_name)),
        }
    }
}

impl fmt::Display for Part<'_> {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str("Part \"")?;
        self.to_string_for_internal_use(f)?;
        f.write_str("\"")
    }
}

pub struct ParsedPattern<'a> {
    pub parts: &'a [Part<'a>],
    pub kind: ParsedPatternKind,
}

#[derive(Copy, Clone, Eq, PartialEq, strum::IntoStaticStr)]
pub enum ParsedPatternKind {
    /// Can be navigated to. Pages can have children, which allows having
    /// nested routes exactly how Remix allows them.
    #[strum(serialize = "page")]
    Page,
    /// Is not considered when resolving navigations, but is still a valid
    /// node in the route tree.
    #[strum(serialize = "layout")]
    Layout,
    /// Another file related to a route
    #[strum(serialize = "extra")]
    Extra,
}

pub enum Style {
    NextjsPages,
    NextjsAppUi,
    NextjsAppRoutes,
    JavascriptDefined(Strong),
}

pub static STYLE_MAP: phf::Map<&'static [u8], fn() -> Style> = phf::phf_map! {
    b"nextjs-pages" => || Style::NextjsPages,
    b"nextjs-app-ui" => || Style::NextjsAppUi,
    b"nextjs-app-routes" => || Style::NextjsAppRoutes,
};

pub const STYLE_ERROR_MESSAGE: &str =
    "'style' must be either \"nextjs-pages\", \"nextjs-app-ui\", \"nextjs-app-routes\", or a function.";

impl Style {
    // TODO(port): move to *_jsc — calls JSValue methods
    pub fn from_js(value: JSValue, global: &JSGlobalObject) -> JsResult<Style> {
        if value.is_string() {
            let bun_string = value.to_bun_string(global)?;
            // PERF(port): was stack-fallback allocator
            let utf8 = bun_string.to_utf8();
            if let Some(style) = STYLE_MAP.get(utf8.as_bytes()) {
                return Ok(style());
            }
        } else if value.is_callable() {
            return Ok(Style::JavascriptDefined(Strong::create(value, global)));
        }

        Err(global.throw_invalid_arguments(STYLE_ERROR_MESSAGE, &[]))
    }
}

#[derive(Copy, Clone, Eq, PartialEq, core::marker::ConstParamTy)]
pub enum UiOrRoutes {
    Ui,
    Routes,
}

#[derive(Copy, Clone, Eq, PartialEq, core::marker::ConstParamTy)]
enum NextRoutingConvention {
    App,
    Pages,
}

impl Style {
    pub fn parse<'bump>(
        &self,
        file_path: &'bump [u8],
        ext: &[u8],
        log: &mut TinyLog,
        allow_layouts: bool,
        arena: &'bump Arena,
    ) -> Result<Option<ParsedPattern<'bump>>, bun_core::Error> {
        debug_assert!(file_path[0] == b'/');

        match self {
            Style::NextjsPages => Self::parse_nextjs_pages(file_path, ext, log, allow_layouts, arena),
            Style::NextjsAppUi => {
                Self::parse_nextjs_app::<{ UiOrRoutes::Ui }>(file_path, ext, log, allow_layouts, arena)
            }
            Style::NextjsAppRoutes => {
                Self::parse_nextjs_app::<{ UiOrRoutes::Routes }>(file_path, ext, log, allow_layouts, arena)
            }

            // The strategy for this should be to collect a list of candidates,
            // then batch-call the javascript handler and collect all results.
            // This will avoid most of the back-and-forth native<->js overhead.
            Style::JavascriptDefined(_) => panic!("TODO: customizable Style"),
        }
    }

    /// Implements the pages router parser from Next.js:
    /// https://nextjs.org/docs/getting-started/project-structure#pages-routing-conventions
    pub fn parse_nextjs_pages<'bump>(
        file_path_raw: &'bump [u8],
        ext: &[u8],
        log: &mut TinyLog,
        allow_layouts: bool,
        arena: &'bump Arena,
    ) -> Result<Option<ParsedPattern<'bump>>, bun_core::Error> {
        let mut file_path = &file_path_raw[0..file_path_raw.len() - ext.len()];
        let mut kind = ParsedPatternKind::Page;
        if file_path.ends_with(b"/index") {
            file_path = &file_path[..file_path.len() - b"/index".len()];
        } else if allow_layouts && file_path.ends_with(b"/_layout") {
            file_path = &file_path[..file_path.len() - b"/_layout".len()];
            kind = ParsedPatternKind::Layout;
        }
        if file_path.is_empty() {
            return Ok(Some(ParsedPattern { kind, parts: &[] }));
        }
        let parts = Self::parse_nextjs_like_route_segment::<{ NextRoutingConvention::Pages }>(
            file_path_raw,
            file_path,
            log,
            arena,
        )?;
        Ok(Some(ParsedPattern { kind, parts }))
    }

    /// Implements the app router parser from Next.js:
    /// https://nextjs.org/docs/getting-started/project-structure#app-routing-conventions
    pub fn parse_nextjs_app<'bump, const EXTRACT: UiOrRoutes>(
        file_path_raw: &'bump [u8],
        ext: &[u8],
        log: &mut TinyLog,
        allow_layouts: bool,
        arena: &'bump Arena,
    ) -> Result<Option<ParsedPattern<'bump>>, bun_core::Error> {
        let without_ext = &file_path_raw[0..file_path_raw.len() - ext.len()];
        let basename = paths::basename(without_ext);
        let Some(loader) = bun_bundler::options::Loader::from_string(ext) else {
            return Ok(None);
        };

        // TODO: opengraph-image and metadata friends
        if !loader.is_javascript_like() {
            return Ok(None);
        }

        static UI_MAP: phf::Map<&'static [u8], ParsedPatternKind> = phf::phf_map! {
            b"page" => ParsedPatternKind::Page,
            b"layout" => ParsedPatternKind::Layout,
            b"default" => ParsedPatternKind::Extra,
            b"template" => ParsedPatternKind::Extra,
            b"error" => ParsedPatternKind::Extra,
            b"loading" => ParsedPatternKind::Extra,
            b"not-found" => ParsedPatternKind::Extra,
        };
        static ROUTES_MAP: phf::Map<&'static [u8], ParsedPatternKind> = phf::phf_map! {
            b"route" => ParsedPatternKind::Page,
        };
        let map = match EXTRACT {
            UiOrRoutes::Ui => &UI_MAP,
            UiOrRoutes::Routes => &ROUTES_MAP,
        };
        let Some(&kind) = map.get(basename) else {
            return Ok(None);
        };

        if kind == ParsedPatternKind::Layout && !allow_layouts {
            return Ok(None);
        }

        let dirname = paths::dirname(without_ext, paths::Platform::Posix);
        if dirname.len() <= 1 {
            return Ok(Some(ParsedPattern { kind, parts: &[] }));
        }
        let parts = Self::parse_nextjs_like_route_segment::<{ NextRoutingConvention::App }>(
            file_path_raw,
            dirname,
            log,
            arena,
        )?;
        Ok(Some(ParsedPattern { kind, parts }))
    }

    fn parse_nextjs_like_route_segment<'bump, const CONVENTIONS: NextRoutingConvention>(
        raw_input: &'bump [u8],
        route_segment: &'bump [u8],
        log: &mut TinyLog,
        arena: &'bump Arena,
    ) -> Result<&'bump [Part<'bump>], bun_core::Error> {
        let mut i: usize = 1;
        let mut parts: bumpalo::collections::Vec<'bump, Part<'bump>> =
            bumpalo::collections::Vec::new_in(arena);
        let stop_chars: &[u8] = match CONVENTIONS {
            NextRoutingConvention::Pages => b"[",
            NextRoutingConvention::App => b"[(@",
        };
        while let Some(start) = strings::index_of_any_pos(route_segment, stop_chars, i) {
            if matches!(CONVENTIONS, NextRoutingConvention::Pages) || route_segment[start] == b'[' {
                let mut end = match strings::index_of_char_pos(route_segment, b']', start + 1) {
                    Some(e) => e,
                    None => {
                        return Err(log
                            .fail(
                                format_args!("Missing \"]\" to match this route parameter"),
                                start,
                                raw_input.len() - start,
                            )
                            .into())
                    }
                };

                let is_optional = route_segment[start + 1] == b'[';

                let param_content = &route_segment[start + 1 + (is_optional as usize)..end];

                let mut has_ending_double_bracket = false;
                if end + 1 < route_segment.len() && route_segment[end + 1] == b']' {
                    end += 1;
                    has_ending_double_bracket = true;
                }
                let len = end - start + 1;

                let is_catch_all = param_content.starts_with(b"...");
                let param_name = if is_catch_all {
                    &param_content[3..]
                } else {
                    param_content
                };

                if param_name.is_empty() {
                    return Err(log
                        .fail(format_args!("Parameter needs a name"), start, len)
                        .into());
                }
                if param_name[0] == b'.' {
                    return Err(log
                        .fail(
                            format_args!(
                                "Parameter name cannot start with \".\" (use \"...\" for catch-all)"
                            ),
                            start,
                            len,
                        )
                        .into());
                }
                if is_optional && !is_catch_all {
                    return Err(log
                        .fail(
                            format_args!(
                                "Optional parameters can only be catch-all (change to \"[[...{}]]\" or remove extra brackets)",
                                bstr::BStr::new(param_name)
                            ),
                            start,
                            len,
                        )
                        .into());
                }
                // Potential future proofing
                if let Some(bad_char_index) = strings::index_of_any(param_name, b"?*{}()=:#,") {
                    return Err(log
                        .fail(
                            format_args!(
                                "Parameter name cannot contain \"{}\"",
                                param_name[bad_char_index] as char
                            ),
                            start + bad_char_index,
                            1,
                        )
                        .into());
                }

                if has_ending_double_bracket && !is_optional {
                    return Err(log
                        .fail(format_args!("Extra \"]\" in route parameter"), end, 1)
                        .into());
                } else if !has_ending_double_bracket && is_optional {
                    return Err(log
                        .fail(
                            format_args!("Missing second \"]\" to close optional route parameter"),
                            end,
                            1,
                        )
                        .into());
                }

                if route_segment[start - 1] != b'/'
                    || (end + 1 < route_segment.len() && route_segment[end + 1] != b'/')
                {
                    return Err(log
                        .fail(
                            format_args!("Parameters must take up the entire file name"),
                            start,
                            len,
                        )
                        .into());
                }

                if is_catch_all && route_segment.len() != end + 1 {
                    return Err(log
                        .fail(
                            format_args!("Catch-all parameter must be at the end of a route"),
                            start,
                            len,
                        )
                        .into());
                }

                let between = &route_segment[i..start];
                for part in between.split(|b| *b == b'/').filter(|s| !s.is_empty()) {
                    parts.push(Part::Text(part));
                }
                parts.push(if is_optional {
                    Part::CatchAllOptional(param_name)
                } else if is_catch_all {
                    Part::CatchAll(param_name)
                } else {
                    Part::Param(param_name)
                });

                i = end + 1;
            } else if route_segment[start] == b'(' {
                let end = match strings::index_of_char_pos(route_segment, b')', start + 1) {
                    Some(e) => e,
                    None => {
                        return Err(log
                            .fail(
                                format_args!("Missing \")\" to match this route group"),
                                start,
                                raw_input.len() - start,
                            )
                            .into())
                    }
                };

                let len = end - start + 1;

                let group_name = &route_segment[start + 1..end];
                if group_name.starts_with(b".") {
                    return Err(log
                        .fail(
                            format_args!(
                                "Bun Bake currently does not support named slots and intercepted routes"
                            ),
                            start,
                            len,
                        )
                        .into());
                }

                if route_segment[start - 1] != b'/'
                    || (end + 1 < route_segment.len() && route_segment[end + 1] != b'/')
                {
                    return Err(log
                        .fail(
                            format_args!("Route group marker must take up the entire file name"),
                            start,
                            len,
                        )
                        .into());
                }

                let between = &route_segment[i..start];
                for part in between.split(|b| *b == b'/').filter(|s| !s.is_empty()) {
                    parts.push(Part::Text(part));
                }
                parts.push(Part::Group(group_name));

                i = end + 1;
            } else if route_segment[start] == b'@' {
                let end = strings::index_of_char_pos(route_segment, b')', start + 1)
                    .unwrap_or(route_segment.len());
                let len = end - start + 1;
                return Err(log
                    .fail(
                        format_args!(
                            "Bun Bake currently does not support named slots and intercepted routes"
                        ),
                        start,
                        len,
                    )
                    .into());
            }
        }
        if !route_segment[i..].is_empty() {
            for part in route_segment[i..].split(|b| *b == b'/').filter(|s| !s.is_empty()) {
                parts.push(Part::Text(part));
            }
        }
        Ok(parts.into_bump_slice())
    }
}

#[derive(thiserror::Error, Debug, strum::IntoStaticStr)]
pub enum InsertError {
    #[error("RouteCollision")]
    RouteCollision,
    #[error("OutOfMemory")]
    OutOfMemory,
}
impl From<AllocError> for InsertError {
    fn from(_: AllocError) -> Self {
        InsertError::OutOfMemory
    }
}

#[derive(Copy, Clone, Eq, PartialEq)]
pub enum InsertKind {
    Static,
    Dynamic,
}

// PERF(port): Zig used `comptime insertion_kind` with dependent type `insertion_kind.Pattern()`.
// Rust models this as a runtime enum carrying both pattern shapes; profile in Phase B.
pub enum InsertPattern {
    Static(StaticPattern),
    Dynamic(EncodedPattern),
}

impl InsertPattern {
    fn next_part<'a>(
        &'a self,
        static_it: &mut Option<StaticPatternIterator<'a>>,
        dynamic_it: &mut Option<EncodedPatternIterator<'a>>,
    ) -> Option<Part<'a>> {
        match self {
            InsertPattern::Static(_) => static_it.as_mut().unwrap().next(),
            InsertPattern::Dynamic(_) => dynamic_it.as_mut().unwrap().next(),
        }
    }
}

impl FrameworkRouter {
    /// Insert a new file, potentially creating a Route for that file.
    /// Moves ownership of EncodedPattern into the FrameworkRouter.
    ///
    /// This function is designed so that any insertion order will create an
    /// equivalent routing tree, but it does not guarantee that route indices
    /// would match up if a different insertion order was picked.
    pub fn insert(
        &mut self,
        ty: TypeIndex,
        pattern: InsertPattern,
        file_kind: FileKind,
        file_path: &[u8],
        ctx: &mut dyn InsertionHandler,
        /// When `InsertError::RouteCollision` is returned, this is set to the existing file index.
        out_colliding_file_id: &mut OpaqueFileId,
    ) -> Result<(), InsertError> {
        // The root route is the index of the type
        let root_route = Type::root_route_index(ty);

        // Set up iterators (one will be None depending on pattern variant)
        let (mut static_it, mut dynamic_it) = match &pattern {
            InsertPattern::Static(p) => (Some(p.iterate()), None),
            InsertPattern::Dynamic(p) => (None, Some(p.iterate())),
        };
        let mut next_part =
            |s: &mut Option<StaticPatternIterator<'_>>, d: &mut Option<EncodedPatternIterator<'_>>| {
                if let Some(it) = s {
                    it.next()
                } else {
                    d.as_mut().unwrap().next()
                }
            };

        let new_route_index: RouteIndex = 'brk: {
            let Some(mut current_part) = next_part(&mut static_it, &mut dynamic_it) else {
                break 'brk root_route;
            };

            let mut route_index = root_route;
            // PORT NOTE: reshaped for borrowck — Zig held `route: *Route`; we re-fetch via index.
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
                    part: current_part.to_owned_part(),
                    r#type: ty,
                    parent: route_index.to_optional(),
                    first_child: None,
                    prev_sibling: next,
                    next_sibling: None,
                    file_page: None,
                    file_layout: None,
                    bundle: RouteBundleIndexOptional::none(),
                })?;

                if let Some(attach) = next {
                    self.route_ptr_mut(attach).next_sibling = new_route_index.to_optional();
                } else {
                    self.route_ptr_mut(route_index).first_child = new_route_index.to_optional();
                }

                // Build each part out as another node in the routing graph. This makes
                // inserting routes simpler to implement, but could technically be avoided.
                while let Some(next_part_val) = next_part(&mut static_it, &mut dynamic_it) {
                    let newer_route_index = self.new_route(Route {
                        part: next_part_val.to_owned_part(),
                        r#type: ty,
                        parent: new_route_index.to_optional(),
                        first_child: None,
                        prev_sibling: next,
                        next_sibling: None,
                        file_page: None,
                        file_layout: None,
                        bundle: RouteBundleIndexOptional::none(),
                    })?;
                    self.route_ptr_mut(new_route_index).first_child =
                        newer_route_index.to_optional();
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
        *new_route.file_ptr(file_kind) = file_id.to_optional();

        if file_kind == FileKind::Page {
            match pattern {
                InsertPattern::Static(p) => {
                    let key: &[u8] = if p.route_path().is_empty() {
                        b"/"
                    } else {
                        p.route_path()
                    };
                    let gop = self.static_routes.get_or_put(key)?;
                    if gop.found_existing {
                        panic!("TODO: propagate aliased route error");
                    }
                    *gop.value_ptr = new_route_index;
                }
                InsertPattern::Dynamic(p) => {
                    let gop = self.dynamic_routes.get_or_put(p)?;
                    if gop.found_existing {
                        panic!("TODO: propagate aliased route error");
                    }
                    *gop.value_ptr = new_route_index;
                }
            }
        }
        Ok(())
    }
}

// TODO(port): lifetime — Part stored in Route borrows from pattern_string_arena.
// Zig stored borrowed slices; here we keep raw slices via the same arena. The
// `to_owned_part` helper exists to detach the borrow lifetime when stored in `Route`.
impl<'a> Part<'a> {
    fn to_owned_part(self) -> Part<'static> {
        // SAFETY: payload points into pattern_string_arena which lives as long as FrameworkRouter.
        // We erase the lifetime to store inside `Route`. Phase B should model this with `'bump`.
        unsafe { core::mem::transmute::<Part<'a>, Part<'static>>(self) }
    }
}

/// An enforced upper bound of 64 unique patterns allows routing to use no heap allocation
pub struct MatchedParams {
    pub params: BoundedArray<MatchedParamEntry, { MatchedParams::MAX_COUNT }>,
}

#[derive(Copy, Clone)]
pub struct MatchedParamEntry {
    // TODO(port): lifetime — these borrow from the input path/pattern; Zig used []const u8.
    pub key: *const [u8],
    pub value: *const [u8],
}

impl MatchedParams {
    pub const MAX_COUNT: usize = 64;

    /// Convert the matched params to a JavaScript object
    /// Returns null if there are no params
    // TODO(port): move to *_jsc
    pub fn to_js(&self, global: &JSGlobalObject) -> JSValue {
        let params_array = self.params.slice();

        if params_array.is_empty() {
            return JSValue::NULL;
        }

        // Create a JavaScript object with params
        let obj = JSValue::create_empty_object(global, params_array.len());
        for param in params_array {
            // SAFETY: key/value point into live path/pattern buffers for the duration of this call
            let (key, value) = unsafe { (&*param.key, &*param.value) };
            let key_str = bun_str::String::clone_utf8(key);
            let value_str = bun_str::String::clone_utf8(value);

            obj.put_bun_string_one_or_array(global, &key_str, value_str.to_js(global).expect("unreachable"))
                .expect("unreachable");
        }
        obj
    }
}

impl FrameworkRouter {
    /// Fast enough for development to be seamless, but avoids building a
    /// complicated data structure that production uses to efficiently map
    /// urls to routes instead of this tree-traversal algorithm.
    pub fn match_slow(&self, path: &[u8], params: &mut MatchedParams) -> Option<RouteIndex> {
        params.params = BoundedArray::default();

        debug_assert!(path[0] == b'/');
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

    pub fn route_ptr(&self, i: RouteIndex) -> &Route {
        &self.routes[i.get() as usize]
    }

    pub fn route_ptr_mut(&mut self, i: RouteIndex) -> &mut Route {
        &mut self.routes[i.get() as usize]
    }

    pub fn type_ptr(&mut self, i: TypeIndex) -> &mut Type {
        &mut self.types[i.get() as usize]
    }

    fn new_route(&mut self, route_data: Route) -> Result<RouteIndex, AllocError> {
        let i = self.routes.len();
        self.routes.push(route_data);
        Ok(RouteIndex::init(u32::try_from(i).unwrap()))
    }

    // TODO(port): `newEdge` references `fr.freed_edges`/`fr.edges`/`Route.Edge` which do not exist
    // on FrameworkRouter in the source — appears to be dead code in the Zig. Ported verbatim with stubs.
    #[allow(dead_code)]
    fn new_edge(&mut self, _edge_data: ()) -> Result<(), AllocError> {
        // if let Some(i) = self.freed_edges.pop() {
        //     self.edges[i.get()] = edge_data;
        //     return Ok(i);
        // } else {
        //     let i = self.edges.len();
        //     self.edges.push(edge_data);
        //     return Ok(RouteEdgeIndex::init(i));
        // }
        unimplemented!("dead code in source — Route.Edge undefined")
    }
}

#[derive(thiserror::Error, Debug, strum::IntoStaticStr)]
pub enum PatternParseError {
    #[error("InvalidRoutePattern")]
    InvalidRoutePattern,
}

const TINY_LOG_CAP: usize = 512 + if MAX_PATH_BYTES < 4096 { MAX_PATH_BYTES } else { 4096 };

/// Non-allocating single message log, specialized for the messages from the route pattern parsers.
/// DevServer uses this to special-case the printing of these messages to highlight the offending part of the filename
pub struct TinyLog {
    pub msg: BoundedArray<u8, TINY_LOG_CAP>,
    pub cursor_at: u32,
    pub cursor_len: u32,
}

impl TinyLog {
    pub const fn empty() -> TinyLog {
        TinyLog {
            cursor_at: u32::MAX,
            cursor_len: 0,
            msg: BoundedArray::new(),
        }
    }

    pub fn fail(
        &mut self,
        args: fmt::Arguments<'_>,
        cursor_at: usize,
        cursor_len: usize,
    ) -> PatternParseError {
        self.write(args);
        self.cursor_at = u32::try_from(cursor_at).unwrap();
        self.cursor_len = u32::try_from(cursor_len).unwrap();
        PatternParseError::InvalidRoutePattern
    }

    pub fn write(&mut self, args: fmt::Arguments<'_>) {
        use std::io::Write as _;
        let buf = self.msg.buffer_mut();
        let mut cursor: &mut [u8] = buf;
        let len = match cursor.write_fmt(args) {
            Ok(()) => buf.len() - cursor.len(),
            Err(_) => {
                // truncation should never happen because the buffer is HUGE. handle it anyways
                let n = buf.len();
                buf[n - 3..].copy_from_slice(b"...");
                n
            }
        };
        self.msg.set_len(u32::try_from(len).unwrap());
    }

    pub fn print(&self, rel_path: &[u8]) {
        let cursor_at = self.cursor_at as usize;
        let cursor_len = self.cursor_len as usize;
        let after = &rel_path[cursor_at.max(0)..];
        Output::err_generic(format_args!(
            "\"{}<blue>{}<r>{}\" is not a valid route",
            bstr::BStr::new(&rel_path[0..cursor_at.max(0)]),
            bstr::BStr::new(&after[0..cursor_len.min(after.len())]),
            bstr::BStr::new(&after[cursor_len.min(after.len())..]),
        ));
        let mut w = Output::error_writer_buffered();
        if w.splat_byte_all(b' ', "error: \"".len() + cursor_at).is_err() {
            return;
        }
        if Output::enable_ansi_colors_stderr() {
            let symbols = bun_core::fmt::TableSymbols::UNICODE;
            Output::pretty_error(format_args!("<blue>{}", symbols.top_column_sep()));
            if cursor_len > 1 {
                if w.splat_bytes_all(symbols.horizontal_edge(), cursor_len - 1).is_err() {
                    return;
                }
            }
        } else {
            if cursor_len <= 1 {
                if w.write_all(b"|").is_err() {
                    return;
                }
            } else {
                if w.splat_byte_all(b'-', cursor_len - 1).is_err() {
                    return;
                }
            }
        }
        if w.write_byte(b'\n').is_err() {
            return;
        }
        if w.splat_byte_all(b' ', "error: \"".len() + cursor_at).is_err() {
            return;
        }
        if w.write_all(self.msg.slice()).is_err() {
            return;
        }
        Output::pretty_error(format_args!("<r>\n"));
        Output::flush();
    }
}

/// Interface for connecting FrameworkRouter to another codebase
// PORT NOTE: Zig's `InsertionContext` was an `*anyopaque` + `*const VTable` pair, with `wrap()`
// generating a comptime vtable per concrete type. Per LIFETIMES.tsv this is BORROW_PARAM →
// `&mut dyn InsertionHandler`. The trait below replaces the manual vtable.
pub trait InsertionHandler {
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

impl FrameworkRouter {
    pub fn scan(
        &mut self,
        ty: TypeIndex,
        r: &mut Resolver,
        ctx: &mut dyn InsertionHandler,
    ) -> Result<(), AllocError> {
        // PORT NOTE: reshaped for borrowck — Zig held `t: *const Type`; we re-fetch via index.
        let abs_root: Box<[u8]> = self.types[ty.get() as usize].abs_root.clone();
        debug_assert!(!abs_root.ends_with(b"/"));
        debug_assert!(paths::is_absolute(&abs_root));
        let Some(root_info) = r.read_dir_info_ignore_error(&abs_root) else {
            return Ok(());
        };
        let mut arena_state = Arena::new();
        self.scan_inner(ty, r, root_info, &mut arena_state, ctx)
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
        // TODO(port): fs_impl = &fs.fs — resolver internals

        if let Some(entries) = dir_info.get_entries_const() {
            let mut it = entries.data.iter();
            'outer: while let Some(entry) = it.next() {
                let file = entry.value();
                let base = file.base();
                // PORT NOTE: reshaped for borrowck — fetch type fields fresh each iteration.
                match file.kind(fs.fs(), false) {
                    bun_fs::EntryKind::Dir => {
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
                            r.read_dir_info_ignore_error(fs.abs(&[file.dir(), file.base()]))
                        {
                            self.scan_inner(t_index, r, child_info, arena_state, ctx)?;
                        }
                    }
                    bun_fs::EntryKind::File => {
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

                        let mut rel_path_buf = PathBuffer::uninit();
                        let full_rel_path_len = {
                            let full_rel_path = paths::relative_normalized_buf(
                                &mut rel_path_buf[1..],
                                &self.root,
                                fs.abs(&[file.dir(), file.base()]),
                                paths::Platform::Auto,
                                true,
                            );
                            full_rel_path.len()
                        };
                        rel_path_buf[0] = b'/';
                        paths::platform_to_posix_in_place(&mut rel_path_buf[0..full_rel_path_len]);

                        let t = &self.types[t_index.get() as usize];
                        let abs_root_len = t.abs_root.len();
                        let root_len = self.root.len();
                        let full_rel_path = &rel_path_buf[1..1 + full_rel_path_len];
                        let rel_path: &[u8] = if abs_root_len == root_len {
                            &rel_path_buf[0..full_rel_path_len + 1]
                        } else {
                            &full_rel_path[abs_root_len - root_len - 1..]
                        };

                        let mut log = TinyLog::empty();
                        // defer arena_state.reset(.retain_capacity) — handled at end of arm
                        let parse_result =
                            t.style.parse(rel_path, ext, &mut log, t.allow_layouts, arena_state);
                        let parsed = match parse_result {
                            Err(_) => {
                                log.cursor_at += u32::try_from(abs_root_len - root_len).unwrap();
                                ctx.on_router_syntax_error(full_rel_path, log)?;
                                arena_state.reset();
                                continue 'outer;
                            }
                            Ok(None) => {
                                arena_state.reset();
                                continue 'outer;
                            }
                            Ok(Some(p)) => p,
                        };

                        if parsed.kind == ParsedPatternKind::Page
                            && t.ignore_underscores
                            && base.starts_with(b"_")
                        {
                            arena_state.reset();
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
                            ctx.on_router_syntax_error(full_rel_path, log)?;
                            arena_state.reset();
                            continue 'outer;
                        }

                        let mut out_colliding_file_id = OpaqueFileId(0);

                        let file_kind: FileKind = match parsed.kind {
                            ParsedPatternKind::Page => FileKind::Page,
                            ParsedPatternKind::Layout => FileKind::Layout,
                            ParsedPatternKind::Extra => {
                                panic!("TODO: associate extra files with route")
                            }
                        };

                        // PERF(port): was comptime bool dispatch on `param_count > 0` — profile in Phase B
                        let result = if param_count > 0 {
                            let pattern = EncodedPattern::init_from_parts(
                                parsed.parts,
                                &self.pattern_string_arena,
                            )?;
                            self.insert(
                                t_index,
                                InsertPattern::Dynamic(pattern),
                                file_kind,
                                fs.abs(&[file.dir(), file.base()]),
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
                                route_path: &*allocation as *const [u8],
                            };
                            self.insert(
                                t_index,
                                InsertPattern::Static(pattern),
                                file_kind,
                                fs.abs(&[file.dir(), file.base()]),
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

                        arena_state.reset();
                    }
                }
            }
        }
        Ok(())
    }
}

// ───────────────────────────────────────────────────────────────────────────
// JSFrameworkRouter — .classes.ts payload
// ───────────────────────────────────────────────────────────────────────────

/// This binding is currently only intended for testing FrameworkRouter, and not
/// production usage. It uses a slower but easier to use pattern for object
/// creation. A production-grade JS api would be able to re-use objects.
#[bun_jsc::JsClass]
pub struct JSFrameworkRouter {
    pub files: Vec<bun_str::String>,
    pub router: FrameworkRouter,
    pub stored_parse_errors: Vec<StoredParseError>,
}

pub struct StoredParseError {
    /// Owned by global allocator
    pub rel_path: Box<[u8]>,
    pub log: TinyLog,
}

// TODO(port): jsc.Codegen.JSFrameworkFileSystemRouter — codegen wires toJS/fromJS via #[bun_jsc::JsClass]

impl JSFrameworkRouter {
    #[bun_jsc::host_fn]
    pub fn get_bindings(global: &JSGlobalObject) -> JsResult<JSValue> {
        // TODO(port): jsc.JSObject.create with struct literal — needs builder API
        let obj = bun_jsc::JSObject::create_empty(global, 2)?;
        obj.put(
            global,
            "parseRoutePattern",
            bun_jsc::JSFunction::create(global, "parseRoutePattern", Self::parse_route_pattern, 1),
        );
        obj.put(global, "FrameworkRouter", Self::js_get_constructor(global));
        Ok(obj.to_js())
    }

    #[bun_jsc::host_fn]
    pub fn constructor(
        global: &JSGlobalObject,
        callframe: &CallFrame,
    ) -> JsResult<Box<JSFrameworkRouter>> {
        let opts = callframe.arguments_as_array::<1>()[0];
        if !opts.is_object() {
            return Err(global.throw_invalid_arguments(
                "FrameworkRouter needs an object as it's first argument",
                &[],
            ));
        }

        let Some(root) = opts.get_optional::<bun_str::Slice>(global, "root")? else {
            return Err(global.throw_invalid_arguments("Missing options.root", &[]));
        };

        let style = Style::from_js(
            opts.get_optional::<JSValue>(global, "style")?
                .unwrap_or(JSValue::UNDEFINED),
            global,
        )?;
        // Zig's `errdefer style.deinit()` is implicit: `Style` owns a `Strong` (Drop type),
        // so `?` on any error path below drops it automatically.

        let abs_root: Box<[u8]> = strings::without_trailing_slash(paths::join_abs(
            bun_fs::FileSystem::instance().top_level_dir(),
            paths::Platform::Auto,
            root.slice(),
        ))
        .into();

        let types: Box<[Type]> = Box::new([Type {
            abs_root: abs_root.clone(),
            ignore_underscores: false,
            extensions: Box::new([
                b".tsx".as_slice().into(),
                b".ts".as_slice().into(),
                b".jsx".as_slice().into(),
                b".js".as_slice().into(),
            ]),
            style,
            allow_layouts: true,
            // Unused by JSFrameworkRouter
            client_file: None,
            server_file: OpaqueFileId(0),
            server_file_string: Strong::empty(),
            ..Default::default()
        }]);

        let mut jsfr = Box::new(JSFrameworkRouter {
            router: FrameworkRouter::init_empty(&abs_root, types)?,
            files: Vec::new(),
            stored_parse_errors: Vec::new(),
        });

        jsfr.router.scan(
            TypeIndex::init(0),
            &mut global.bun_vm().transpiler.resolver,
            &mut *jsfr as &mut dyn InsertionHandler,
            // TODO(port): borrowck — `jsfr.router` and `jsfr` both borrowed; needs reshape (split fields)
        )?;
        if !jsfr.stored_parse_errors.is_empty() {
            let arr = JSValue::create_empty_array(global, jsfr.stored_parse_errors.len())?;
            for (i, item) in jsfr.stored_parse_errors.iter().enumerate() {
                arr.put_index(
                    global,
                    u32::try_from(i).unwrap(),
                    global.create_error_instance(format_args!(
                        "Invalid route {}: {}",
                        bun_core::fmt::quote(&item.rel_path),
                        bstr::BStr::new(item.log.msg.slice()),
                    )),
                )?;
            }
            return Err(global.throw_value(
                global.create_aggregate_error_with_array(
                    bun_str::String::static_str("Errors scanning routes"),
                    arr,
                )?,
            ));
        }

        Ok(jsfr)
    }

    #[bun_jsc::host_fn(method)]
    pub fn r#match(
        &mut self,
        global: &JSGlobalObject,
        callframe: &CallFrame,
    ) -> JsResult<JSValue> {
        let path_value = callframe.arguments_as_array::<1>()[0];
        let path = path_value.to_slice(global)?;

        let mut params_out = MatchedParams {
            params: BoundedArray::default(),
        };
        if let Some(index) = self.router.match_slow(path.slice(), &mut params_out) {
            // PERF(port): was stack-fallback allocator
            let obj = bun_jsc::JSObject::create_empty(global, 2)?;
            obj.put(
                global,
                "params",
                if params_out.params.len() > 0 {
                    let params_obj =
                        JSValue::create_empty_object(global, params_out.params.len() as usize);
                    for param in params_out.params.slice() {
                        // SAFETY: key/value borrow from `path`/pattern, both live here
                        let (key, value) = unsafe { (&*param.key, &*param.value) };
                        let value_str = bun_str::String::clone_utf8(value);
                        params_obj.put_bytes(global, key, value_str.to_js(global)?);
                    }
                    params_obj
                } else {
                    JSValue::NULL
                },
            );
            obj.put(global, "route", self.route_to_json_inverse(global, index)?);
            return Ok(obj.to_js());
        }

        Ok(JSValue::NULL)
    }

    #[bun_jsc::host_fn(method)]
    pub fn to_json(&mut self, global: &JSGlobalObject, _callframe: &CallFrame) -> JsResult<JSValue> {
        // PERF(port): was stack-fallback allocator
        self.route_to_json(global, RouteIndex::init(0))
    }

    fn route_to_json(&self, global: &JSGlobalObject, route_index: RouteIndex) -> JsResult<JSValue> {
        let route = self.router.route_ptr(route_index);
        let obj = bun_jsc::JSObject::create_empty(global, 4)?;
        obj.put(global, "part", Self::part_to_js(global, &route.part)?);
        obj.put(global, "page", self.file_id_to_js(global, route.file_page)?);
        obj.put(global, "layout", self.file_id_to_js(global, route.file_layout)?);
        // obj.put(global, "notFound", self.file_id_to_js(global, route.file_not_found)?);
        obj.put(global, "children", {
            let mut len: usize = 0;
            let mut next = route.first_child;
            while let Some(r) = next {
                next = self.router.route_ptr(r).next_sibling;
                len += 1;
            }
            let arr = JSValue::create_empty_array(global, len)?;
            next = route.first_child;
            let mut i: u32 = 0;
            while let Some(r) = next {
                arr.put_index(global, i, self.route_to_json(global, r)?)?;
                next = self.router.route_ptr(r).next_sibling;
                i += 1;
            }
            arr
        });
        Ok(obj.to_js())
    }

    fn route_to_json_inverse(
        &self,
        global: &JSGlobalObject,
        route_index: RouteIndex,
    ) -> JsResult<JSValue> {
        let route = self.router.route_ptr(route_index);
        let obj = bun_jsc::JSObject::create_empty(global, 4)?;
        obj.put(global, "part", Self::part_to_js(global, &route.part)?);
        obj.put(global, "page", self.file_id_to_js(global, route.file_page)?);
        obj.put(global, "layout", self.file_id_to_js(global, route.file_layout)?);
        // obj.put(global, "notFound", self.file_id_to_js(global, route.file_not_found)?);
        obj.put(
            global,
            "parent",
            if let Some(parent) = route.parent {
                self.route_to_json_inverse(global, parent)?
            } else {
                JSValue::NULL
            },
        );
        Ok(obj.to_js())
    }

    pub fn finalize(this: *mut Self) {
        // SAFETY: called once by JSC sweep on the mutator thread; `this` is the m_ctx payload.
        let this = unsafe { Box::from_raw(this) };
        drop(this);
        // files, router, stored_parse_errors freed by Drop.
    }

    #[bun_jsc::host_fn]
    pub fn parse_route_pattern(global: &JSGlobalObject, frame: &CallFrame) -> JsResult<JSValue> {
        // PERF(port): was arena bulk-free
        let arena = Arena::new();

        if frame.arguments_count() < 2 {
            return Err(
                global.throw_invalid_arguments("parseRoutePattern takes two arguments", &[])
            );
        }

        let [style_js, filepath_js] = frame.arguments_as_array::<2>();
        let filepath = filepath_js.to_slice(global)?;
        let style = Style::from_js(style_js, global)?;
        // errdefer style.deinit() — Drop handles this

        let mut log = TinyLog::empty();
        let parsed = match style.parse(
            filepath.slice(),
            paths::extension(filepath.slice()),
            &mut log,
            true,
            &arena,
        ) {
            Err(e) if e == bun_core::err!("InvalidRoutePattern") => {
                return Err(global.throw(format_args!(
                    "{} ({}:{})",
                    bstr::BStr::new(log.msg.slice()),
                    log.cursor_at,
                    log.cursor_len
                )));
            }
            Err(e) => return Err(e.into()),
            Ok(None) => return Ok(JSValue::NULL),
            Ok(Some(p)) => p,
        };

        let mut rendered: Vec<u8> = Vec::with_capacity(filepath.slice().len());
        for part in parsed.parts {
            use fmt::Write as _;
            // TODO(port): writing fmt into Vec<u8> — needs adapter (bstr or io::Write)
            part.to_string_for_internal_use(&mut bun_str::ByteFmtWriter::new(&mut rendered))?;
        }

        let mut out = bun_str::String::init(&rendered);
        let obj = JSValue::create_empty_object(global, 2);
        obj.put(
            global,
            "kind",
            bun_str::String::static_str(<&'static str>::from(parsed.kind)).to_js(global)?,
        );
        obj.put(global, "pattern", out.transfer_to_js(global)?);
        Ok(obj)
    }

    fn encoded_pattern_to_js(
        global: &JSGlobalObject,
        pattern: &EncodedPattern,
    ) -> JsResult<JSValue> {
        let mut rendered: Vec<u8> = Vec::with_capacity(pattern.data().len());
        let mut it = pattern.iterate();
        while let Some(part) = it.next() {
            use fmt::Write as _;
            part.to_string_for_internal_use(&mut bun_str::ByteFmtWriter::new(&mut rendered))?;
        }
        let mut str = bun_str::String::clone_utf8(&rendered);
        str.transfer_to_js(global)
    }

    fn part_to_js(global: &JSGlobalObject, part: &Part<'_>) -> JsResult<JSValue> {
        let mut rendered: Vec<u8> = Vec::new();
        use fmt::Write as _;
        part.to_string_for_internal_use(&mut bun_str::ByteFmtWriter::new(&mut rendered))?;
        let mut str = bun_str::String::clone_utf8(&rendered);
        str.transfer_to_js(global)
    }

    pub fn file_id_to_js(
        &self,
        global: &JSGlobalObject,
        id: OpaqueFileIdOptional,
    ) -> JsResult<JSValue> {
        let Some(id) = id else {
            return Ok(JSValue::NULL);
        };
        self.files[id.get() as usize].to_js(global)
    }
}

impl InsertionHandler for JSFrameworkRouter {
    fn get_file_id_for_router(
        &mut self,
        abs_path: &[u8],
        _: RouteIndex,
        _: FileKind,
    ) -> Result<OpaqueFileId, AllocError> {
        self.files.push(bun_str::String::clone_utf8(abs_path));
        Ok(OpaqueFileId::init(
            u32::try_from(self.files.len() - 1).unwrap(),
        ))
    }

    fn on_router_syntax_error(&mut self, rel_path: &[u8], log: TinyLog) -> Result<(), AllocError> {
        let rel_path_dupe: Box<[u8]> = rel_path.into();
        self.stored_parse_errors.push(StoredParseError {
            rel_path: rel_path_dupe,
            log,
        });
        Ok(())
    }

    fn on_router_collision_error(
        &mut self,
        _rel_path: &[u8],
        _other_id: OpaqueFileId,
        _file_kind: FileKind,
    ) -> Result<(), AllocError> {
        // TODO(port): Zig's wrap() panics if onRouterCollisionError is undeclared on T.
        // JSFrameworkRouter does NOT define it, so this would have panicked at comptime in Zig.
        panic!("TODO: onRouterCollisionError for JSFrameworkRouter")
    }
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/bake/FrameworkRouter.zig (1399 lines)
//   confidence: medium
//   todos:      15
//   notes:      Part<'a> stored in Route via lifetime erasure (arena-backed); insert() comptime-dependent pattern type collapsed to runtime enum; InsertionContext vtable → trait object; constructor has borrowck conflict (router+self); newEdge is dead code (Route.Edge undefined in source).
// ──────────────────────────────────────────────────────────────────────────
