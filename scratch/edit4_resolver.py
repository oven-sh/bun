# resolver lib.rs FileSystem::init: seed with the exe-dir fallback when the
# cwd is unreachable instead of failing VM boot.
import pathlib
f = pathlib.Path("/Users/ciro/code/bun/.claude/worktrees/wave-insp/src/resolver/lib.rs")
s = f.read_text()
old = '''                None => {
                    let mut buf = bun_paths::PathBuffer::default();
                    let n = bun_sys::getcwd(&mut buf[..])?;
                    DirnameStore::instance().append_slice(&buf[..n])?
                }'''
new = '''                None => {
                    let mut buf = bun_paths::PathBuffer::default();
                    let cwd = bun_core::getcwd_or_exe_dir(&mut buf);
                    DirnameStore::instance().append_slice(cwd.as_bytes())?
                }'''
assert s.count(old) == 1, "resolver init"
s = s.replace(old, new)
f.write_text(s)
print("edit4 OK")
