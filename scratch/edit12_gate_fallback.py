# The exe-dir fallback is a runtime-only affordance (Node parity). Package
# manager & tooling commands keep the hard error so they never act on a tree
# found above the executable.
import pathlib
f = pathlib.Path("/Users/ciro/code/bun/.claude/worktrees/wave-insp/src/runtime/cli/Arguments.rs")
s = f.read_text()
old = '''    } else {
        // A deleted cwd must not abort startup (Node boots and lets
        // `process.cwd()` throw later); fall back to the executable's dir.
        let mut temp = PathBuffer::uninit();
        Box::<[u8]>::from(bun_core::getcwd_or_exe_dir(&mut temp).as_bytes())
    };'''
new = '''    } else if matches!(
        cmd,
        CommandTag::AutoCommand | CommandTag::RunCommand | CommandTag::RunAsNodeCommand
    ) {
        // A deleted cwd must not abort the runtime (Node boots and lets
        // `process.cwd()` throw later); fall back to the executable's dir.
        let mut temp = PathBuffer::uninit();
        Box::<[u8]>::from(bun_core::getcwd_or_exe_dir(&mut temp).as_bytes())
    } else {
        // Everything else (install/test/build/...) must not silently act on
        // whatever project happens to live above the executable.
        let mut temp = PathBuffer::uninit();
        let len = bun_sys::getcwd(&mut *temp)?;
        Box::<[u8]>::from(&temp[..len])
    };'''
assert s.count(old) == 1, "fallback gate"
s = s.replace(old, new)
f.write_text(s)
print("edit12 OK")
