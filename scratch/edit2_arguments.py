# Arguments.rs: tolerate deleted cwd at startup (node Environment::GetCwd behavior)
# + declare --interactive (routed to the REPL in Command::which).
import pathlib
f = pathlib.Path("/Users/ciro/code/bun/.claude/worktrees/wave-insp/src/runtime/cli/Arguments.rs")
s = f.read_text()

old = '''    let cwd: Box<[u8]> = if let Some(cwd_arg) = args.option(b"--cwd") {
        let mut outbuf = PathBuffer::uninit();
        let cwd_len = bun_sys::getcwd(&mut *outbuf)?;
        let out = resolve_path::join_abs::<platform::Loose>(&outbuf[..cwd_len], cwd_arg);'''
new = '''    let cwd: Box<[u8]> = if let Some(cwd_arg) = args.option(b"--cwd") {
        let mut outbuf = PathBuffer::uninit();
        let base = bun_core::getcwd_or_exe_dir(&mut outbuf);
        let out = resolve_path::join_abs::<platform::Loose>(base.as_bytes(), cwd_arg);'''
assert s.count(old) == 1, "old1"
s = s.replace(old, new)

old2 = '''    } else {
        let mut temp = PathBuffer::uninit();
        let len = bun_sys::getcwd(&mut *temp)?;
        Box::<[u8]>::from(&temp[..len])
    };'''
new2 = '''    } else {
        // A deleted cwd must not abort startup (Node boots and lets
        // `process.cwd()` throw later); fall back to the executable's dir.
        let mut temp = PathBuffer::uninit();
        Box::<[u8]>::from(bun_core::getcwd_or_exe_dir(&mut temp).as_bytes())
    };'''
assert s.count(old2) == 1, "old2"
s = s.replace(old2, new2)

old3 = '''    parse_param!("--stack-trace-limit <STR>"),
];'''
new3 = '''    parse_param!("--stack-trace-limit <STR>"),
    // `node --interactive` compat: `Command::which()` routes it to the REPL;
    // declared (hidden) so `Arguments.parse` under the run table accepts it.
    parse_param!("--interactive"),
];'''
assert s.count(old3) == 1, "old3"
s = s.replace(old3, new3)

f.write_text(s)
print("edit2 OK")
