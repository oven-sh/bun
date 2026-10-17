//! Whether an argument of `bun ./index.html './pages/*.html'` is a page or a pattern, for html.ts and `bun --check`.

use bun_core::strings;
use bun_glob::BunGlobWalker;
use bun_paths::{platform::Auto, resolve_path};

use crate::api::glob::ScanError;

/// What an argument names.
pub(crate) enum Pages {
    /// One page. The argument is its path.
    Named,
    /// The argument is a pattern.
    Matched {
        /// The pages that match it. Each path is absolute or relative to the working directory.
        pages: Vec<Box<[u8]>>,
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
                pages: Vec::new(),
                error: Some(error),
            });
        }
    };
    let error = walker.walk()?.err();
    let (pages, _) = core::mem::take(&mut *walker.matched_paths).into_entries();
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

/// `pagesOf` of html_pages.bind.ts, with the errors of `Bun.Glob.prototype.scanSync`. `None` is `undefined`.
pub(crate) fn pages_of_from_js<'a>(
    arg: &[u8],
    cwd: &[u8],
) -> Result<Option<Vec<Box<[u8]>>>, ScanError<'a>> {
    match pages_of(cwd, arg).map_err(|error| ScanError::Runtime(error.into()))? {
        Pages::Named => Ok(None),
        Pages::Matched {
            error: Some(error), ..
        } => Err(ScanError::Sys(error)),
        Pages::Matched { pages, error: None } => Ok(Some(pages)),
    }
}
