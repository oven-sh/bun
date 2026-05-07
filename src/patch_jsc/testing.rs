//! JS testing bindings for `bun.patch`. Keeps `src/patch/` free of JSC types.

use bun_jsc::{
    ArgumentsSlice, CallFrame, JSGlobalObject, JSValue, JsResult, StringJsc, SysErrorJsc,
};
use bun_patch::{ParseErr, PatchFile, git_diff_internal, parse_patch_file};
use bun_string::String as BunString;
use bun_sys::{Fd, FdExt};

pub struct TestingAPIs;

impl TestingAPIs {
    // PORT NOTE: `#[bun_jsc::host_fn]` Free-kind shim emits an unqualified
    // `fn_name(g, f)` call, so it cannot wrap an associated fn. The C-ABI
    // shim is emitted at module scope below (`__jsc_host_*`).
    pub fn make_diff(global: &JSGlobalObject, frame: &CallFrame) -> JsResult<JSValue> {
        let arguments_ = frame.arguments_old::<2>();
        // SAFETY: `bun_vm()` never returns null for a Bun-owned global; the VM
        // outlives this call frame.
        let mut arguments = ArgumentsSlice::init(unsafe { &*global.bun_vm() }, arguments_.slice());

        let Some(old_folder_jsval) = arguments.next_eat() else {
            return Err(global.throw(format_args!("expected 2 strings")));
        };
        let old_folder_bunstr = old_folder_jsval.to_bun_string(global)?;

        let Some(new_folder_jsval) = arguments.next_eat() else {
            return Err(global.throw(format_args!("expected 2 strings")));
        };
        let new_folder_bunstr = new_folder_jsval.to_bun_string(global)?;

        let old_folder = old_folder_bunstr.to_utf8();
        let new_folder = new_folder_bunstr.to_utf8();

        let diff = match git_diff_internal(old_folder.slice(), new_folder.slice()) {
            Ok(d) => d,
            Err(e) => return Err(global.throw_error(e, "failed to make diff")),
        };
        match diff {
            Ok(s) => {
                let result = BunString::clone_utf8(s.as_slice()).to_js(global);
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
        let args = match Self::parse_apply_args(global, frame) {
            Err(e) => return Ok(e),
            Ok(a) => a,
        };

        // TODO(port): lifetime — `PatchFile<'a>` borrows its source bytes, so the Zig
        // `ApplyArgs { patchfile, patchfile_txt }` pair is self-referential in Rust.
        // PORTING.md forbids Box::leak / lifetime-extend, so we store the owned bytes
        // in `ApplyArgs` and reparse here (already validated in `parse_apply_args`).
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
        let mut arguments = ArgumentsSlice::init(unsafe { &*global.bun_vm() }, arguments_.slice());

        let Some(patchfile_src_js) = arguments.next_eat() else {
            return Err(global.throw(format_args!(
                "TestingAPIs.parse: expected at least 1 argument, got 0"
            )));
        };
        let patchfile_src_bunstr = patchfile_src_js.to_bun_string(global)?;
        let patchfile_src = patchfile_src_bunstr.to_utf8();

        let patchfile = match parse_patch_file(patchfile_src.slice()) {
            Ok(p) => p,
            Err(e) => {
                if e == ParseErr::hunk_header_integrity_check_failed {
                    return Err(global.throw_error(e.into(), "this indicates either that the supplied patch file was incorrect, or there is a bug in Bun. Please check your .patch file, or open a GitHub issue :)"));
                } else {
                    return Err(global.throw_error(e.into(), "failed to parse patch file"));
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

    pub fn parse_apply_args(
        global: &JSGlobalObject,
        frame: &CallFrame,
    ) -> Result<ApplyArgs, JSValue> {
        // TODO(port): Zig return type was `bun.jsc.Node.Maybe(ApplyArgs, jsc.JSValue)`; mapped to plain Result.
        let arguments_ = frame.arguments_old::<2>();
        // SAFETY: `bun_vm()` never returns null for a Bun-owned global; the VM
        // outlives this call frame.
        let mut arguments = ArgumentsSlice::init(unsafe { &*global.bun_vm() }, arguments_.slice());

        let Some(patchfile_js) = arguments.next_eat() else {
            let _ = global.throw(format_args!("apply: expected at least 1 argument, got 0"));
            return Err(JSValue::UNDEFINED);
        };

        let dir_fd = if let Some(dir_js) = arguments.next_eat() {
            let Ok(bunstr) = dir_js.to_bun_string(global) else {
                return Err(JSValue::UNDEFINED);
            };
            let path = bunstr.to_owned_slice_z();

            match bun_sys::open(path.as_zstr(), bun_sys::O::DIRECTORY | bun_sys::O::RDONLY, 0) {
                Err(e) => {
                    let js_err = SysErrorJsc::to_js(&e.with_path(path.as_bytes()), global);
                    let _ = global.throw_value(js_err);
                    return Err(JSValue::UNDEFINED);
                }
                Ok(fd) => fd,
            }
        } else {
            Fd::cwd()
        };

        let Ok(patchfile_bunstr) = patchfile_js.to_bun_string(global) else {
            return Err(JSValue::UNDEFINED);
        };
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
            let _ = global.throw_error(e.into(), "failed to parse patchfile");
            return Err(JSValue::UNDEFINED);
        }

        Ok(ApplyArgs {
            dirfd: dir_fd,
            patchfile_txt: patchfile_src.into_vec(),
        })
    }
}

pub struct ApplyArgs {
    // TODO(port): lifetime — Zig stored both `ZigString.Slice` and `PatchFile`
    // (which borrows it). Self-referential in Rust; PORTING.md forbids
    // Box::leak/lifetime-extend, so we store owned bytes and reparse on use.
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
// PORT STATUS
//   source:     src/patch_jsc/testing.zig (147 lines)
//   confidence: medium (all bodies un-gated and compiling)
//   todos:      bun_jsc::host_fn proc-macro
//   notes:      ApplyArgs reshaped to own Vec<u8> + reparse (avoids
//               self-reference forbidden by PORTING.md §Pointers/§Forbidden).
// ──────────────────────────────────────────────────────────────────────────
