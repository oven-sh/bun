//! JS testing bindings for `bun.patch`. Keeps `src/patch/` free of JSC types.

use bun_patch::{PatchFile, ParseErr, git_diff_internal, parse_patch_file};
use bun_string::{String as BunString, ZigStringSlice};
use bun_sys::{Fd, FdExt};

// TODO(b2-blocked): bun_jsc::JSGlobalObject / bun_jsc::CallFrame / bun_jsc::JSValue
// TODO(b2-blocked): bun_jsc::JsResult
// `bun_jsc` currently fails to compile, so it cannot be a dependency. Local
// opaque placeholders keep the host-fn signatures shaped correctly; swap to
// `use bun_jsc::{CallFrame, JSGlobalObject, JSValue, JsResult};` once that
// crate is green and re-enabled in Cargo.toml.
#[repr(transparent)] pub struct JSGlobalObject(usize);
#[repr(transparent)] pub struct CallFrame(usize);
#[repr(transparent)] #[derive(Clone, Copy)] pub struct JSValue(usize);
type JsResult<T> = Result<T, ()>;

pub struct TestingAPIs;

impl TestingAPIs {
    // TODO(b2-blocked): bun_jsc::host_fn — proc-macro attribute not yet provided.
    pub fn make_diff(global: &JSGlobalObject, frame: &CallFrame) -> JsResult<JSValue> {
        #[cfg(any())]
        {
            // TODO(b2-blocked): bun_jsc::CallFrame::arguments_old
            // TODO(b2-blocked): bun_jsc::call_frame::ArgumentsSlice
            // TODO(b2-blocked): bun_jsc::JSGlobalObject::bun_vm
            // TODO(b2-blocked): bun_jsc::JSGlobalObject::throw
            // TODO(b2-blocked): bun_jsc::JSGlobalObject::throw_error
            // TODO(b2-blocked): bun_jsc::JSValue::to_bun_string
            // TODO(b2-blocked): bun_string::String::to_js
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
            return match diff {
                Ok(s) => {
                    let result = BunString::clone_utf8(s.as_slice()).to_js(global);
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
            };
        }
        #[cfg(not(any()))]
        {
            let _ = (global, frame);
            todo!("TestingAPIs::make_diff: blocked on bun_jsc stub surface")
        }
    }

    // TODO(b2-blocked): bun_jsc::host_fn — proc-macro attribute not yet provided.
    pub fn apply(global: &JSGlobalObject, frame: &CallFrame) -> JsResult<JSValue> {
        #[cfg(any())]
        {
            // TODO(b2-blocked): bun_jsc::JSGlobalObject::throw_value
            // TODO(b2-blocked): bun_jsc::JSValue::TRUE
            // TODO(b2-blocked): bun_sys::Error::to_js
            let args = match Self::parse_apply_args(global, frame) {
                Err(e) => return Ok(e),
                Ok(a) => a,
            };

            if let Some(err) = args.patchfile.apply(args.dirfd) {
                return global.throw_value(err.to_js(global)?);
            }

            return Ok(JSValue::TRUE);
        }
        #[cfg(not(any()))]
        {
            let _ = (global, frame);
            todo!("TestingAPIs::apply: blocked on bun_jsc stub surface")
        }
    }

    /// Used in JS tests, see `internal-for-testing.ts` and patch tests.
    // TODO(b2-blocked): bun_jsc::host_fn — proc-macro attribute not yet provided.
    pub fn parse(global: &JSGlobalObject, frame: &CallFrame) -> JsResult<JSValue> {
        #[cfg(any())]
        {
            // TODO(b2-blocked): bun_jsc::CallFrame::arguments_old
            // TODO(b2-blocked): bun_jsc::call_frame::ArgumentsSlice
            // TODO(b2-blocked): bun_jsc::JSGlobalObject::throw
            // TODO(b2-blocked): bun_jsc::JSGlobalObject::throw_error
            // TODO(b2-blocked): bun_jsc::JSValue::to_bun_string
            // TODO(b2-blocked): bun_patch::json_fmt
            // TODO(b2-blocked): bun_string::String::to_js
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
                    if e == ParseErr::hunk_header_integrity_check_failed {
                        return global.throw_error(e.into(), "this indicates either that the supplied patch file was incorrect, or there is a bug in Bun. Please check your .patch file, or open a GitHub issue :)");
                    } else {
                        return global.throw_error(e.into(), "failed to parse patch file");
                    }
                }
            };

            // TODO(port): std.json.fmt(patchfile, .{}) — needs a JSON `Display` impl on PatchFile
            let mut str: Vec<u8> = Vec::new();
            {
                use std::io::Write as _;
                write!(&mut str, "{}", bun_patch::json_fmt(&patchfile)).expect("unreachable");
            }
            let outstr = BunString::borrow_utf8(&str);
            let js = outstr.to_js(global);
            drop(patchfile);
            return Ok(js);
        }
        #[cfg(not(any()))]
        {
            let _ = (global, frame);
            todo!("TestingAPIs::parse: blocked on bun_jsc stub surface")
        }
    }

    pub fn parse_apply_args(
        global: &JSGlobalObject,
        frame: &CallFrame,
    ) -> Result<ApplyArgs, JSValue> {
        // TODO(port): Zig return type was `bun.jsc.Node.Maybe(ApplyArgs, jsc.JSValue)`; mapped to plain Result.
        #[cfg(any())]
        {
            // TODO(b2-blocked): bun_jsc::CallFrame::arguments_old
            // TODO(b2-blocked): bun_jsc::call_frame::ArgumentsSlice
            // TODO(b2-blocked): bun_jsc::JSGlobalObject::throw
            // TODO(b2-blocked): bun_jsc::JSGlobalObject::throw_error
            // TODO(b2-blocked): bun_jsc::JSGlobalObject::throw_value
            // TODO(b2-blocked): bun_jsc::JSValue::to_bun_string
            // TODO(b2-blocked): bun_jsc::JSValue::UNDEFINED
            // TODO(b2-blocked): bun_string::String::to_owned_slice_z
            // TODO(b2-blocked): bun_sys::Error::to_js
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
                let path = bunstr.to_owned_slice_z();

                match bun_sys::open(&path, bun_sys::O::DIRECTORY | bun_sys::O::RDONLY, 0) {
                    Err(e) => {
                        let Ok(js_err) = e.with_path(path.as_bytes()).to_js(global) else {
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
                    let _ = global.throw_error(e.into(), "failed to parse patchfile");
                    return Err(JSValue::UNDEFINED);
                }
            };

            // TODO(port): lifetime — `PatchFile<'a>` borrows from `patchfile_src` (ZigStringSlice),
            // making `ApplyArgs` self-referential. Zig's `ZigString.Slice` self-owns its allocation
            // so this was safe; in Rust this needs either an owning-ref pattern or storing the
            // source bytes as `Vec<u8>` and reparsing on use. Revisit once bun_jsc is un-gated.
            return Ok(ApplyArgs {
                dirfd: dir_fd,
                patchfile: patch_file,
                patchfile_txt: patchfile_src,
            });
        }
        #[cfg(not(any()))]
        {
            let _ = (global, frame);
            todo!("TestingAPIs::parse_apply_args: blocked on bun_jsc stub surface")
        }
    }
}

pub struct ApplyArgs {
    // TODO(port): lifetime — see note in parse_apply_args; Zig type was jsc.ZigString.Slice (self-owning).
    patchfile_txt: ZigStringSlice,
    // TODO(port): lifetime — `PatchFile<'a>` borrows `patchfile_txt`; using `'static` as a
    // placeholder while the constructing body above is gated. Revisit with owning-ref or
    // `ouroboros`-style self-reference once bun_jsc is un-gated.
    patchfile: PatchFile<'static>,
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
//   confidence: low (fn bodies gated on bun_jsc stub surface)
//   todos:      see TODO(b2-blocked) markers
//   notes:      ApplyArgs is self-referential (PatchFile borrows ZigStringSlice);
//               git_diff_internal/json_fmt return types assumed.
// ──────────────────────────────────────────────────────────────────────────
