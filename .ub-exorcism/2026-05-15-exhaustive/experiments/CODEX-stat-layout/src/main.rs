use std::mem::{align_of, offset_of, size_of};

macro_rules! const_check {
    ($field:ident) => {
        const _: () = assert!(
            offset_of!(rustix::fs::Stat, $field) == offset_of!(libc::stat, $field)
        );
    };
}

const _: () = assert!(size_of::<rustix::fs::Stat>() == size_of::<libc::stat>());
const _: () = assert!(align_of::<rustix::fs::Stat>() == align_of::<libc::stat>());
const_check!(st_dev);
const_check!(st_ino);
const_check!(st_nlink);
const_check!(st_mode);
const_check!(st_uid);
const_check!(st_gid);
const_check!(st_rdev);
const_check!(st_size);
const_check!(st_blksize);
const_check!(st_blocks);
const_check!(st_atime);
const_check!(st_atime_nsec);
const_check!(st_mtime);
const_check!(st_mtime_nsec);
const_check!(st_ctime);
const_check!(st_ctime_nsec);

macro_rules! check {
    ($field:ident) => {{
        let rustix_off = offset_of!(rustix::fs::Stat, $field);
        let libc_off = offset_of!(libc::stat, $field);
        println!(
            "{:<16} rustix={:<3} libc={:<3} {}",
            stringify!($field),
            rustix_off,
            libc_off,
            if rustix_off == libc_off { "OK" } else { "MISMATCH" }
        );
        assert_eq!(rustix_off, libc_off, "offset mismatch for {}", stringify!($field));
    }};
}

fn main() {
    println!("target = {}", std::env::var("TARGET").unwrap_or_else(|_| std::env::consts::ARCH.into()));
    println!(
        "size  rustix={} libc={}",
        size_of::<rustix::fs::Stat>(),
        size_of::<libc::stat>()
    );
    println!(
        "align rustix={} libc={}",
        align_of::<rustix::fs::Stat>(),
        align_of::<libc::stat>()
    );
    assert_eq!(size_of::<rustix::fs::Stat>(), size_of::<libc::stat>());
    assert_eq!(align_of::<rustix::fs::Stat>(), align_of::<libc::stat>());

    check!(st_dev);
    check!(st_ino);
    check!(st_nlink);
    check!(st_mode);
    check!(st_uid);
    check!(st_gid);
    check!(st_rdev);
    check!(st_size);
    check!(st_blksize);
    check!(st_blocks);
    check!(st_atime);
    check!(st_atime_nsec);
    check!(st_mtime);
    check!(st_mtime_nsec);
    check!(st_ctime);
    check!(st_ctime_nsec);
}
