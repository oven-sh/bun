//! JS testing bindings for `bun.patch`. Keeps `src/patch/` free of JSC types.

use bun_jsc::bindgen::{JsHeap, JsScope};
use bun_jsc::{JsResult, SysErrorJsc};
use bun_patch::{ApplyError, ParseErr, ParseErrAt, PatchFile, git_diff_internal, parse_patch_file};
use bun_sys::{Fd, FdExt};

pub(crate) fn make_diff(
    cx: &mut JsScope<'_>,
    old_folder: &[u8],
    new_folder: &[u8],
) -> JsResult<Vec<u8>> {
    let global = cx.global();
    // `git_diff_internal` routes through `bun_spawn::sync`, which on
    // Windows derefs `WindowsOptions.loop_` — supply the JS event loop.
    // `global.bun_vm().event_loop()` is the live per-thread `jsc::EventLoop`.
    let mut loop_ = bun_jsc::AnyEventLoop::js(global.bun_vm().event_loop().cast());
    let diff = match git_diff_internal(old_folder, new_folder, &mut loop_) {
        Ok(d) => d,
        Err(e) => return Err(global.throw_error(e, "failed to make diff")),
    };
    diff.map_err(|e| {
        global.throw(format_args!(
            "failed to make diff: {}",
            bstr::BStr::new(e.as_slice())
        ))
    })
}

pub(crate) fn apply(cx: &mut JsScope<'_>, patchfile: &[u8], dir: Option<&[u8]>) -> JsResult<bool> {
    let global = cx.global();
    let dir = match dir {
        Some(path) => {
            let path = bun_jsc::String::borrow_utf8(path).to_owned_slice_z();

            match bun_sys::open(
                path.as_zstr(),
                bun_sys::O::DIRECTORY | bun_sys::O::RDONLY,
                0,
            ) {
                Err(e) => {
                    let js_err = SysErrorJsc::to_js(&e.with_path(path.as_bytes()), global);
                    return Err(global.throw_value(js_err));
                }
                Ok(fd) => ApplyDir(fd),
            }
        }
        None => ApplyDir(Fd::cwd()),
    };

    let patchfile: PatchFile<'_> = match parse_patch_file(patchfile) {
        Ok(patchfile) => patchfile,
        Err(ParseErrAt { err: e, .. }) => {
            return Err(global.throw_error(bun_patch::Error::from(e), "failed to parse patchfile"));
        }
    };

    match patchfile.apply(dir.0) {
        Ok(()) => {}
        Err(ApplyError::Sys(err)) => {
            return Err(global.throw_value(SysErrorJsc::to_js(&err, global)));
        }
        Err(err @ ApplyError::HunkDoesNotApply { .. }) => {
            return Err(global.throw(format_args!("{}", err)));
        }
    }

    Ok(true)
}

/// Used in JS tests, see `internal-for-testing.ts` and patch tests.
pub(crate) fn parse(heap: &JsHeap<'_>, patchfile_src: &[u8]) -> JsResult<Vec<u8>> {
    let patchfile = match parse_patch_file(patchfile_src) {
        Ok(p) => p,
        Err(ParseErrAt { err: e, .. }) => {
            // SAFETY: it throws, and the body returns.
            let global = unsafe { heap.global() };
            if e == ParseErr::hunk_header_integrity_check_failed {
                return Err(global.throw_error(bun_patch::Error::from(e), "this indicates either that the supplied patch file was incorrect, or there is a bug in Bun. Please check your .patch file, or open a GitHub issue :)"));
            } else {
                return Err(
                    global.throw_error(bun_patch::Error::from(e), "failed to parse patch file")
                );
            }
        }
    };

    let mut str: Vec<u8> = Vec::new();
    {
        use std::io::Write as _;
        write!(&mut str, "{}", bun_patch::json_fmt(&patchfile)).expect("unreachable");
    }
    Ok(str)
}

struct ApplyDir(Fd);

impl Drop for ApplyDir {
    fn drop(&mut self) {
        // TODO: HAVE @zackradisic REVIEW THIS DIFF
        if Fd::cwd() != self.0 {
            self.0.close();
        }
    }
}
