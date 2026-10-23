//! `JSFrameworkRouter`: a JS class for testing the router.

use bun_paths::strings;

use bun_alloc::{AllocError, Arena};
use bun_collections::BoundedArray;
use bun_jsc::bindgen::{JsLocal, JsScope};
use bun_jsc::bun_string_jsc;
use bun_jsc::{JSGlobalObject, JSValue, JsResult, StringJsc, StrongOptional};
use bun_paths as paths;

use super::*;
use crate::generated_bindgen::framework_router::{RoutePattern, RoutePatternKind};

/// This binding is currently only intended for testing FrameworkRouter, and not
/// production usage. It uses a slower but easier to use pattern for object
/// creation. A production-grade JS api would be able to re-use objects.
pub(crate) struct JSFrameworkRouter {
    pub(crate) files: Vec<bun_core::String>,
    pub(crate) router: FrameworkRouter,
    pub(crate) stored_parse_errors: Vec<StoredParseError>,
}

pub(crate) struct StoredParseError {
    /// Owned by global allocator
    pub rel_path: Box<[u8]>,
    pub log: TinyLog,
}

impl JSFrameworkRouter {
    pub(crate) fn constructor(cx: &mut JsScope<'_>, options: JsLocal<'_>) -> JsResult<Self> {
        let global = cx.global();
        let options = options.to_js();
        if !options.is_object() {
            return Err(global.throw_invalid_arguments(format_args!(
                "FrameworkRouter needs an object as it's first argument",
            )));
        }

        let root: bun_core::Utf8Bytes = match options.get(global, "root")? {
            Some(v) if !v.is_undefined_or_null() => v.to_utf8(global)?,
            _ => return Err(global.throw_invalid_arguments(format_args!("Missing options.root"))),
        };

        let style = Style::from_js(
            options.get(global, "style")?.unwrap_or(JSValue::UNDEFINED),
            global,
        )?;

        let abs_root: Box<[u8]> = strings::without_trailing_slash(paths::resolve_path::join_abs::<
            paths::platform::Auto,
        >(
            // SAFETY: FileSystem::instance() returns the process-global singleton; live for the program.
            bun_resolver::fs::FileSystem::get().top_level_dir(),
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
            client_pages: false,
            // Unused by JSFrameworkRouter
            client_file: None,
            server_file: OpaqueFileId::init(0),
            server_file_string: StrongOptional::empty(),
            ..Default::default()
        }]);

        let mut jsfr = JSFrameworkRouter {
            router: FrameworkRouter::init_empty(&abs_root, types)?,
            files: Vec::new(),
            stored_parse_errors: Vec::new(),
        };

        let resolver = &mut global.bun_vm().as_mut().transpiler.resolver;
        // The handler only touches `files`/`stored_parse_errors`, so split-borrow
        // those two fields into a dedicated context (see `JSFrameworkRouterScanCtx`).
        {
            let JSFrameworkRouter {
                router,
                files,
                stored_parse_errors,
            } = &mut jsfr;
            let mut ctx = JSFrameworkRouterScanCtx {
                files,
                stored_parse_errors,
            };
            router.scan(TypeIndex::init(0), resolver, &mut ctx)?;
        }

        if !jsfr.stored_parse_errors.is_empty() {
            let arr =
                JSValue::create_array_from_iter(global, jsfr.stored_parse_errors.iter(), |item| {
                    Ok(global.create_error_instance(format_args!(
                        "Invalid route {}: {}",
                        bun_core::fmt::quote(&item.rel_path),
                        bstr::BStr::new(item.log.msg.const_slice()),
                    )))
                })?;
            return Err(global.throw_value(global.create_aggregate_error_with_array(
                arr,
                format_args!("Errors scanning routes"),
            )?));
        }

