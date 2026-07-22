# Review fixes: (1) --interactive only opens the REPL when no script follows
# (node runs the script and ignores -i); (2) bound the exe-dir fallback copy.
import pathlib
root = pathlib.Path("/Users/ciro/code/bun/.claude/worktrees/wave-insp")

f = root / "src/runtime/cli/mod.rs"
s = f.read_text()
old = '''        while !first_arg_name.is_empty()
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
new = '''        let mut interactive = false;
        while !first_arg_name.is_empty()
            && first_arg_name[0] == b'-'
            && !(first_arg_name.len() > 1 && first_arg_name[1] == b'e')
        {
            // Node compat: `--interactive` opens the REPL, but only when no
            // script follows (node runs the script and ignores the flag).
            if first_arg_name == b"--interactive" {
                interactive = true;
            }
            match iter.next() {
                Some(n) => first_arg_name = n,
                None => {
                    return if interactive {
                        Tag::ReplCommand
                    } else {
                        Tag::AutoCommand
                    };
                }
            }
        }'''
assert s.count(old) == 1, "mod.rs dispatch"
s = s.replace(old, new)
f.write_text(s)

f = root / "src/bun_core/util.rs"
s = f.read_text()
old = '''        Err(_) => {
            let dir: &[u8] = self_exe_path()
                .ok()
                .and_then(|p| dirname(p.as_bytes()))
                .unwrap_or(if cfg!(windows) { b"C:\\\\" } else { b"/" });
            buf.0[..dir.len()].copy_from_slice(dir);
            buf.0[dir.len()] = 0;
            dir.len()
        }'''
new = '''        Err(_) => {
            let dir: &[u8] = self_exe_path()
                .ok()
                .and_then(|p| dirname(p.as_bytes()))
                // Reject a dir that can't fit with its NUL (paths from
                // /proc/self/exe are not bounded by MAX_PATH_BYTES).
                .filter(|d| d.len() < buf.0.len())
                .unwrap_or(if cfg!(windows) { b"C:\\\\" } else { b"/" });
            buf.0[..dir.len()].copy_from_slice(dir);
            buf.0[dir.len()] = 0;
            dir.len()
        }'''
assert s.count(old) == 1, "util.rs bounds"
s = s.replace(old, new)
f.write_text(s)
print("edit9 OK")
