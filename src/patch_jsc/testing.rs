//! JS testing bindings for `bun.patch`. Keeps `src/patch/` free of JSC types.

use bun_jsc::bindgen::{JsHeap, JsLocal, JsScope};
use bun_jsc::{JSGlobalObject, JSValue, JsResult, SysErrorJsc};
use bun_patch::{ApplyError, ParseErr, ParseErrAt, PatchFile, git_diff_internal, parse_patch_file};
use bun_sys::{Fd, FdExt};

pub(crate) struct TestingAPIs;

impl TestingAPIs {
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

    pub(crate) fn apply<'a>(
        cx: &mut JsScope<'a>,
        patchfile: JsLocal<'a>,
        dir: JsLocal<'a>,
    ) -> JsResult<bool> {
        let global = cx.global();
        let args = Self::parse_apply_args(global, patchfile.to_js(), dir.to_js())?;

        let patchfile: PatchFile<'_> =
            parse_patch_file(&args.patchfile_txt).expect("validated in parse_apply_args");

        match patchfile.apply(args.dirfd) {
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

    pub(crate) fn parse_apply_args(
        global: &JSGlobalObject,
        patchfile_js: JSValue,
        dir_js: JSValue,
    ) -> JsResult<ApplyArgs> {
        let dir_fd = if !dir_js.is_undefined() {
            let bunstr = dir_js.to_bun_string(global)?;
            let path = bunstr.to_owned_slice_z();

            match bun_sys::open(
                path.as_zstr(),
                bun_sys::O::DIRECTORY | bun_sys::O::RDONLY,
                0,
            ) {
                Err(e) => {
                    let js_err = SysErrorJsc::to_js(&e.with_path(path.as_bytes()), global);
                    return Err(global.throw_value(js_err));
                }
                Ok(fd) => fd,
            }
        } else {
            Fd::cwd()
        };

        let patchfile_bunstr = match patchfile_js.to_bun_string(global) {
            Ok(bunstr) => bunstr,
            Err(e) => {
                if Fd::cwd() != dir_fd {
                    dir_fd.close();
                }
                return Err(e);
            }
        };
        let patchfile_src = patchfile_bunstr.to_utf8();

        // Validate the patch parses; on failure, clean up `dir_fd` and throw.
        // The parsed `PatchFile<'_>` borrows `patchfile_src`, so it cannot be
        // returned alongside its source without a self-referential struct
        // (forbidden by PORTING.md). We discard it here; `apply()` reparses
        // from the owned bytes below.
        if let Err(ParseErrAt { err: e, .. }) = parse_patch_file(patchfile_src.slice()) {
            // TODO: HAVE @zackradisic REVIEW THIS DIFF
            if Fd::cwd() != dir_fd {
                dir_fd.close();
            }

            drop(patchfile_src);
            return Err(global.throw_error(bun_patch::Error::from(e), "failed to parse patchfile"));
        }

        Ok(ApplyArgs {
            dirfd: dir_fd,
            patchfile_txt: patchfile_src.into_vec(),
        })
    }
}

pub(crate) struct ApplyArgs {
    patchfile_txt: Vec<u8>,
    dirfd: Fd,
}

impl Drop for ApplyArgs {
    fn drop(&mut self) {
        // patchfile_txt freed by its own Drop impl.
        // TODO: HAVE @zackradisic REVIEW THIS DIFF
        if Fd::cwd() != self.dirfd {
            self.dirfd.close();
        }
    }
}
