//! JS testing bindings for `bun.patch`. Keeps `src/patch/` free of JSC types.

use bun_jsc::{CallFrame, JSGlobalObject, JSValue, JsResult};
use bun_jsc::call_frame::ArgumentsSlice;
use bun_patch::{PatchFile, git_diff_internal, parse_patch_file};
use bun_str::StringJsc as _; // extension trait: .to_js(global) on bun_str::String
use bun_sys::Fd;

pub struct TestingAPIs;

impl TestingAPIs {
    #[bun_jsc::host_fn]
    pub fn make_diff(global: &JSGlobalObject, frame: &CallFrame) -> JsResult<JSValue> {
        let arguments_ = frame.arguments_old(2);
        let mut arguments = ArgumentsSlice::init(global.bun_vm(), arguments_.slice());

        let Some(old_folder_jsval) = arguments.next_eat() else {
            return global.throw(format_args!("expected 2 strings"));
        };
        let old_folder_bunstr = old_folder_jsval.to_bun_string(global)?;

        let Some(new_folder_jsval) = arguments.next_eat() else {
            return global.throw(format_args!("expected 2 strings"));
        };
        let new_folder_bunstr = new_folder_jsval.to_bun_string(global)?;

        let old_folder = old_folder_bunstr.to_utf8();
        let new_folder = new_folder_bunstr.to_utf8();

        let diff = match git_diff_internal(old_folder.slice(), new_folder.slice()) {
            Ok(d) => d,
            Err(e) => return global.throw_error(e, "failed to make diff"),
        };
        // TODO(port): git_diff_internal return type — Zig returns `!Maybe(ArrayList(u8), ArrayList(u8))`;
        // assumed here as `Result<Result<Vec<u8>, Vec<u8>>, bun_core::Error>`.
        match diff {
            Ok(s) => {
                let result = bun_str::String::from_bytes(s.as_slice()).to_js(global);
                drop(s);
                Ok(result)
            }
            Err(e) => {
                let result = global.throw(format_args!(
                    "failed to make diff: {}",
                    bstr::BStr::new(e.as_slice())
                ));
                drop(e);
                result
            }
        }
    }

    #[bun_jsc::host_fn]
    pub fn apply(global: &JSGlobalObject, frame: &CallFrame) -> JsResult<JSValue> {
        let args = match Self::parse_apply_args(global, frame) {
            Err(e) => return Ok(e),
            Ok(a) => a,
        };

        if let Some(err) = args.patchfile.apply(args.dirfd) {
            return global.throw_value(err.to_js(global)?);
        }

        Ok(JSValue::TRUE)
    }

    /// Used in JS tests, see `internal-for-testing.ts` and patch tests.
    #[bun_jsc::host_fn]
    pub fn parse(global: &JSGlobalObject, frame: &CallFrame) -> JsResult<JSValue> {
        let arguments_ = frame.arguments_old(2);
        let mut arguments = ArgumentsSlice::init(global.bun_vm(), arguments_.slice());

        let Some(patchfile_src_js) = arguments.next_eat() else {
            return global.throw(format_args!(
                "TestingAPIs.parse: expected at least 1 argument, got 0"
            ));
        };
        let patchfile_src_bunstr = patchfile_src_js.to_bun_string(global)?;
        let patchfile_src = patchfile_src_bunstr.to_utf8();

        let patchfile = match parse_patch_file(patchfile_src.slice()) {
            Ok(p) => p,
            Err(e) => {
                if e == bun_core::err!("hunk_header_integrity_check_failed") {
                    return global.throw_error(e, "this indicates either that the supplied patch file was incorrect, or there is a bug in Bun. Please check your .patch file, or open a GitHub issue :)");
                } else {
                    return global.throw_error(e, "failed to parse patch file");
                }
            }
        };

        // TODO(port): std.json.fmt(patchfile, .{}) — needs a JSON `Display` impl (or serde_json) on PatchFile
        let mut str: Vec<u8> = Vec::new();
        {
            use std::io::Write as _;
            write!(&mut str, "{}", bun_patch::json_fmt(&patchfile)).expect("unreachable");
        }
        let outstr = bun_str::String::borrow_utf8(&str);
        let js = outstr.to_js(global);
        drop(patchfile);
        Ok(js)
    }

    pub fn parse_apply_args(
        global: &JSGlobalObject,
        frame: &CallFrame,
    ) -> Result<ApplyArgs, JSValue> {
        // TODO(port): Zig return type was `bun.jsc.Node.Maybe(ApplyArgs, jsc.JSValue)`; mapped to plain Result.
        let arguments_ = frame.arguments_old(2);
        let mut arguments = ArgumentsSlice::init(global.bun_vm(), arguments_.slice());

        let Some(patchfile_js) = arguments.next_eat() else {
            let _ = global.throw(format_args!("apply: expected at least 1 argument, got 0"));
            return Err(JSValue::UNDEFINED);
        };

        let dir_fd = if let Some(dir_js) = arguments.next_eat() {
            let Ok(bunstr) = dir_js.to_bun_string(global) else {
                return Err(JSValue::UNDEFINED);
            };
            let path = bunstr.to_owned_slice_z().expect("unreachable");

            match bun_sys::open(&path, bun_sys::O::DIRECTORY | bun_sys::O::RDONLY, 0) {
                Err(e) => {
                    let Ok(js_err) = e.with_path(&path).to_js(global) else {
                        return Err(JSValue::UNDEFINED);
                    };
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

        let patch_file = match parse_patch_file(patchfile_src.slice()) {
            Ok(p) => p,
            Err(e) => {
                // TODO: HAVE @zackradisic REVIEW THIS DIFF
                if Fd::cwd() != dir_fd {
                    dir_fd.close();
                }

                drop(patchfile_src);
                let _ = global.throw_error(e, "failed to parse patchfile");
                return Err(JSValue::UNDEFINED);
            }
        };

        // TODO(port): lifetime — `patchfile_src` (Utf8Slice) may borrow from `patchfile_bunstr`,
        // which is dropped at end of this scope. Zig's ZigString.Slice owns its allocation; verify
        // bun_str::Utf8Slice ownership semantics or switch ApplyArgs.patchfile_txt to an owned type.
        Ok(ApplyArgs {
            dirfd: dir_fd,
            patchfile: patch_file,
            patchfile_txt: patchfile_src,
        })
    }
}

pub struct ApplyArgs {
    // TODO(port): lifetime — see note in parse_apply_args; Zig type was jsc.ZigString.Slice (self-owning).
    patchfile_txt: bun_str::Utf8Slice,
    patchfile: PatchFile,
    dirfd: Fd,
}

impl Drop for ApplyArgs {
    fn drop(&mut self) {
        // patchfile_txt and patchfile freed by their own Drop impls.
        // TODO: HAVE @zackradisic REVIEW THIS DIFF
        if Fd::cwd() != self.dirfd {
            self.dirfd.close();
        }
    }
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/patch_jsc/testing.zig (147 lines)
//   confidence: medium
//   todos:      5
//   notes:      Utf8Slice stored in ApplyArgs may dangle (borrows dropped bun_str::String); git_diff_internal/json_fmt return types assumed.
// ──────────────────────────────────────────────────────────────────────────
