//! `Bun.FileSystemRouter` / `MatchedRoute` — Next.js-style file router.

use core::cell::OnceCell;

use bun_paths::strings;

use bun_ast as Log;
use bun_core::{Utf8Bytes, WTFString};
use bun_jsc::bindgen::{self, JsHeap, JsLocal, JsPayload as _, JsScope, JsWrapper, to_js};
use bun_jsc::virtual_machine::VirtualMachine;
use bun_jsc::{JSGlobalObject, JSValue, JsCell, JsResult, LogJsc};
use bun_paths::{self as path, MAX_PATH_BYTES};

use bun_http_types::URLPath;
use bun_resolver::Resolver;
use bun_resolver::fs as Fs;
use bun_router::{self as Router, RouteConfig};
use bun_url::{QueryStringMap, URL, route_param};

use crate::api::bun_object;
use crate::generated_bindgen::filesystem_router::{
    FileSystemRouterOptions, Routable, RouteKind, RouterStyle, js_FileSystemRouter,
};
use crate::node::types::Valid;

const DEFAULT_EXTENSIONS: &[&[u8]] = &[b"tsx", b"jsx", b"ts", b"mjs", b"cjs", b"js"];

// ── ResolverLike bridge ───────────────────────────────────────────────────
// `bun_router::ResolverLike` is the duck-typed seam for `Router::load_routes`;
// `bun_resolver::Resolver` is the concrete impl. The orphan-rule-compliant
// impl lives here in `bun_runtime` (the runtime sees both).

/// Newtype so the orphan rule lets us `impl ResolverLike` for the foreign
/// `bun_resolver::Resolver`.
struct RouterResolver<'a, 'r>(&'r mut Resolver<'a>);

impl<'a, 'r> Router::ResolverLike for RouterResolver<'a, 'r> {
    #[inline]
    fn fs(&self) -> &'static Fs::FileSystem {
        Fs::FileSystem::get()
    }
    #[inline]
    fn read_dir_info_ignore_error(
        &mut self,
        path: &[u8],
    ) -> Option<&'static bun_resolver::DirInfo> {
        self.0.read_dir_info_ignore_error(path)
    }
}

pub(crate) struct FileSystemRouter {
    origin: Option<WTFString>,
    base_dir: WTFString,
    router: JsCell<Router::Router>,
    asset_prefix: Option<WTFString>,
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum Load {
    /// From the resolver's cache of the directory. A warning is an error.
    Cached,
    /// From the disk. Warnings pass.
    FromDisk,
}

/// The routes of `config.dir`, or `None` if there is no such directory.
fn load_router(
    global: &JSGlobalObject,
    config: RouteConfig,
    load: Load,
) -> JsResult<Option<(Router::Router, &'static bun_resolver::DirInfo)>> {
    let vm = VirtualMachine::get();
    let (transpiler, log) = (&vm.transpiler, vm.log);
    let mut router_log = Log::Log::new();
    let _redirect = log.redirect(&mut router_log);
    if load == Load::FromDisk {
        FileSystemRouter::bust_dir_cache_recursive(
            strings::paths::without_trailing_slash_windows_path(&config.dir),
        );
    }

    let root_dir_info = match transpiler.with_mut(|t| t.resolver.read_dir_info(&config.dir)) {
        Ok(Some(info)) => info,
        Ok(None) => return Ok(None),
        Err(_) => {
            let error = log.to_js(global, format_args!("reading root directory"))?;
            return Err(global.throw_value(error));
        }
    };

    let mut router = Router::Router::init(config).expect("unreachable");
    let config_dir = router.config.dir.clone();
    let loaded = transpiler.with_mut(|t| {
        router.load_routes(
            log,
            root_dir_info,
            &mut RouterResolver(&mut t.resolver),
            &config_dir,
        )
    });
    if loaded.is_err() || (load == Load::Cached && log.has_any()) {
        let error = log.to_js(global, format_args!("loading routes"))?;
        return Err(global.throw_value(error));
    }
    Ok(Some((router, root_dir_info)))
}

impl FileSystemRouter {
    fn bust_dir_cache_recursive(input_path: &[u8]) {
        let vm = VirtualMachine::get();
        #[cfg(not(windows))]
        let path = input_path;
        #[cfg(windows)]
        let path;
        #[cfg(windows)]
        let normalized: Vec<u8>;
        #[cfg(windows)]
        {
            // Note: `with_borrow_mut` can't hand back a slice that outlives
            // the closure, so copy out (cold reload path).
            normalized = WIN32_NORMALIZE_BUF
                .with_borrow_mut(|buf| vm.fs().normalize_buf(&mut buf[..], input_path).to_vec());
            path = normalized.as_slice();
        }

        let root_dir_info = match vm.transpiler.with_mut(|t| t.resolver.read_dir_info(path)) {
            Ok(v) => v,
            Err(_) => return,
        };

        if let Some(dir_ref) = root_dir_info {
            let entries = vm.fs().fs.snapshot_entries(dir_ref.entries);
            {
                'outer: for entry in entries {
                    if entry.base().first() == Some(&b'.') {
                        continue 'outer;
                    }
                    if entry.kind(&vm.fs().fs, false) == Fs::EntryKind::Dir {
                        for banned_dir in Router::BANNED_DIRS.iter() {
                            if entry.base() == *banned_dir {
                                continue 'outer;
                            }
                        }
                        let abs_parts: [&[u8]; 2] = [entry.dir, entry.base()];
                        let full_path = path::resolve_path::join_abs_string_vec::<
                            path::platform::Loose,
                        >(
                            vm.fs().top_level_dir(), &abs_parts
                        );
                        let _ = vm.transpiler.with_mut(|t| {
                            t.resolver.bust_dir_cache(
                                strings::paths::without_trailing_slash_windows_path(&full_path),
                            )
                        });
                        Self::bust_dir_cache_recursive(&full_path);
                    }
                }
            }
        }