        Ok(jsfr)
    }

    pub(crate) fn r#match(&self, cx: &mut JsScope<'_>, path: &[u8]) -> JsResult<JSValue> {
        let global = cx.global();
        let mut params_out = MatchedParams {
            params: BoundedArray::default(),
        };
        if let Some(index) = self.router.match_slow(path, &mut params_out) {
            let obj = JSValue::create_empty_object(global, 2);
            obj.put(
                global,
                b"params",
                if params_out.params.len() > 0 {
                    let params_obj =
                        JSValue::create_empty_object(global, params_out.params.len() as usize);
                    for param in params_out.params.slice() {
                        // key/value borrow from `path`/pattern, both live here (RawSlice invariant)
                        // A file named `[0].tsx` produces a param name that's an array index.
                        params_obj.put_may_be_index(
                            global,
                            &bun_core::String::borrow_utf8(param.key.slice()),
                            bun_string_jsc::create_utf8_for_js(global, param.value.slice())?,
                        )?;
                    }
                    params_obj
                } else {
                    JSValue::NULL
                },
            );
            obj.put(global, b"route", self.route_to_json_inverse(global, index)?);
            return Ok(obj);
        }

        Ok(JSValue::NULL)
    }

    pub(crate) fn to_json(&self, cx: &mut JsScope<'_>) -> JsResult<JSValue> {
        self.route_to_json(cx.global(), RouteIndex::init(0))
    }

    fn route_to_json(&self, global: &JSGlobalObject, route_index: RouteIndex) -> JsResult<JSValue> {
        let route = self.router.route_ptr(route_index);
        let obj = JSValue::create_empty_object(global, 4);
        obj.put(global, b"part", Self::part_to_js(global, &route.part)?);
        obj.put(
            global,
            b"page",
            self.file_id_to_js(global, route.file_page)?,
        );
        obj.put(
            global,
            b"layout",
            self.file_id_to_js(global, route.file_layout)?,
        );
        // obj.put(global, "notFound", self.file_id_to_js(global, route.file_not_found)?);
        obj.put(global, b"children", {
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
        Ok(obj)
    }

    fn route_to_json_inverse(
        &self,
        global: &JSGlobalObject,
        route_index: RouteIndex,
    ) -> JsResult<JSValue> {
        let route = self.router.route_ptr(route_index);
        let obj = JSValue::create_empty_object(global, 4);
        obj.put(global, b"part", Self::part_to_js(global, &route.part)?);
        obj.put(
            global,
            b"page",
            self.file_id_to_js(global, route.file_page)?,
        );
        obj.put(
            global,
            b"layout",
            self.file_id_to_js(global, route.file_layout)?,
        );
        // obj.put(global, "notFound", self.file_id_to_js(global, route.file_not_found)?);
        obj.put(
            global,
            b"parent",
            if let Some(parent) = route.parent {
                self.route_to_json_inverse(global, parent)?
            } else {
                JSValue::NULL
            },
        );
        Ok(obj)
    }

    pub(crate) fn parse_route_pattern<'a>(
        cx: &mut JsScope<'a>,
        style: JsLocal<'a>,
        filepath: &[u8],
    ) -> JsResult<Option<RoutePattern>> {
        let global = cx.global();
        let arena = Arena::new();

        let style = Style::from_js(style.to_js(), global)?;

        let mut log = TinyLog::empty();
        let parsed = match style.parse(filepath, paths::extension(filepath), &mut log, true, &arena)
        {
            Err(crate::Error::InvalidRoutePattern) => {
                return Err(global.throw(format_args!(
                    "{} ({}:{})",
                    bstr::BStr::new(log.msg.slice()),
                    log.cursor_at,
                    log.cursor_len
                )));
            }
            Err(e) => return Err(e.into()),
            Ok(None) => return Ok(None),
            Ok(Some(p)) => p,
        };

        let mut rendered: Vec<u8> = Vec::with_capacity(filepath.len());
        for part in parsed.parts {
            part.to_string_for_internal_use(&mut ByteFmtWriter::new(&mut rendered))
                .expect("ByteFmtWriter is infallible");
        }

        Ok(Some(RoutePattern {
            kind: match parsed.kind {
                ParsedPatternKind::Page => RoutePatternKind::Page,
                ParsedPatternKind::Layout => RoutePatternKind::Layout,
                ParsedPatternKind::Extra => RoutePatternKind::Extra,
            },
            pattern: rendered,
        }))
    }

    fn part_to_js(global: &JSGlobalObject, part: &Part<'_>) -> JsResult<JSValue> {
        let mut rendered: Vec<u8> = Vec::new();
        part.to_string_for_internal_use(&mut ByteFmtWriter::new(&mut rendered))
            .expect("ByteFmtWriter is infallible");
        bun_string_jsc::create_utf8_for_js(global, &rendered)
    }

    pub(crate) fn file_id_to_js(
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

use bun_core::fmt::VecWriter as ByteFmtWriter;

// `scan` needs `&mut jsfr.router` and the insertion handler simultaneously.
// The handler only touches `files` / `stored_parse_errors`, so we split-borrow
// those two fields into a dedicated context struct instead of implementing the
// trait on `JSFrameworkRouter` itself.
struct JSFrameworkRouterScanCtx<'a> {
    files: &'a mut Vec<bun_core::String>,
    stored_parse_errors: &'a mut Vec<StoredParseError>,
}

impl InsertionHandler for JSFrameworkRouterScanCtx<'_> {
    fn get_file_id_for_router(
        &mut self,
        abs_path: &[u8],
        _: RouteIndex,
        _: FileKind,
    ) -> Result<OpaqueFileId, AllocError> {
        self.files.push(bun_core::String::clone_utf8(abs_path));
        Ok(OpaqueFileId::init(
            u32::try_from(self.files.len() - 1).expect("int cast"),
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
        panic!("TODO: onRouterCollisionError for JSFrameworkRouter")
    }
}
