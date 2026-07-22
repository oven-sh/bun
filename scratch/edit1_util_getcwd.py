# Edit src/bun_core/util.rs: split getcwd into getcwd_len + add getcwd_or_exe_dir
import pathlib
f = pathlib.Path("/Users/ciro/code/bun/.claude/worktrees/wave-insp/src/bun_core/util.rs")
s = f.read_text()

old = '''/// Writes the current working directory into the caller's `PathBuffer` and
/// returns the NUL-terminated slice on success.
pub fn getcwd(buf: &mut PathBuffer) -> crate::CrateResult<&ZStr> {
    #[cfg(unix)]'''
new = '''/// Writes the current working directory into the caller's `PathBuffer` and
/// returns the NUL-terminated slice on success.
pub fn getcwd(buf: &mut PathBuffer) -> crate::CrateResult<&ZStr> {
    let len = getcwd_len(buf)?;
    Ok(ZStr::from_buf(&buf.0, len))
}

/// `getcwd` tolerating an unreachable cwd (e.g. deleted while we run): falls
/// back to the executable's directory like Node's `Environment::GetCwd`, so
/// startup proceeds and `process.cwd()` surfaces the real error later.
pub fn getcwd_or_exe_dir(buf: &mut PathBuffer) -> &ZStr {
    let len = match getcwd_len(buf) {
        Ok(n) => n,
        Err(_) => {
            let dir: &[u8] = self_exe_path()
                .ok()
                .and_then(|p| dirname(p.as_bytes()))
                .unwrap_or(if cfg!(windows) { b"C:\\\\" } else { b"/" });
            buf.0[..dir.len()].copy_from_slice(dir);
            buf.0[dir.len()] = 0;
            dir.len()
        }
    };
    ZStr::from_buf(&buf.0, len)
}

/// Length-returning core of [`getcwd`]; `buf` holds the NUL-terminated path.
fn getcwd_len(buf: &mut PathBuffer) -> crate::CrateResult<usize> {
    #[cfg(unix)]'''
assert s.count(old) == 1, f"old pattern count = {s.count(old)}"
s = s.replace(old, new)

old2 = '''        let len = libc::strlen(p);
        Ok(ZStr::from_buf(&buf.0, len))
    }
    #[cfg(windows)]'''
new2 = '''        Ok(libc::strlen(p))
    }
    #[cfg(windows)]'''
assert s.count(old2) == 1, f"old2 pattern count = {s.count(old2)}"
s = s.replace(old2, new2)

old3 = '''        out[bi] = 0;
        Ok(ZStr::from_buf(&buf.0[..], bi))
    }
    #[cfg(not(any(unix, windows)))]'''
new3 = '''        out[bi] = 0;
        Ok(bi)
    }
    #[cfg(not(any(unix, windows)))]'''
assert s.count(old3) == 1, f"old3 pattern count = {s.count(old3)}"
s = s.replace(old3, new3)

f.write_text(s)
print("edit1 OK")
