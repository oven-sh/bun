//! Which file an address is mapped from, for the report of a bus error. The kernel raises one at a page of a mapped file that the
//! file no longer has: something has cut the file short while it was mapped.

use core::ffi::c_void;

/// "start-end perms offset device inode      path". None: the mapping is another, or of no file.
fn path_of_mapping_with(line: &[u8], address: usize) -> Option<&[u8]> {
    let mut fields = line.splitn(6, |&byte| byte == b' ');
    let mut range = fields.next()?.splitn(2, |&byte| byte == b'-');
    let mut bound = || usize::from_str_radix(core::str::from_utf8(range.next()?).ok()?, 16).ok();
    let (start, end) = (bound()?, bound()?);
    if !(start..end).contains(&address) {
        return None;
    }
    let path = fields.nth(4)?.trim_ascii_start();
    path.starts_with(b"/").then_some(path)
}

/// Runs in a signal handler: system calls and the stack, nothing else.
pub(crate) fn write_what_happened_at(address: usize, write: &mut dyn FnMut(&[u8])) {
    // SAFETY: the path is NUL-terminated.
    let fd = unsafe { libc::open(c"/proc/self/maps".as_ptr(), libc::O_RDONLY | libc::O_CLOEXEC) };
    if fd < 0 {
        return;
    }
    // Room for a line with the longest path there is.
    let mut buffer = [0u8; 4096 + 128];
    let mut filled = 0;
    'file: loop {
        let rest = &mut buffer[filled..];
        // SAFETY: `rest` is writable for its length.
        let count = unsafe { libc::read(fd, rest.as_mut_ptr().cast::<c_void>(), rest.len()) };
        if count <= 0 {
            break;
        }
        filled += count as usize;
        let mut line_start = 0;
        while let Some(length) = buffer[line_start..filled].iter().position(|&byte| byte == b'\n') {
            let line = &buffer[line_start..line_start + length];
            line_start += length + 1;
            if let Some(path) = path_of_mapping_with(line, address) {
                write(b"The file ");
                write(path);
                write(b", which was mapped into memory, has been truncated.\n");
                break 'file;
            }
        }
        if line_start == 0 && filled == buffer.len() {
            break;
        }
        buffer.copy_within(line_start..filled, 0);
        filled -= line_start;
    }
    // SAFETY: `fd` is open and ours.
    unsafe { libc::close(fd) };
}
