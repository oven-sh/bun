//! Whether an argument of `bun ./index.html './pages/*.html'` is a page or a pattern, for html.ts and `bun --check`.

use bun_core::strings;
use bun_glob::BunGlobWalker;
use bun_jsc::{CallFrame, JSGlobalObject, JSValue, JsResult, SysErrorJsc as _, bun_string_jsc};
use bun_paths::{platform::Auto, resolve_path};

/// What an argument names.
pub(crate) enum Pages {
    /// One page. The argument is its path.
    Named,
    /// The argument is a pattern.
    Matched {
        /// The pages that match it. Each path is absolute or relative to the working directory.
        pages: bun_collections::StringArrayHashMap<()>,
        /// What ended the search early. `pages` then has those that were found before it.
        error: Option<bun_sys::Error>,
    },
}

/// The pages that the argument `text` names. A relative path is in `cwd`.
pub(crate) fn pages_of(cwd: &[u8], text: &[u8]) -> Result<Pages, bun_core::Error> {
    if !strings::contains_any(text, b"*{") || names_file(cwd, text) {
        return Ok(Pages::Named);
    }
    // The options of `Bun.Glob.prototype.scanSync`: files only.
    let walker = BunGlobWalker::init_with_cwd(text, cwd, false, false, false, false, true, None)?;
    let mut walker = match walker {
        Ok(walker) => walker,
        Err(error) => {
            return Ok(Pages::Matched {
                pages: Default::default(),
                error: Some(error),
            });
        }
    };
    let error = walker.walk()?.err();
    let pages = core::mem::take(&mut walker.matched_paths);
    Ok(Pages::Matched { pages, error })
}

/// Whether `text` is the path of a file that it does not match as a pattern: `{a,b}/x.html` matches `a/x.html`.
fn names_file(cwd: &[u8], text: &[u8]) -> bool {
    if bun_glob::r#match(text, text).matches() {
        return false;
    }
    let mut buf = bun_paths::path_buffer_pool::get();
    let room = buf.len() - 1;
    let Some(path) =
        resolve_path::join_abs_string_buf_checked::<Auto>(cwd, &mut buf[..room], &[text])
    else {
        return false;
    };
    let len = path.len();
    buf[len] = 0;
    let path = bun_core::ZStr::from_buf(&buf[..], len);
    matches!(
        bun_sys::exists_at_type(bun_sys::Fd::cwd(), path),
        Ok(bun_sys::ExistsAtType::File)
    )
}

/// `pagesOf(arg, cwd)` of src/js/internal/html.ts: `undefined` for the path of a page, else the pages that match.
#[bun_jsc::host_fn]
pub(crate) fn js_pages_of(global: &JSGlobalObject, callframe: &CallFrame) -> JsResult<JSValue> {
    let [arg, cwd] = callframe.arguments_as_array::<2>();
    let (arg, cwd) = (arg.to_utf8(global)?, cwd.to_utf8(global)?);
    match pages_of(&cwd, &arg).map_err(crate::Error::from)? {
        Pages::Named => Ok(JSValue::UNDEFINED),
        Pages::Matched {
            error: Some(error), ..
        } => Err(global.throw_value(error.to_js(global))),
        Pages::Matched { pages, error: None } => {
            JSValue::create_array_from_iter(global, pages.keys().iter(), |page| {
                bun_string_jsc::create_utf8_for_js(global, page)
            })
        }
    }
}
