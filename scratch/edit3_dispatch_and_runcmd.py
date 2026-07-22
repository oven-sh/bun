# mod.rs: route `bun --interactive` to the REPL (node -i compat).
# run_command.rs: eval/node-emulation entry paths tolerate a deleted cwd.
import pathlib
root = pathlib.Path("/Users/ciro/code/bun/.claude/worktrees/wave-insp")

f = root / "src/runtime/cli/mod.rs"
s = f.read_text()
old = '''        while !first_arg_name.is_empty()
            && first_arg_name[0] == b'-'
            && !(first_arg_name.len() > 1 && first_arg_name[1] == b'e')
        {
            match iter.next() {
                Some(n) => first_arg_name = n,
                None => return Tag::AutoCommand,
            }
        }'''
new = '''        while !first_arg_name.is_empty()
            && first_arg_name[0] == b'-'
            && !(first_arg_name.len() > 1 && first_arg_name[1] == b'e')
        {
            // Node compat: `bun --interactive` opens the REPL (node -i).
            if first_arg_name == b"--interactive" {
                return Tag::ReplCommand;
            }
            match iter.next() {
                Some(n) => first_arg_name = n,
                None => return Tag::AutoCommand,
            }
        }'''
assert s.count(old) == 1, "mod.rs while loop"
s = s.replace(old, new)
f.write_text(s)

f = root / "src/runtime/cli/run_command.rs"
s = f.read_text()
# exec_eval + exec_as_if_node synthetic [eval] paths: 2 identical sites
old = '''        let mut entry_point_buf = [0u8; MAX_PATH_BYTES + EVAL_TRIGGER.len()];
        let mut cwd_buf = PathBuffer::uninit();
        let cwd = bun_core::getcwd(&mut cwd_buf)?;
        let cwd_bytes = cwd.as_bytes();'''
new = '''        let mut entry_point_buf = [0u8; MAX_PATH_BYTES + EVAL_TRIGGER.len()];
        let mut cwd_buf = PathBuffer::uninit();
        let cwd = bun_core::getcwd_or_exe_dir(&mut cwd_buf);
        let cwd_bytes = cwd.as_bytes();'''
assert s.count(old) == 1, f"exec_eval site x{s.count(old)}"
s = s.replace(old, new)

old = '''            let mut entry_point_buf = [0u8; MAX_PATH_BYTES + EVAL_TRIGGER.len()];
            let mut cwd_buf = PathBuffer::uninit();
            let cwd = bun_core::getcwd(&mut cwd_buf)?;
            let cwd_bytes = cwd.as_bytes();'''
new = '''            let mut entry_point_buf = [0u8; MAX_PATH_BYTES + EVAL_TRIGGER.len()];
            let mut cwd_buf = PathBuffer::uninit();
            let cwd = bun_core::getcwd_or_exe_dir(&mut cwd_buf);
            let cwd_bytes = cwd.as_bytes();'''
assert s.count(old) == 1, f"exec_as_if_node site x{s.count(old)}"
s = s.replace(old, new)
f.write_text(s)
print("edit3 OK")
