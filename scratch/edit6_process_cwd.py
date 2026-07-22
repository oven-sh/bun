# node_process.rs: process.cwd() queries the OS (not the resolver's cached
# top_level_dir) and throws Node's uv_cwd UVException on failure.
import pathlib
f = pathlib.Path("/Users/ciro/code/bun/.claude/worktrees/wave-insp/src/runtime/node/node_process.rs")
s = f.read_text()
old = '''    fn get_cwd(global_object: &JSGlobalObject) -> JsResult<JSValue> {
        let mut buf = PathBuffer::uninit();
        match crate::node::path::get_cwd(&mut buf) {
            bun_sys::Result::Ok(r) => Ok(ZigString::init(r).with_encoding().to_js(global_object)),
            bun_sys::Result::Err(e) => Err(global_object.throw_value(e.to_js(global_object))),
        }
    }'''
new = '''    fn get_cwd(global_object: &JSGlobalObject) -> JsResult<JSValue> {
        // Real syscall (not the resolver's cached top_level_dir): Node's
        // process.cwd() calls uv_cwd() so a deleted cwd must surface here.
        let mut buf = PathBuffer::uninit();
        match Syscall::getcwd(&mut buf[..]) {
            bun_sys::Result::Ok(len) => Ok(ZigString::init(&buf[..len])
                .with_encoding()
                .to_js(global_object)),
            bun_sys::Result::Err(e) => {
                // Node's UVException from `Cwd` (node_process_methods.cc):
                // "CODE: process.cwd failed with error <uv_strerror>[, hint], uv_cwd"
                let (code, label) = e.uv_code_label().unwrap_or(("UNKNOWN", "unknown error"));
                let hint = if e.get_errno() == bun_sys::E::NOENT {
                    ", the current working directory was likely removed \\
                     without changing the working directory"
                } else {
                    ""
                };
                let message =
                    format!("{code}: process.cwd failed with error {label}{hint}, uv_cwd");
                let err = bun_jsc::SystemError {
                    errno: core::ffi::c_int::from(e.errno).wrapping_neg(),
                    code: BunString::static_(code),
                    message: BunString::clone_utf8(message.as_bytes()),
                    path: BunString::empty(),
                    syscall: BunString::static_("uv_cwd"),
                    hostname: BunString::empty(),
                    fd: core::ffi::c_int::MIN,
                    dest: BunString::empty(),
                };
                Err(global_object.throw_value(err.to_error_instance(global_object)))
            }
        }
    }'''
assert s.count(old) == 1, "get_cwd"
s = s.replace(old, new)
f.write_text(s)
print("edit6 OK")
