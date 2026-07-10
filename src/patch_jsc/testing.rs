//! JS testing bindings for `bun.patch`. Keeps `src/patch/` free of JSC types.

use bun_core::{OwnedString, String as BunString};
use bun_jsc::{
    ArgumentsSlice, CallFrame, JSGlobalObject, JSValue, JsResult, StringJsc, SysErrorJsc,
};
use bun_patch::{ParseErr, PatchFile, git_diff_internal, parse_patch_file};
use bun_sys::{Fd, FdExt};

pub struct TestingAPIs;

impl TestingAPIs {
    // `#[bun_jsc::host_fn]` Free-kind shim emits an unqualified
    // `fn_name(g, f)` call, so it cannot wrap an associated fn. The C-ABI
    // shim is emitted at module scope below (`__jsc_host_*`).
    pub fn make_diff(global: &JSGlobalObject, frame: &CallFrame) -> JsResult<JSValue> {
        let arguments_ = frame.arguments_old::<2>();
        // SAFETY: `bun_vm()` never returns null for a Bun-owned global; the VM
        // outlives this call frame.
        let mut arguments = ArgumentsSlice::init(global.bun_vm(), arguments_.slice());

        let Some(old_folder_jsval) = arguments.next_eat() else {
            return Err(global.throw(format_args!("expected 2 strings")));
        };
        // `to_bun_string` returns +1 ref; `OwnedString` derefs on drop.
        let old_folder_bunstr = OwnedString::new(old_folder_jsval.to_bun_string(global)?);

        let Some(new_folder_jsval) = arguments.next_eat() else {
            return Err(global.throw(format_args!("expected 2 strings")));
        };
        let new_folder_bunstr = OwnedString::new(new_folder_jsval.to_bun_string(global)?);

        let old_folder = old_folder_bunstr.to_utf8();
        let new_folder = new_folder_bunstr.to_utf8();

        // `git_diff_internal` routes through `bun_spawn::sync`, which on
        // Windows derefs `WindowsOptions.loop_` — supply the JS event loop.
        // `global.bun_vm().event_loop()` is the live per-thread `jsc::EventLoop`.
        let mut loop_ = bun_jsc::AnyEventLoop::js(global.bun_vm().event_loop().cast());
        let diff = match git_diff_internal(old_folder.slice(), new_folder.slice(), &mut loop_) {
            Ok(d) => d,
            Err(e) => return Err(global.throw_error(e, "failed to make diff")),
        };
        match diff {
            Ok(s) => {
                // `from_bytes` borrows — no +1 WTF ref.
                let result = BunString::from_bytes(s.as_slice()).to_js(global);
                drop(s);
                result
            }
            Err(e) => {
                let result = Err(global.throw(format_args!(
                    "failed to make diff: {}",
                    bstr::BStr::new(e.as_slice())
                )));
                drop(e);
                result
            }
        }
    }

    pub fn apply(global: &JSGlobalObject, frame: &CallFrame) -> JsResult<JSValue> {
        let args = Self::parse_apply_args(global, frame)?;

        let patchfile: PatchFile<'_> =
            parse_patch_file(&args.patchfile_txt).expect("validated in parse_apply_args");

        if let Some(err) = patchfile.apply(args.dirfd) {
            return Err(global.throw_value(SysErrorJsc::to_js(&err, global)));
        }

        Ok(JSValue::TRUE)
    }

    /// Used in JS tests, see `internal-for-testing.ts` and patch tests.
    pub fn parse(global: &JSGlobalObject, frame: &CallFrame) -> JsResult<JSValue> {
        let arguments_ = frame.arguments_old::<2>();
        // SAFETY: `bun_vm()` never returns null for a Bun-owned global; the VM
        // outlives this call frame.
        let mut arguments = ArgumentsSlice::init(global.bun_vm(), arguments_.slice());

        let Some(patchfile_src_js) = arguments.next_eat() else {
            return Err(global.throw(format_args!(
                "TestingAPIs.parse: expected at least 1 argument, got 0"
            )));
        };
        let patchfile_src_bunstr = OwnedString::new(patchfile_src_js.to_bun_string(global)?);
        let patchfile_src = patchfile_src_bunstr.to_utf8();

        let patchfile = match parse_patch_file(patchfile_src.slice()) {
            Ok(p) => p,
            Err(e) => {
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
        let outstr = BunString::borrow_utf8(&str);
        let js = outstr.to_js(global)?;
        drop(patchfile);
        Ok(js)
    }

    pub fn parse_apply_args(global: &JSGlobalObject, frame: &CallFrame) -> JsResult<ApplyArgs> {
        let arguments_ = frame.arguments_old::<2>();
        // SAFETY: `bun_vm()` never returns null for a Bun-owned global; the VM
        // outlives this call frame.
        let mut arguments = ArgumentsSlice::init(global.bun_vm(), arguments_.slice());

        let Some(patchfile_js) = arguments.next_eat() else {
            return Err(global.throw(format_args!("apply: expected at least 1 argument, got 0")));
        };

        let dir_fd = if let Some(dir_js) = arguments.next_eat() {
            // +1 ref from `to_bun_string`; release via `OwnedString` drop.
            let bunstr = OwnedString::new(dir_js.to_bun_string(global)?);
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
        // +1 ref from `to_bun_string`; release via `OwnedString` drop.
        // `to_utf8()` takes its own ref, so
        // `patchfile_src` outlives this guard.
        let patchfile_bunstr = OwnedString::new(patchfile_bunstr);
        let patchfile_src = patchfile_bunstr.to_utf8();

        // Validate the patch parses; on failure, clean up `dir_fd` and throw.
        // The parsed `PatchFile<'_>` borrows `patchfile_src`, so it cannot be
        // returned alongside its source without a self-referential struct
        // (forbidden by PORTING.md). We discard it here; `apply()` reparses
        // from the owned bytes below.
        if let Err(e) = parse_patch_file(patchfile_src.slice()) {
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

pub struct ApplyArgs {
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

// ──────────────────────────────────────────────────────────────────────────
// C-ABI host-fn shims
//
// `#[bun_jsc::host_fn]` (Free kind) emits an unqualified `fn_name(g, f)` call
// in its generated shim body, so it can't wrap an associated fn directly.
// These module-scope thunks forward to `TestingAPIs::*` so the proc-macro can
// generate the JSC-calling-convention `__jsc_host_*` exports the codegen side
// links against.
// ──────────────────────────────────────────────────────────────────────────

#[bun_jsc::host_fn]
pub fn patch_make_diff(global: &JSGlobalObject, frame: &CallFrame) -> JsResult<JSValue> {
    TestingAPIs::make_diff(global, frame)
}

#[bun_jsc::host_fn]
pub fn patch_apply(global: &JSGlobalObject, frame: &CallFrame) -> JsResult<JSValue> {
    TestingAPIs::apply(global, frame)
}

#[bun_jsc::host_fn]
pub fn patch_parse(global: &JSGlobalObject, frame: &CallFrame) -> JsResult<JSValue> {
    TestingAPIs::parse(global, frame)
}
