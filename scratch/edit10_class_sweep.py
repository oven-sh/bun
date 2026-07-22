# Fix the whole class: every synthetic-entry-path getcwd at startup uses the
# exe-dir fallback (stdin, cron, node-emulation relative script, feedback).
import pathlib
f = pathlib.Path("/Users/ciro/code/bun/.claude/worktrees/wave-insp/src/runtime/cli/run_command.rs")
s = f.read_text()

# cron (1028) and exec_stdin (2927) share the exact same 2-line shape; replace both.
old = '''        let mut cwd_buf = PathBuffer::uninit();
        let cwd = bun_core::getcwd(&mut cwd_buf)?;
        let cwd_bytes = cwd.as_bytes();
        let cwd_len = cwd_bytes.len();
        entry_point_buf[..cwd_len].copy_from_slice(cwd_bytes);
        entry_point_buf[cwd_len..cwd_len + STDIN_TRIGGER.len()].copy_from_slice(STDIN_TRIGGER);'''
new = '''        let mut cwd_buf = PathBuffer::uninit();
        let cwd = bun_core::getcwd_or_exe_dir(&mut cwd_buf);
        let cwd_bytes = cwd.as_bytes();
        let cwd_len = cwd_bytes.len();
        entry_point_buf[..cwd_len].copy_from_slice(cwd_bytes);
        entry_point_buf[cwd_len..cwd_len + STDIN_TRIGGER.len()].copy_from_slice(STDIN_TRIGGER);'''
assert s.count(old) == 1, f"stdin site x{s.count(old)}"
s = s.replace(old, new)

old = '''            let mut cwd_buf = PathBuffer::uninit();
            let cwd = bun_core::getcwd(&mut cwd_buf)?;
            let cwd_bytes = cwd.as_bytes();
            let mut eval_path: Vec<u8> = Vec::with_capacity(cwd_bytes.len() + EVAL_TRIGGER.len());'''
new = '''            let mut cwd_buf = PathBuffer::uninit();
            let cwd = bun_core::getcwd_or_exe_dir(&mut cwd_buf);
            let cwd_bytes = cwd.as_bytes();
            let mut eval_path: Vec<u8> = Vec::with_capacity(cwd_bytes.len() + EVAL_TRIGGER.len());'''
assert s.count(old) == 1, f"cron site x{s.count(old)}"
s = s.replace(old, new)

old = '''            let mut cwd_buf = PathBuffer::uninit();
            let cwd = bun_core::getcwd(&mut cwd_buf)?;
            let cwd_len = cwd.as_bytes().len();
            cwd_buf[cwd_len] = b'/';'''
new = '''            let mut cwd_buf = PathBuffer::uninit();
            let cwd = bun_core::getcwd_or_exe_dir(&mut cwd_buf);
            let cwd_len = cwd.as_bytes().len();
            cwd_buf[cwd_len] = b'/';'''
assert s.count(old) == 1, f"as-node relative site x{s.count(old)}"
s = s.replace(old, new)

old = '''        let cwd = bun_core::getcwd(unsafe {
            &mut *entry_point_buf.as_mut_ptr().cast::<bun_core::PathBuffer>()
        })?;'''
new = '''        let cwd = bun_core::getcwd_or_exe_dir(unsafe {
            &mut *entry_point_buf.as_mut_ptr().cast::<bun_core::PathBuffer>()
        });'''
assert s.count(old) == 1, f"feedback site x{s.count(old)}"
s = s.replace(old, new)
f.write_text(s)
print("edit10 OK")