        let _ = vm.transpiler.with_mut(|t| t.resolver.bust_dir_cache(path));
    }
}

impl FileSystemRouter {
    pub(crate) fn constructor<'a>(
        cx: &mut JsScope<'a>,
        options: &FileSystemRouterOptions<'a>,
    ) -> bindgen::Result<'a, Self> {
        match options.style {
            Some(b"nextjs") => {}
            Some(_) => {
                return Err(cx.heap.invalid_arguments(format_args!(
                    "Only 'nextjs' style is currently implemented"
                )));
            }
            None => {
                return Err(cx.heap.invalid_arguments(format_args!(
                    "Expected 'style' option (ex: \"style\": \"nextjs\")"
                )));
            }
        }
        let global = cx.global();
        Valid::no_null_bytes(options.dir, "dir", "a string", global)?;

        let mut out_buf = [0u8; MAX_PATH_BYTES * 2];
        let mut root_dir_path = global.bun_vm().top_level_dir();
        if !(options.dir.is_empty() || options.dir == b".") {
            // An absolute path is joined too: a route's name is cut from the resolver's normalized spelling.
            let Some(joined) =
                path::resolve_path::join_abs_string_buf_checked::<path::platform::Auto>(
                    Fs::FileSystem::get().top_level_dir(),
                    &mut out_buf,
                    &[options.dir],
                )
            else {
                return Err(cx.heap.error(format_args!(
                    "Unable to find directory: {}",
                    bstr::BStr::new(options.dir)
                )));
            };
            root_dir_path = joined;
        }

        let mut extensions: Vec<Box<[u8]>> = options
            .file_extensions
            .iter()
            .flatten()
            .filter(|extension| !extension.is_empty())
            .map(|extension| Box::from(&extension[1..]))
            .collect();
        if extensions.is_empty() {
            extensions = DEFAULT_EXTENSIONS.iter().map(|s| Box::from(*s)).collect();
        }

        let config = RouteConfig {
            // Ends with the native separator (`\` on Windows).
            dir: strings::paths::clone_normalizing_separators(root_dir_path).into_boxed_slice(),
            extensions: extensions.into(),
        };
        let Some((mut router, root_dir_info)) = load_router(global, config, Load::Cached)? else {
            return Err(cx.heap.error(format_args!(
                "Unable to find directory: {}",
                bstr::BStr::new(root_dir_path)
            )));
        };

        let base_dir_str = if !root_dir_info.abs_real_path.is_empty() {
            root_dir_info.abs_real_path
        } else {
            root_dir_info.abs_path
        };

        let vm = global.bun_vm();
        let ref_counted = |bytes: &[u8]| {
            vm.ref_counted_string(bytes)
                .map_err(|_| global.throw_string_too_long())
        };
        let base_dir = ref_counted(base_dir_str)?;
        router.config.dir = Box::from(base_dir.latin1_slice());
        let not_empty = |bytes: &&[u8]| !bytes.is_empty();
        Ok(FileSystemRouter {
            origin: options
                .origin
                .filter(not_empty)
                .map(ref_counted)
                .transpose()?,
            base_dir,
            asset_prefix: options
                .asset_prefix
                .filter(not_empty)
                .map(ref_counted)
                .transpose()?,
            router: JsCell::new(router),
        })
    }

    pub(crate) fn get_asset_prefix(&self) -> Option<impl AsRef<[u8]>> {
        self.asset_prefix.as_ref().map(|s| s.latin1_slice())
    }

    pub(crate) fn r#match<'a>(
        &self,
        heap: &JsHeap<'a>,
        input: Routable<'a>,
    ) -> bindgen::Result<'a, Option<JsWrapper<'a, MatchedRoute>>> {
        // `path` is moved into the `MatchedRoute`, so every arm must own its bytes.
        let mut path: Utf8Bytes<'static> = match input {
            Routable::Path(path) => path.into_utf8(),
            Routable::Request(req) => {
                req.ensure_url().expect("unreachable");
                req.url.get().clone().into_utf8()
            }
            Routable::Response(resp) => resp.url().clone().into_utf8(),
        };

        if path.slice().is_empty() || (path.slice().len() == 1 && path.slice()[0] == b'/') {
            path = Utf8Bytes::Borrowed(b"/");
        }

        if strings::has_prefix(path.slice(), b"http://")
            || strings::has_prefix(path.slice(), b"https://")
            || strings::has_prefix(path.slice(), b"file://")
        {
            path = Utf8Bytes::Owned(URL::parse(path.slice()).pathname.to_vec());
        }

        // URLPath::parse strips byte 0 and the route table is keyed without the
        // leading slash, so "Xtop" would match "/top". The URL branch above and
        // the empty-input normalisation both yield '/'-prefixed paths already.
        if path.slice().first() != Some(&b'/') {
            return Ok(None);
        }

        match URLPath::decode(path.slice()) {
            Ok(Some(decoded)) => path = Utf8Bytes::Owned(decoded),
            Ok(None) => {}
            Err(err) => {
                return Err(heap.error(format_args!(
                    "{} parsing path: {}",
                    bun_url::Error::from(err).name(),
                    bstr::BStr::new(path.slice())
                )));
            }
        }
        let url_path = URLPath::parse(path.slice());
        let mut params_list = route_param::List::default();
        let Some(route) = self
            .router
            .get()
            .routes
            .match_page_with_allocator(url_path.path, &mut params_list)
        else {
            return Ok(None);
        };

        let matched = MatchedRoute {
            name: route.name,
            file_path: route.file_path,
            query_start: path.slice().len() - url_path.query_string.len(),
            pathname: path,
            params_list,
            param_map: OnceCell::new(),
            origin: self.origin.clone(),
            asset_prefix: self.asset_prefix.clone(),
            base_dir: self.base_dir.clone(),
        };
        Ok(Some(matched.into_js(heap)))
    }

    pub(crate) fn get_origin(&self) -> Option<impl AsRef<[u8]>> {
        self.origin.as_ref().map(|s| s.latin1_slice())
    }

    pub(crate) fn reload<'a>(
        &self,
        this_value: JsWrapper<'a, Self>,
        cx: &mut JsScope<'a>,
    ) -> bindgen::Result<'a, JsWrapper<'a, Self>> {
        let config = self.router.get().config.clone();
        let Some((router, _)) = load_router(cx.global(), config, Load::FromDisk)? else {
            return Err(cx.heap.error(format_args!(
                "Unable to find directory: {}",
                bstr::BStr::new(&*self.router.get().config.dir)
            )));
        };
        self.router.set(router);
        js_FileSystemRouter::routes_set_cached(this_value.to_js(), cx.global(), JSValue::ZERO);
        Ok(this_value)
    }

    pub(crate) fn get_routes(
        &self,
    ) -> impl IntoIterator<Item = (impl AsRef<[u8]>, impl AsRef<[u8]>)> {
        let router = self.router.get();
        router.get_names().iter().zip(router.get_entry_points())
    }

    pub(crate) fn get_style(&self) -> RouterStyle {
        RouterStyle::Nextjs
    }
}

