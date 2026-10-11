//! Whether an argument of `bun ./index.html './pages/*.html'` is the path of a page or a pattern, and the pages
//! that the pattern matches. src/js/internal/html.ts asks to serve the pages, and `bun --check` to type check
//! their scripts before that.

use bun_core::strings;
use bun_glob::BunGlobWalker;
use bun_jsc::{CallFrame, JSGlobalObject, JSValue, JsResult, SysErrorJsc as _, bun_string_jsc};
use bun_paths::{platform::Auto, resolve_path};
use bun_sys::Result as Maybe;

/// What an argument names.
pub(crate) enum Pages {
    /// One page. The argument is its path.
    Named,
    /// The pages that match the argument, which is a pattern. Each path is absolute or relative to the
    /// working directory.
    Matched(bun_collections::StringArrayHashMap<()>),
}

/// The pages that the argument `text` names. A relative path is in `cwd`.
pub(crate) fn pages_of(cwd: &[u8], text: &[u8]) -> Result<Maybe<Pages>, bun_core::Error> {
    if !strings::contains_any(text, b"*{") || names_file(cwd, text) {
        return Ok(Ok(Pages::Named));
    }
    // The options of `Bun.Glob.prototype.scanSync`: files only.
    let walker = BunGlobWalker::init_with_cwd(text, cwd, false, false, false, false, true, None)?;
    let mut walker = match walker {
        Ok(walker) => walker,
        Err(err) => return Ok(Err(err)),
    };
    let walked = walker.walk()?;
    Ok(walked.map(|()| Pages::Matched(core::mem::take(&mut walker.matched_paths))))
}

/// Whether `text` is the path of a file that it does not match as a pattern: `{a,b}/index.html` matches
/// `a/index.html`, and not the file with that name. A pattern that matches its own text finds that file too.
fn names_file(cwd: &[u8], text: &[u8]) -> bool {
    if bun_glob::r#match(text, text).matches() {
        return false;
    }
    let mut buf = bun_paths::path_buffer_pool::get();
    // Both, a separator and the terminator have to fit.
    if cwd.len() + text.len() + 2 > buf.len() {
        return false;
    }
    let path = resolve_path::join_abs_string_buf_z::<Auto>(cwd, &mut buf[..], &[text]);
    matches!(
        bun_sys::exists_at_type(bun_sys::Fd::cwd(), path),
        Ok(bun_sys::ExistsAtType::File)
    )
}

/// `pagesOf(arg, cwd)` of src/js/internal/html.ts: `undefined` if `arg` is the path of a page, else the paths of
/// the pages that it matches.
#[bun_jsc::host_fn]
pub(crate) fn js_pages_of(global: &JSGlobalObject, callframe: &CallFrame) -> JsResult<JSValue> {
    let [arg, cwd] = callframe.arguments_as_array::<2>();
    let (arg, cwd) = (arg.to_utf8(global)?, cwd.to_utf8(global)?);
    match pages_of(&cwd, &arg).map_err(crate::Error::from)? {
        Ok(Pages::Named) => Ok(JSValue::UNDEFINED),
        Ok(Pages::Matched(pages)) => {
            JSValue::create_array_from_iter(global, pages.keys().iter(), |page| {
                bun_string_jsc::create_utf8_for_js(global, page)
            })
        }
        Err(err) => Err(global.throw_value(err.to_js(global))),
    }
}
