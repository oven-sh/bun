# bun_sys::Error: expose the libuv (uv_strerror) label + code, for callers
# that need Node's UVException message shape (process.cwd).
import pathlib
f = pathlib.Path("/Users/ciro/code/bun/.claude/worktrees/wave-insp/src/sys/Error.rs")
s = f.read_text()
old = '''    pub fn msg(&self) -> Option<&'static [u8]> {'''
new = '''    /// (code, uv_strerror label) pair, e.g. `("ENOENT", "no such file or
    /// directory")` — the pieces of Node's `UVException` message.
    pub fn uv_code_label(&self) -> Option<(&'static str, &'static str)> {
        let (code, system_errno) = self.get_error_code_tag_name()?;
        Some((code, libuv_error_map::LIBUV_ERROR_MAP[system_errno]))
    }

    pub fn msg(&self) -> Option<&'static [u8]> {'''
assert s.count(old) == 1, "msg anchor"
s = s.replace(old, new)
f.write_text(s)
print("edit5 OK")