pub(crate) struct MatchedRoute {
    /// The route's. The resolver's DirnameStore holds it for the life of the process, as it does `file_path`.
    name: &'static [u8],
    file_path: &'static [u8],
    /// Decoded, with the query string.
    pathname: Utf8Bytes<'static>,
    /// Where the query string starts in `pathname`.
    query_start: usize,
    params_list: route_param::List<'static>,
    /// Made by the first of `params` and `query` to need it.
    param_map: OnceCell<QueryStringMap<'static>>,
    origin: Option<WTFString>,
    asset_prefix: Option<WTFString>,
    base_dir: WTFString,
}

impl MatchedRoute {
    fn pathname_without_leading_slash(&self) -> &[u8] {
        strings::trim_left(self.pathname.slice(), b"/")
    }

    /// A name that comes once has a string, and one that comes again has an array of them.
    fn create_query_object<'a>(
        heap: &JsHeap<'a>,
        map: Option<&QueryStringMap<'_>>,
    ) -> bindgen::Result<'a, JsLocal<'a>> {
        let Some(map) = map else {
            return Ok(heap.create_empty_object().as_value());
        };
        let mut buffer: [&[u8]; 256] = [b""; 256];
        let mut names = map.iter();
        let entries = core::iter::from_fn(|| {
            let entry = names.next(&mut buffer)?;
            let value = match &*entry.values {
                [value] => to_js::utf8(heap, value),
                values => to_js::array(heap, values, to_js::utf8),
            };
            Some((entry.name, value))
        });
        // Never cuts: it tells `record` how many names there can be.
        let entries = entries.take(map.get_name_count());
        to_js::record(heap, entries, |_, value| value)
    }
}

