# Review fixes round 2:
# (a) --cwd: absolute arg needs no base; relative arg keeps the hard error
#     when the cwd is unreachable (silent exe-dir base could chdir wrong).
# (b) --cwd: store the post-chdir physical cwd (mirrors process.chdir) so
#     process.cwd(), path.resolve, and the resolver agree.
# (c) node_process.rs: shrink the SystemError literal via ..Default::default().
# (d) path.rs: delete the now-dead `get_cwd` alias.
import pathlib
root = pathlib.Path("/Users/ciro/code/bun/.claude/worktrees/wave-insp")

f = root / "src/runtime/cli/Arguments.rs"
s = f.read_text()
old = '''    let cwd: Box<[u8]> = if let Some(cwd_arg) = args.option(b"--cwd") {
        let mut outbuf = PathBuffer::uninit();
        let base = bun_core::getcwd_or_exe_dir(&mut outbuf);
        let out = resolve_path::join_abs::<platform::Loose>(base.as_bytes(), cwd_arg);
        // `chdir` wants a NUL-terminated path; `join_abs` returns a borrowed
        // slice into a threadlocal buffer, so dupe-Z once and reuse for both
        // the `chdir` arg and the stored `absolute_working_dir`.
        let out_z = bun_core::ZBox::from_bytes(out);
        if let bun_sys::Result::Err(err) = bun_sys::chdir(&out_z) {
            Output::err(
                err,
                "Could not change directory to \\"{}\\"\\n",
                format_args!("{}", BStr::new(cwd_arg)),
            );
            Global::exit(1);
        }
        Box::<[u8]>::from(out_z.as_bytes())
    } else {'''
new = '''    let cwd: Box<[u8]> = if let Some(cwd_arg) = args.option(b"--cwd") {
        let mut outbuf = PathBuffer::uninit();
        // An absolute --cwd needs no base; a relative one still requires a
        // live cwd (an exe-dir base would silently chdir somewhere else).
        let base: &[u8] = if bun_paths::is_absolute(cwd_arg) {
            b""
        } else {
            let len = bun_sys::getcwd(&mut *outbuf)?;
            &outbuf[..len]
        };
        let out = resolve_path::join_abs::<platform::Loose>(base, cwd_arg);
        // `chdir` wants a NUL-terminated path; `join_abs` returns a borrowed
        // slice into a threadlocal buffer, so dupe-Z once and reuse for both
        // the `chdir` arg and the stored `absolute_working_dir`.
        let out_z = bun_core::ZBox::from_bytes(out);
        if let bun_sys::Result::Err(err) = bun_sys::chdir(&out_z) {
            Output::err(
                err,
                "Could not change directory to \\"{}\\"\\n",
                format_args!("{}", BStr::new(cwd_arg)),
            );
            Global::exit(1);
        }
        // Store the post-chdir physical path (mirrors process.chdir) so
        // process.cwd(), path.resolve, and the resolver agree on one form.
        let mut phys = PathBuffer::uninit();
        match bun_core::getcwd(&mut phys) {
            Ok(p) => Box::<[u8]>::from(p.as_bytes()),
            Err(_) => Box::<[u8]>::from(out_z.as_bytes()),
        }
    } else {'''
assert s.count(old) == 1, "Arguments --cwd branch"
s = s.replace(old, new)
f.write_text(s)

f = root / "src/runtime/node/node_process.rs"
s = f.read_text()
old = '''                let err = bun_jsc::SystemError {
                    errno: core::ffi::c_int::from(e.errno).wrapping_neg(),
                    code: BunString::static_(code),
                    message: BunString::clone_utf8(message.as_bytes()),
                    path: BunString::empty(),
                    syscall: BunString::static_("uv_cwd"),
                    hostname: BunString::empty(),
                    fd: core::ffi::c_int::MIN,
                    dest: BunString::empty(),
                };'''
new = '''                let err = bun_jsc::SystemError {
                    errno: core::ffi::c_int::from(e.errno).wrapping_neg(),
                    code: BunString::static_(code),
                    message: BunString::clone_utf8(message.as_bytes()),
                    syscall: BunString::static_("uv_cwd"),
                    ..Default::default()
                };'''
assert s.count(old) == 1, "SystemError literal"
s = s.replace(old, new)
f.write_text(s)

f = root / "src/runtime/node/path.rs"
s = f.read_text()
old = '''
// Alias for naming consistency.
pub use get_cwd_u8 as get_cwd;'''
assert s.count(old) == 1, "dead alias"
s = s.replace(old, "")
f.write_text(s)
print("edit11 OK")
