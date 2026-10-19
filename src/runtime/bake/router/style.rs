//! Routing styles: how file names map to route patterns (Next.js pages and app router).

use bun_paths::strings;

use bun_alloc::{Arena, ArenaVec};
use bun_jsc::{JSGlobalObject, JSValue, JsResult};
use bun_paths as paths;

use super::*;

#[derive(Copy, Clone)]
pub(crate) enum Style {
    NextjsPages,
    NextjsAppUi,
    NextjsAppRoutes,
    /// A `CustomFileSystemRouterFunction` (bake.d.ts). Not implemented, so the function is not kept.
    JavascriptDefined,
}

bun_core::comptime_string_map! {
    pub(crate) static STYLE_MAP: Style = {
        b"nextjs-pages" => Style::NextjsPages,
        b"nextjs-app-ui" => Style::NextjsAppUi,
        b"nextjs-app-routes" => Style::NextjsAppRoutes,
    };
}

const STYLE_ERROR_MESSAGE: &str = "'style' must be either \"nextjs-pages\", \"nextjs-app-ui\", \"nextjs-app-routes\", or a function.";

impl Style {
    /// The string that selects this style in a framework object. A function has none.
    pub(crate) fn name(self) -> Option<&'static [u8]> {
        match self {
            Style::NextjsPages => Some(b"nextjs-pages"),
            Style::NextjsAppUi => Some(b"nextjs-app-ui"),
            Style::NextjsAppRoutes => Some(b"nextjs-app-routes"),
            Style::JavascriptDefined => None,
        }
    }

    pub(crate) fn from_js(value: JSValue, global: &JSGlobalObject) -> JsResult<Style> {
        if value.is_string() {
            let bun_string = value.to_bun_string(global)?;
            let utf8 = bun_string.to_utf8();
            if let Some(style) = STYLE_MAP.get(utf8.slice()) {
                return Ok(*style);
            }
        } else if value.is_callable() {
            return Ok(Style::JavascriptDefined);
        }

        Err(global.throw_invalid_arguments(format_args!("{STYLE_ERROR_MESSAGE}")))
    }
}

#[derive(Copy, Clone, Eq, PartialEq, core::marker::ConstParamTy)]
pub(crate) enum UiOrRoutes {
    Ui,
    Routes,
}

#[derive(Copy, Clone, Eq, PartialEq, core::marker::ConstParamTy)]
enum NextRoutingConvention {
    App,
    Pages,
}

impl Style {
    pub(crate) fn parse<'bump>(
        self,
        file_path: &'bump [u8],
        ext: &[u8],
        log: &mut TinyLog,
        allow_layouts: bool,
        arena: &'bump Arena,
    ) -> crate::Result<Option<ParsedPattern<'bump>>> {
        debug_assert!(file_path[0] == b'/');

        match self {
            Style::NextjsPages => {
                Self::parse_nextjs_pages(file_path, ext, log, allow_layouts, arena)
            }
            Style::NextjsAppUi => Self::parse_nextjs_app::<{ UiOrRoutes::Ui }>(
                file_path,
                ext,
                log,
                allow_layouts,
                arena,
            ),
            Style::NextjsAppRoutes => Self::parse_nextjs_app::<{ UiOrRoutes::Routes }>(
                file_path,
                ext,
                log,
                allow_layouts,
                arena,
            ),

            // The strategy for this should be to collect a list of candidates,
            // then batch-call the javascript handler and collect all results.
            // This will avoid most of the back-and-forth native<->js overhead.
            Style::JavascriptDefined => panic!("TODO: customizable Style"),
        }
    }

    /// Implements the pages router parser from Next.js:
    /// https://nextjs.org/docs/getting-started/project-structure#pages-routing-conventions
    pub(crate) fn parse_nextjs_pages<'bump>(
        file_path_raw: &'bump [u8],
        ext: &[u8],
        log: &mut TinyLog,
        allow_layouts: bool,
        arena: &'bump Arena,
    ) -> crate::Result<Option<ParsedPattern<'bump>>> {
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
    pub(crate) fn parse_nextjs_app<'bump, const EXTRACT: UiOrRoutes>(
        file_path_raw: &'bump [u8],
        ext: &[u8],
        log: &mut TinyLog,
        allow_layouts: bool,
        arena: &'bump Arena,
    ) -> crate::Result<Option<ParsedPattern<'bump>>> {
        let without_ext = &file_path_raw[0..file_path_raw.len() - ext.len()];
        let basename = paths::basename(without_ext);
        let Some(loader) = bun_ast::Loader::from_string(ext) else {
            return Ok(None);
        };

        // TODO: opengraph-image and metadata friends
        if !loader.is_javascript_like() {
            return Ok(None);
        }

        bun_core::comptime_string_map! {
            static UI_MAP: ParsedPatternKind = {
                b"page" => ParsedPatternKind::Page,
                b"layout" => ParsedPatternKind::Layout,
                b"default" => ParsedPatternKind::Extra,
                b"template" => ParsedPatternKind::Extra,
                b"error" => ParsedPatternKind::Extra,
                b"loading" => ParsedPatternKind::Extra,
                b"not-found" => ParsedPatternKind::Extra,
            };
        }
        bun_core::comptime_string_map! {
            static ROUTES_MAP: ParsedPatternKind = {
                b"route" => ParsedPatternKind::Page,
            };
        }
        let Some(&kind) = (match EXTRACT {
            UiOrRoutes::Ui => UI_MAP.get(basename),
            UiOrRoutes::Routes => ROUTES_MAP.get(basename),
        }) else {
            return Ok(None);
        };

        if kind == ParsedPatternKind::Layout && !allow_layouts {
            return Ok(None);
        }

        let dirname = paths::resolve_path::dirname::<paths::platform::Posix>(without_ext);
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
    ) -> crate::Result<&'bump [Part<'bump>]> {
        let mut i: usize = 1;
        let mut parts: ArenaVec<'bump, Part<'bump>> = ArenaVec::new_in(arena);
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
                            .into());
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
                for part in strings::tokenize(between, b"/") {
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
                            .into());
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
                for part in strings::tokenize(between, b"/") {
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
            for part in strings::tokenize(&route_segment[i..], b"/") {
                parts.push(Part::Text(part));
            }
        }
        Ok(parts.into_bump_slice())
    }
}