impl MatchedRoute {
    pub(crate) fn get_file_path(&self) -> impl AsRef<[u8]> {
        self.file_path
    }

    pub(crate) fn get_kind(&self) -> RouteKind {
        let name = self.name;
        if strings::contains(name, b"[[...") {
            RouteKind::OptionalCatchAll
        } else if strings::contains(name, b"[...") {
            RouteKind::CatchAll
        } else if strings::contains(name, b"[") {
            RouteKind::Dynamic
        } else {
            RouteKind::Exact
        }
    }

    pub(crate) fn get_name(&self) -> impl AsRef<[u8]> {
        self.name
    }

    pub(crate) fn get_params<'a>(&self, heap: &JsHeap<'a>) -> bindgen::Result<'a, JsLocal<'a>> {
        if self.params_list.is_empty() {
            return Self::create_query_object(heap, None);
        }

        if self.param_map.get().is_none()
            && let Some(map) = QueryStringMap::init_with_route_params(
                b"",
                self.pathname_without_leading_slash(),
                &self.params_list,
            )?
        {
            let _ = self.param_map.set(map);
        }

        Self::create_query_object(heap, self.param_map.get())
    }

    pub(crate) fn get_pathname(&self) -> impl AsRef<[u8]> {
        self.pathname.slice()
    }

    pub(crate) fn get_query<'a>(&self, heap: &JsHeap<'a>) -> bindgen::Result<'a, JsLocal<'a>> {
        let query_string = &self.pathname.slice()[self.query_start..];
        if query_string.is_empty() {
            return self.get_params(heap);
        }

        let map = if self.params_list.is_empty() {
            QueryStringMap::init(query_string)?
        } else {
            QueryStringMap::init_with_route_params(
                query_string,
                self.pathname_without_leading_slash(),
                &self.params_list,
            )?
        };
        Self::create_query_object(heap, map.as_ref())
    }

    pub(crate) fn get_script_src(&self) -> impl AsRef<[u8]> {
        self.get_src()
    }

    pub(crate) fn get_src(&self) -> impl AsRef<[u8]> {
        let mut src: Vec<u8> = Vec::new();
        let origin_url = self
            .origin
            .as_ref()
            .map(|origin| URL::parse(origin.latin1_slice()));
        bun_object::get_public_path_with_asset_prefix(
            self.file_path,
            self.base_dir.latin1_slice(),
            &origin_url.unwrap_or_default(),
            self.asset_prefix
                .as_ref()
                .map_or(b"", |prefix| prefix.latin1_slice()),
            &mut src,
            path::Platform::Posix,
        );
        src
    }
}

#[cfg(windows)]
thread_local! {
    static WIN32_NORMALIZE_BUF: core::cell::RefCell<Box<[u8; MAX_PATH_BYTES * 2]>> =
        core::cell::RefCell::new(bun_core::boxed_zeroed());
}
