// Written by misctools/portable/bindings/darwin.ts. Do not edit.
//
// The size, the alignment and the offsets of every structure of bun_darwin_sys and the value of every
// constant, as this program has them: the lines that misctools/portable/bindings/darwin_layout.c prints
// from the headers of macOS.
#![allow(clippy::all, deprecated, non_snake_case)]

use core::mem::{align_of, offset_of, size_of};
use std::io::Write as _;

use bun_darwin_sys::{constants, types};

fn size_of_field<T, F>(_: fn(&T) -> &F) -> usize {
    size_of::<F>()
}

pub fn facts(out: &mut Vec<u8>) {
    {
        type T = types::attrgroup_t;
        let _ = writeln!(out, "{{\"fact\":\"size\",\"of\":\"attrgroup_t\",\"value\":{}}}", size_of::<T>());
        let _ = writeln!(out, "{{\"fact\":\"align\",\"of\":\"attrgroup_t\",\"value\":{}}}", align_of::<T>());
    }
    {
        type T = types::attrlist;
        let _ = writeln!(out, "{{\"fact\":\"size\",\"of\":\"attrlist\",\"value\":{}}}", size_of::<T>());
        let _ = writeln!(out, "{{\"fact\":\"align\",\"of\":\"attrlist\",\"value\":{}}}", align_of::<T>());
        let _ = writeln!(out, "{{\"fact\":\"offset\",\"of\":\"attrlist.bitmapcount\",\"value\":{}}}", offset_of!(T, bitmapcount));
        let _ = writeln!(out, "{{\"fact\":\"field size\",\"of\":\"attrlist.bitmapcount\",\"value\":{}}}", size_of_field(|value: &T| &value.bitmapcount));
        let _ = writeln!(out, "{{\"fact\":\"offset\",\"of\":\"attrlist.reserved\",\"value\":{}}}", offset_of!(T, reserved));
        let _ = writeln!(out, "{{\"fact\":\"field size\",\"of\":\"attrlist.reserved\",\"value\":{}}}", size_of_field(|value: &T| &value.reserved));
        let _ = writeln!(out, "{{\"fact\":\"offset\",\"of\":\"attrlist.commonattr\",\"value\":{}}}", offset_of!(T, commonattr));
        let _ = writeln!(out, "{{\"fact\":\"field size\",\"of\":\"attrlist.commonattr\",\"value\":{}}}", size_of_field(|value: &T| &value.commonattr));
        let _ = writeln!(out, "{{\"fact\":\"offset\",\"of\":\"attrlist.volattr\",\"value\":{}}}", offset_of!(T, volattr));
        let _ = writeln!(out, "{{\"fact\":\"field size\",\"of\":\"attrlist.volattr\",\"value\":{}}}", size_of_field(|value: &T| &value.volattr));
        let _ = writeln!(out, "{{\"fact\":\"offset\",\"of\":\"attrlist.dirattr\",\"value\":{}}}", offset_of!(T, dirattr));
        let _ = writeln!(out, "{{\"fact\":\"field size\",\"of\":\"attrlist.dirattr\",\"value\":{}}}", size_of_field(|value: &T| &value.dirattr));
        let _ = writeln!(out, "{{\"fact\":\"offset\",\"of\":\"attrlist.fileattr\",\"value\":{}}}", offset_of!(T, fileattr));
        let _ = writeln!(out, "{{\"fact\":\"field size\",\"of\":\"attrlist.fileattr\",\"value\":{}}}", size_of_field(|value: &T| &value.fileattr));
        let _ = writeln!(out, "{{\"fact\":\"offset\",\"of\":\"attrlist.forkattr\",\"value\":{}}}", offset_of!(T, forkattr));
        let _ = writeln!(out, "{{\"fact\":\"field size\",\"of\":\"attrlist.forkattr\",\"value\":{}}}", size_of_field(|value: &T| &value.forkattr));
    }
    {
        type T = types::blkcnt_t;
        let _ = writeln!(out, "{{\"fact\":\"size\",\"of\":\"blkcnt_t\",\"value\":{}}}", size_of::<T>());
        let _ = writeln!(out, "{{\"fact\":\"align\",\"of\":\"blkcnt_t\",\"value\":{}}}", align_of::<T>());
    }
    {
        type T = types::blksize_t;
        let _ = writeln!(out, "{{\"fact\":\"size\",\"of\":\"blksize_t\",\"value\":{}}}", size_of::<T>());
        let _ = writeln!(out, "{{\"fact\":\"align\",\"of\":\"blksize_t\",\"value\":{}}}", align_of::<T>());
    }
    {
        type T = types::copyfile_flags_t;
        let _ = writeln!(out, "{{\"fact\":\"size\",\"of\":\"copyfile_flags_t\",\"value\":{}}}", size_of::<T>());
        let _ = writeln!(out, "{{\"fact\":\"align\",\"of\":\"copyfile_flags_t\",\"value\":{}}}", align_of::<T>());
    }
    {
        type T = types::copyfile_state_t;
        let _ = writeln!(out, "{{\"fact\":\"size\",\"of\":\"copyfile_state_t\",\"value\":{}}}", size_of::<T>());
        let _ = writeln!(out, "{{\"fact\":\"align\",\"of\":\"copyfile_state_t\",\"value\":{}}}", align_of::<T>());
    }
    {
        type T = types::dev_t;
        let _ = writeln!(out, "{{\"fact\":\"size\",\"of\":\"dev_t\",\"value\":{}}}", size_of::<T>());
        let _ = writeln!(out, "{{\"fact\":\"align\",\"of\":\"dev_t\",\"value\":{}}}", align_of::<T>());
    }
    {
        type T = types::dirent;
        let _ = writeln!(out, "{{\"fact\":\"size\",\"of\":\"dirent\",\"value\":{}}}", size_of::<T>());
        let _ = writeln!(out, "{{\"fact\":\"align\",\"of\":\"dirent\",\"value\":{}}}", align_of::<T>());
        let _ = writeln!(out, "{{\"fact\":\"offset\",\"of\":\"dirent.d_ino\",\"value\":{}}}", offset_of!(T, d_ino));
        let _ = writeln!(out, "{{\"fact\":\"field size\",\"of\":\"dirent.d_ino\",\"value\":{}}}", size_of_field(|value: &T| &value.d_ino));
        let _ = writeln!(out, "{{\"fact\":\"offset\",\"of\":\"dirent.d_seekoff\",\"value\":{}}}", offset_of!(T, d_seekoff));
        let _ = writeln!(out, "{{\"fact\":\"field size\",\"of\":\"dirent.d_seekoff\",\"value\":{}}}", size_of_field(|value: &T| &value.d_seekoff));
        let _ = writeln!(out, "{{\"fact\":\"offset\",\"of\":\"dirent.d_reclen\",\"value\":{}}}", offset_of!(T, d_reclen));
        let _ = writeln!(out, "{{\"fact\":\"field size\",\"of\":\"dirent.d_reclen\",\"value\":{}}}", size_of_field(|value: &T| &value.d_reclen));
        let _ = writeln!(out, "{{\"fact\":\"offset\",\"of\":\"dirent.d_namlen\",\"value\":{}}}", offset_of!(T, d_namlen));
        let _ = writeln!(out, "{{\"fact\":\"field size\",\"of\":\"dirent.d_namlen\",\"value\":{}}}", size_of_field(|value: &T| &value.d_namlen));
        let _ = writeln!(out, "{{\"fact\":\"offset\",\"of\":\"dirent.d_type\",\"value\":{}}}", offset_of!(T, d_type));
        let _ = writeln!(out, "{{\"fact\":\"field size\",\"of\":\"dirent.d_type\",\"value\":{}}}", size_of_field(|value: &T| &value.d_type));
        let _ = writeln!(out, "{{\"fact\":\"offset\",\"of\":\"dirent.d_name\",\"value\":{}}}", offset_of!(T, d_name));
        let _ = writeln!(out, "{{\"fact\":\"field size\",\"of\":\"dirent.d_name\",\"value\":{}}}", size_of_field(|value: &T| &value.d_name));
    }
    {
        type T = types::flock;
        let _ = writeln!(out, "{{\"fact\":\"size\",\"of\":\"flock\",\"value\":{}}}", size_of::<T>());
        let _ = writeln!(out, "{{\"fact\":\"align\",\"of\":\"flock\",\"value\":{}}}", align_of::<T>());
        let _ = writeln!(out, "{{\"fact\":\"offset\",\"of\":\"flock.l_start\",\"value\":{}}}", offset_of!(T, l_start));
        let _ = writeln!(out, "{{\"fact\":\"field size\",\"of\":\"flock.l_start\",\"value\":{}}}", size_of_field(|value: &T| &value.l_start));
        let _ = writeln!(out, "{{\"fact\":\"offset\",\"of\":\"flock.l_len\",\"value\":{}}}", offset_of!(T, l_len));
        let _ = writeln!(out, "{{\"fact\":\"field size\",\"of\":\"flock.l_len\",\"value\":{}}}", size_of_field(|value: &T| &value.l_len));
        let _ = writeln!(out, "{{\"fact\":\"offset\",\"of\":\"flock.l_pid\",\"value\":{}}}", offset_of!(T, l_pid));
        let _ = writeln!(out, "{{\"fact\":\"field size\",\"of\":\"flock.l_pid\",\"value\":{}}}", size_of_field(|value: &T| &value.l_pid));
        let _ = writeln!(out, "{{\"fact\":\"offset\",\"of\":\"flock.l_type\",\"value\":{}}}", offset_of!(T, l_type));
        let _ = writeln!(out, "{{\"fact\":\"field size\",\"of\":\"flock.l_type\",\"value\":{}}}", size_of_field(|value: &T| &value.l_type));
        let _ = writeln!(out, "{{\"fact\":\"offset\",\"of\":\"flock.l_whence\",\"value\":{}}}", offset_of!(T, l_whence));
        let _ = writeln!(out, "{{\"fact\":\"field size\",\"of\":\"flock.l_whence\",\"value\":{}}}", size_of_field(|value: &T| &value.l_whence));
    }
    {
        type T = types::fsid_t;
        let _ = writeln!(out, "{{\"fact\":\"size\",\"of\":\"fsid_t\",\"value\":{}}}", size_of::<T>());
        let _ = writeln!(out, "{{\"fact\":\"align\",\"of\":\"fsid_t\",\"value\":{}}}", align_of::<T>());
    }
    {
        type T = types::fstore_t;
        let _ = writeln!(out, "{{\"fact\":\"size\",\"of\":\"fstore_t\",\"value\":{}}}", size_of::<T>());
        let _ = writeln!(out, "{{\"fact\":\"align\",\"of\":\"fstore_t\",\"value\":{}}}", align_of::<T>());
        let _ = writeln!(out, "{{\"fact\":\"offset\",\"of\":\"fstore_t.fst_flags\",\"value\":{}}}", offset_of!(T, fst_flags));
        let _ = writeln!(out, "{{\"fact\":\"field size\",\"of\":\"fstore_t.fst_flags\",\"value\":{}}}", size_of_field(|value: &T| &value.fst_flags));
        let _ = writeln!(out, "{{\"fact\":\"offset\",\"of\":\"fstore_t.fst_posmode\",\"value\":{}}}", offset_of!(T, fst_posmode));
        let _ = writeln!(out, "{{\"fact\":\"field size\",\"of\":\"fstore_t.fst_posmode\",\"value\":{}}}", size_of_field(|value: &T| &value.fst_posmode));
        let _ = writeln!(out, "{{\"fact\":\"offset\",\"of\":\"fstore_t.fst_offset\",\"value\":{}}}", offset_of!(T, fst_offset));
        let _ = writeln!(out, "{{\"fact\":\"field size\",\"of\":\"fstore_t.fst_offset\",\"value\":{}}}", size_of_field(|value: &T| &value.fst_offset));
        let _ = writeln!(out, "{{\"fact\":\"offset\",\"of\":\"fstore_t.fst_length\",\"value\":{}}}", offset_of!(T, fst_length));
        let _ = writeln!(out, "{{\"fact\":\"field size\",\"of\":\"fstore_t.fst_length\",\"value\":{}}}", size_of_field(|value: &T| &value.fst_length));
        let _ = writeln!(out, "{{\"fact\":\"offset\",\"of\":\"fstore_t.fst_bytesalloc\",\"value\":{}}}", offset_of!(T, fst_bytesalloc));
        let _ = writeln!(out, "{{\"fact\":\"field size\",\"of\":\"fstore_t.fst_bytesalloc\",\"value\":{}}}", size_of_field(|value: &T| &value.fst_bytesalloc));
    }
    {
        type T = types::gid_t;
        let _ = writeln!(out, "{{\"fact\":\"size\",\"of\":\"gid_t\",\"value\":{}}}", size_of::<T>());
        let _ = writeln!(out, "{{\"fact\":\"align\",\"of\":\"gid_t\",\"value\":{}}}", align_of::<T>());
    }
    {
        type T = types::host_flavor_t;
        let _ = writeln!(out, "{{\"fact\":\"size\",\"of\":\"host_flavor_t\",\"value\":{}}}", size_of::<T>());
        let _ = writeln!(out, "{{\"fact\":\"align\",\"of\":\"host_flavor_t\",\"value\":{}}}", align_of::<T>());
    }
    {
        type T = types::host_info64_t;
        let _ = writeln!(out, "{{\"fact\":\"size\",\"of\":\"host_info64_t\",\"value\":{}}}", size_of::<T>());
        let _ = writeln!(out, "{{\"fact\":\"align\",\"of\":\"host_info64_t\",\"value\":{}}}", align_of::<T>());
    }
    {
        type T = types::host_t;
        let _ = writeln!(out, "{{\"fact\":\"size\",\"of\":\"host_t\",\"value\":{}}}", size_of::<T>());
        let _ = writeln!(out, "{{\"fact\":\"align\",\"of\":\"host_t\",\"value\":{}}}", align_of::<T>());
    }
    {
        type T = types::ino_t;
        let _ = writeln!(out, "{{\"fact\":\"size\",\"of\":\"ino_t\",\"value\":{}}}", size_of::<T>());
        let _ = writeln!(out, "{{\"fact\":\"align\",\"of\":\"ino_t\",\"value\":{}}}", align_of::<T>());
    }
    {
        type T = types::integer_t;
        let _ = writeln!(out, "{{\"fact\":\"size\",\"of\":\"integer_t\",\"value\":{}}}", size_of::<T>());
        let _ = writeln!(out, "{{\"fact\":\"align\",\"of\":\"integer_t\",\"value\":{}}}", align_of::<T>());
    }
    {
        type T = types::intptr_t;
        let _ = writeln!(out, "{{\"fact\":\"size\",\"of\":\"intptr_t\",\"value\":{}}}", size_of::<T>());
        let _ = writeln!(out, "{{\"fact\":\"align\",\"of\":\"intptr_t\",\"value\":{}}}", align_of::<T>());
    }
    {
        type T = types::iovec;
        let _ = writeln!(out, "{{\"fact\":\"size\",\"of\":\"iovec\",\"value\":{}}}", size_of::<T>());
        let _ = writeln!(out, "{{\"fact\":\"align\",\"of\":\"iovec\",\"value\":{}}}", align_of::<T>());
        let _ = writeln!(out, "{{\"fact\":\"offset\",\"of\":\"iovec.iov_base\",\"value\":{}}}", offset_of!(T, iov_base));
        let _ = writeln!(out, "{{\"fact\":\"field size\",\"of\":\"iovec.iov_base\",\"value\":{}}}", size_of_field(|value: &T| &value.iov_base));
        let _ = writeln!(out, "{{\"fact\":\"offset\",\"of\":\"iovec.iov_len\",\"value\":{}}}", offset_of!(T, iov_len));
        let _ = writeln!(out, "{{\"fact\":\"field size\",\"of\":\"iovec.iov_len\",\"value\":{}}}", size_of_field(|value: &T| &value.iov_len));
    }
    {
        type T = types::kern_return_t;
        let _ = writeln!(out, "{{\"fact\":\"size\",\"of\":\"kern_return_t\",\"value\":{}}}", size_of::<T>());
        let _ = writeln!(out, "{{\"fact\":\"align\",\"of\":\"kern_return_t\",\"value\":{}}}", align_of::<T>());
    }
    {
        type T = types::kevent;
        let _ = writeln!(out, "{{\"fact\":\"size\",\"of\":\"kevent\",\"value\":{}}}", size_of::<T>());
        let _ = writeln!(out, "{{\"fact\":\"align\",\"of\":\"kevent\",\"value\":{}}}", align_of::<T>());
        let _ = writeln!(out, "{{\"fact\":\"offset\",\"of\":\"kevent.ident\",\"value\":{}}}", offset_of!(T, ident));
        let _ = writeln!(out, "{{\"fact\":\"field size\",\"of\":\"kevent.ident\",\"value\":{}}}", { let value: T = unsafe { core::mem::zeroed() }; let field = value.ident; size_of_val(&field) });
        let _ = writeln!(out, "{{\"fact\":\"offset\",\"of\":\"kevent.filter\",\"value\":{}}}", offset_of!(T, filter));
        let _ = writeln!(out, "{{\"fact\":\"field size\",\"of\":\"kevent.filter\",\"value\":{}}}", { let value: T = unsafe { core::mem::zeroed() }; let field = value.filter; size_of_val(&field) });
        let _ = writeln!(out, "{{\"fact\":\"offset\",\"of\":\"kevent.flags\",\"value\":{}}}", offset_of!(T, flags));
        let _ = writeln!(out, "{{\"fact\":\"field size\",\"of\":\"kevent.flags\",\"value\":{}}}", { let value: T = unsafe { core::mem::zeroed() }; let field = value.flags; size_of_val(&field) });
        let _ = writeln!(out, "{{\"fact\":\"offset\",\"of\":\"kevent.fflags\",\"value\":{}}}", offset_of!(T, fflags));
        let _ = writeln!(out, "{{\"fact\":\"field size\",\"of\":\"kevent.fflags\",\"value\":{}}}", { let value: T = unsafe { core::mem::zeroed() }; let field = value.fflags; size_of_val(&field) });
        let _ = writeln!(out, "{{\"fact\":\"offset\",\"of\":\"kevent.data\",\"value\":{}}}", offset_of!(T, data));
        let _ = writeln!(out, "{{\"fact\":\"field size\",\"of\":\"kevent.data\",\"value\":{}}}", { let value: T = unsafe { core::mem::zeroed() }; let field = value.data; size_of_val(&field) });
        let _ = writeln!(out, "{{\"fact\":\"offset\",\"of\":\"kevent.udata\",\"value\":{}}}", offset_of!(T, udata));
        let _ = writeln!(out, "{{\"fact\":\"field size\",\"of\":\"kevent.udata\",\"value\":{}}}", { let value: T = unsafe { core::mem::zeroed() }; let field = value.udata; size_of_val(&field) });
    }
    {
        type T = types::kevent64_s;
        let _ = writeln!(out, "{{\"fact\":\"size\",\"of\":\"kevent64_s\",\"value\":{}}}", size_of::<T>());
        let _ = writeln!(out, "{{\"fact\":\"align\",\"of\":\"kevent64_s\",\"value\":{}}}", align_of::<T>());
        let _ = writeln!(out, "{{\"fact\":\"offset\",\"of\":\"kevent64_s.ident\",\"value\":{}}}", offset_of!(T, ident));
        let _ = writeln!(out, "{{\"fact\":\"field size\",\"of\":\"kevent64_s.ident\",\"value\":{}}}", size_of_field(|value: &T| &value.ident));
        let _ = writeln!(out, "{{\"fact\":\"offset\",\"of\":\"kevent64_s.filter\",\"value\":{}}}", offset_of!(T, filter));
        let _ = writeln!(out, "{{\"fact\":\"field size\",\"of\":\"kevent64_s.filter\",\"value\":{}}}", size_of_field(|value: &T| &value.filter));
        let _ = writeln!(out, "{{\"fact\":\"offset\",\"of\":\"kevent64_s.flags\",\"value\":{}}}", offset_of!(T, flags));
        let _ = writeln!(out, "{{\"fact\":\"field size\",\"of\":\"kevent64_s.flags\",\"value\":{}}}", size_of_field(|value: &T| &value.flags));
        let _ = writeln!(out, "{{\"fact\":\"offset\",\"of\":\"kevent64_s.fflags\",\"value\":{}}}", offset_of!(T, fflags));
        let _ = writeln!(out, "{{\"fact\":\"field size\",\"of\":\"kevent64_s.fflags\",\"value\":{}}}", size_of_field(|value: &T| &value.fflags));
        let _ = writeln!(out, "{{\"fact\":\"offset\",\"of\":\"kevent64_s.data\",\"value\":{}}}", offset_of!(T, data));
        let _ = writeln!(out, "{{\"fact\":\"field size\",\"of\":\"kevent64_s.data\",\"value\":{}}}", size_of_field(|value: &T| &value.data));
        let _ = writeln!(out, "{{\"fact\":\"offset\",\"of\":\"kevent64_s.udata\",\"value\":{}}}", offset_of!(T, udata));
        let _ = writeln!(out, "{{\"fact\":\"field size\",\"of\":\"kevent64_s.udata\",\"value\":{}}}", size_of_field(|value: &T| &value.udata));
        let _ = writeln!(out, "{{\"fact\":\"offset\",\"of\":\"kevent64_s.ext\",\"value\":{}}}", offset_of!(T, ext));
        let _ = writeln!(out, "{{\"fact\":\"field size\",\"of\":\"kevent64_s.ext\",\"value\":{}}}", size_of_field(|value: &T| &value.ext));
    }
    {
        type T = types::mach_msg_type_number_t;
        let _ = writeln!(out, "{{\"fact\":\"size\",\"of\":\"mach_msg_type_number_t\",\"value\":{}}}", size_of::<T>());
        let _ = writeln!(out, "{{\"fact\":\"align\",\"of\":\"mach_msg_type_number_t\",\"value\":{}}}", align_of::<T>());
    }
    {
        type T = types::mach_port_t;
        let _ = writeln!(out, "{{\"fact\":\"size\",\"of\":\"mach_port_t\",\"value\":{}}}", size_of::<T>());
        let _ = writeln!(out, "{{\"fact\":\"align\",\"of\":\"mach_port_t\",\"value\":{}}}", align_of::<T>());
    }
    {
        type T = types::mach_timebase_info;
        let _ = writeln!(out, "{{\"fact\":\"size\",\"of\":\"mach_timebase_info\",\"value\":{}}}", size_of::<T>());
        let _ = writeln!(out, "{{\"fact\":\"align\",\"of\":\"mach_timebase_info\",\"value\":{}}}", align_of::<T>());
        let _ = writeln!(out, "{{\"fact\":\"offset\",\"of\":\"mach_timebase_info.numer\",\"value\":{}}}", offset_of!(T, numer));
        let _ = writeln!(out, "{{\"fact\":\"field size\",\"of\":\"mach_timebase_info.numer\",\"value\":{}}}", size_of_field(|value: &T| &value.numer));
        let _ = writeln!(out, "{{\"fact\":\"offset\",\"of\":\"mach_timebase_info.denom\",\"value\":{}}}", offset_of!(T, denom));
        let _ = writeln!(out, "{{\"fact\":\"field size\",\"of\":\"mach_timebase_info.denom\",\"value\":{}}}", size_of_field(|value: &T| &value.denom));
    }
    {
        type T = types::mach_timebase_info_data_t;
        let _ = writeln!(out, "{{\"fact\":\"size\",\"of\":\"mach_timebase_info_data_t\",\"value\":{}}}", size_of::<T>());
        let _ = writeln!(out, "{{\"fact\":\"align\",\"of\":\"mach_timebase_info_data_t\",\"value\":{}}}", align_of::<T>());
    }
    {
        type T = types::mode_t;
        let _ = writeln!(out, "{{\"fact\":\"size\",\"of\":\"mode_t\",\"value\":{}}}", size_of::<T>());
        let _ = writeln!(out, "{{\"fact\":\"align\",\"of\":\"mode_t\",\"value\":{}}}", align_of::<T>());
    }
    {
        type T = types::natural_t;
        let _ = writeln!(out, "{{\"fact\":\"size\",\"of\":\"natural_t\",\"value\":{}}}", size_of::<T>());
        let _ = writeln!(out, "{{\"fact\":\"align\",\"of\":\"natural_t\",\"value\":{}}}", align_of::<T>());
    }
    {
        type T = types::nfds_t;
        let _ = writeln!(out, "{{\"fact\":\"size\",\"of\":\"nfds_t\",\"value\":{}}}", size_of::<T>());
        let _ = writeln!(out, "{{\"fact\":\"align\",\"of\":\"nfds_t\",\"value\":{}}}", align_of::<T>());
    }
    {
        type T = types::nl_item;
        let _ = writeln!(out, "{{\"fact\":\"size\",\"of\":\"nl_item\",\"value\":{}}}", size_of::<T>());
        let _ = writeln!(out, "{{\"fact\":\"align\",\"of\":\"nl_item\",\"value\":{}}}", align_of::<T>());
    }
    {
        type T = types::nlink_t;
        let _ = writeln!(out, "{{\"fact\":\"size\",\"of\":\"nlink_t\",\"value\":{}}}", size_of::<T>());
        let _ = writeln!(out, "{{\"fact\":\"align\",\"of\":\"nlink_t\",\"value\":{}}}", align_of::<T>());
    }
    {
        type T = types::off_t;
        let _ = writeln!(out, "{{\"fact\":\"size\",\"of\":\"off_t\",\"value\":{}}}", size_of::<T>());
        let _ = writeln!(out, "{{\"fact\":\"align\",\"of\":\"off_t\",\"value\":{}}}", align_of::<T>());
    }
    {
        type T = types::os_unfair_lock;
        let _ = writeln!(out, "{{\"fact\":\"size\",\"of\":\"os_unfair_lock\",\"value\":{}}}", size_of::<T>());
        let _ = writeln!(out, "{{\"fact\":\"align\",\"of\":\"os_unfair_lock\",\"value\":{}}}", align_of::<T>());
    }
    {
        type T = types::os_unfair_lock_s;
        let _ = writeln!(out, "{{\"fact\":\"size\",\"of\":\"os_unfair_lock_s\",\"value\":{}}}", size_of::<T>());
        let _ = writeln!(out, "{{\"fact\":\"align\",\"of\":\"os_unfair_lock_s\",\"value\":{}}}", align_of::<T>());
    }
    {
        type T = types::os_unfair_lock_t;
        let _ = writeln!(out, "{{\"fact\":\"size\",\"of\":\"os_unfair_lock_t\",\"value\":{}}}", size_of::<T>());
        let _ = writeln!(out, "{{\"fact\":\"align\",\"of\":\"os_unfair_lock_t\",\"value\":{}}}", align_of::<T>());
    }
    {
        type T = types::pid_t;
        let _ = writeln!(out, "{{\"fact\":\"size\",\"of\":\"pid_t\",\"value\":{}}}", size_of::<T>());
        let _ = writeln!(out, "{{\"fact\":\"align\",\"of\":\"pid_t\",\"value\":{}}}", align_of::<T>());
    }
    {
        type T = types::pollfd;
        let _ = writeln!(out, "{{\"fact\":\"size\",\"of\":\"pollfd\",\"value\":{}}}", size_of::<T>());
        let _ = writeln!(out, "{{\"fact\":\"align\",\"of\":\"pollfd\",\"value\":{}}}", align_of::<T>());
        let _ = writeln!(out, "{{\"fact\":\"offset\",\"of\":\"pollfd.fd\",\"value\":{}}}", offset_of!(T, fd));
        let _ = writeln!(out, "{{\"fact\":\"field size\",\"of\":\"pollfd.fd\",\"value\":{}}}", size_of_field(|value: &T| &value.fd));
        let _ = writeln!(out, "{{\"fact\":\"offset\",\"of\":\"pollfd.events\",\"value\":{}}}", offset_of!(T, events));
        let _ = writeln!(out, "{{\"fact\":\"field size\",\"of\":\"pollfd.events\",\"value\":{}}}", size_of_field(|value: &T| &value.events));
        let _ = writeln!(out, "{{\"fact\":\"offset\",\"of\":\"pollfd.revents\",\"value\":{}}}", offset_of!(T, revents));
        let _ = writeln!(out, "{{\"fact\":\"field size\",\"of\":\"pollfd.revents\",\"value\":{}}}", size_of_field(|value: &T| &value.revents));
    }
    {
        type T = types::posix_spawn_file_actions_t;
        let _ = writeln!(out, "{{\"fact\":\"size\",\"of\":\"posix_spawn_file_actions_t\",\"value\":{}}}", size_of::<T>());
        let _ = writeln!(out, "{{\"fact\":\"align\",\"of\":\"posix_spawn_file_actions_t\",\"value\":{}}}", align_of::<T>());
    }
    {
        type T = types::posix_spawnattr_t;
        let _ = writeln!(out, "{{\"fact\":\"size\",\"of\":\"posix_spawnattr_t\",\"value\":{}}}", size_of::<T>());
        let _ = writeln!(out, "{{\"fact\":\"align\",\"of\":\"posix_spawnattr_t\",\"value\":{}}}", align_of::<T>());
    }
    {
        type T = types::processor_cpu_load_info;
        let _ = writeln!(out, "{{\"fact\":\"size\",\"of\":\"processor_cpu_load_info\",\"value\":{}}}", size_of::<T>());
        let _ = writeln!(out, "{{\"fact\":\"align\",\"of\":\"processor_cpu_load_info\",\"value\":{}}}", align_of::<T>());
        let _ = writeln!(out, "{{\"fact\":\"offset\",\"of\":\"processor_cpu_load_info.cpu_ticks\",\"value\":{}}}", offset_of!(T, cpu_ticks));
        let _ = writeln!(out, "{{\"fact\":\"field size\",\"of\":\"processor_cpu_load_info.cpu_ticks\",\"value\":{}}}", size_of_field(|value: &T| &value.cpu_ticks));
    }
    {
        type T = types::processor_cpu_load_info_data_t;
        let _ = writeln!(out, "{{\"fact\":\"size\",\"of\":\"processor_cpu_load_info_data_t\",\"value\":{}}}", size_of::<T>());
        let _ = writeln!(out, "{{\"fact\":\"align\",\"of\":\"processor_cpu_load_info_data_t\",\"value\":{}}}", align_of::<T>());
    }
    {
        type T = types::processor_flavor_t;
        let _ = writeln!(out, "{{\"fact\":\"size\",\"of\":\"processor_flavor_t\",\"value\":{}}}", size_of::<T>());
        let _ = writeln!(out, "{{\"fact\":\"align\",\"of\":\"processor_flavor_t\",\"value\":{}}}", align_of::<T>());
    }
    {
        type T = types::processor_info_array_t;
        let _ = writeln!(out, "{{\"fact\":\"size\",\"of\":\"processor_info_array_t\",\"value\":{}}}", size_of::<T>());
        let _ = writeln!(out, "{{\"fact\":\"align\",\"of\":\"processor_info_array_t\",\"value\":{}}}", align_of::<T>());
    }
    {
        type T = types::pthread_t;
        let _ = writeln!(out, "{{\"fact\":\"size\",\"of\":\"pthread_t\",\"value\":{}}}", size_of::<T>());
        let _ = writeln!(out, "{{\"fact\":\"align\",\"of\":\"pthread_t\",\"value\":{}}}", align_of::<T>());
    }
    {
        type T = types::sa_family_t;
        let _ = writeln!(out, "{{\"fact\":\"size\",\"of\":\"sa_family_t\",\"value\":{}}}", size_of::<T>());
        let _ = writeln!(out, "{{\"fact\":\"align\",\"of\":\"sa_family_t\",\"value\":{}}}", align_of::<T>());
    }
    {
        type T = types::sf_hdtr;
        let _ = writeln!(out, "{{\"fact\":\"size\",\"of\":\"sf_hdtr\",\"value\":{}}}", size_of::<T>());
        let _ = writeln!(out, "{{\"fact\":\"align\",\"of\":\"sf_hdtr\",\"value\":{}}}", align_of::<T>());
        let _ = writeln!(out, "{{\"fact\":\"offset\",\"of\":\"sf_hdtr.headers\",\"value\":{}}}", offset_of!(T, headers));
        let _ = writeln!(out, "{{\"fact\":\"field size\",\"of\":\"sf_hdtr.headers\",\"value\":{}}}", size_of_field(|value: &T| &value.headers));
        let _ = writeln!(out, "{{\"fact\":\"offset\",\"of\":\"sf_hdtr.hdr_cnt\",\"value\":{}}}", offset_of!(T, hdr_cnt));
        let _ = writeln!(out, "{{\"fact\":\"field size\",\"of\":\"sf_hdtr.hdr_cnt\",\"value\":{}}}", size_of_field(|value: &T| &value.hdr_cnt));
        let _ = writeln!(out, "{{\"fact\":\"offset\",\"of\":\"sf_hdtr.trailers\",\"value\":{}}}", offset_of!(T, trailers));
        let _ = writeln!(out, "{{\"fact\":\"field size\",\"of\":\"sf_hdtr.trailers\",\"value\":{}}}", size_of_field(|value: &T| &value.trailers));
        let _ = writeln!(out, "{{\"fact\":\"offset\",\"of\":\"sf_hdtr.trl_cnt\",\"value\":{}}}", offset_of!(T, trl_cnt));
        let _ = writeln!(out, "{{\"fact\":\"field size\",\"of\":\"sf_hdtr.trl_cnt\",\"value\":{}}}", size_of_field(|value: &T| &value.trl_cnt));
    }
    {
        type T = types::sigset_t;
        let _ = writeln!(out, "{{\"fact\":\"size\",\"of\":\"sigset_t\",\"value\":{}}}", size_of::<T>());
        let _ = writeln!(out, "{{\"fact\":\"align\",\"of\":\"sigset_t\",\"value\":{}}}", align_of::<T>());
    }
    {
        type T = types::size_t;
        let _ = writeln!(out, "{{\"fact\":\"size\",\"of\":\"size_t\",\"value\":{}}}", size_of::<T>());
        let _ = writeln!(out, "{{\"fact\":\"align\",\"of\":\"size_t\",\"value\":{}}}", align_of::<T>());
    }
    {
        type T = types::sockaddr;
        let _ = writeln!(out, "{{\"fact\":\"size\",\"of\":\"sockaddr\",\"value\":{}}}", size_of::<T>());
        let _ = writeln!(out, "{{\"fact\":\"align\",\"of\":\"sockaddr\",\"value\":{}}}", align_of::<T>());
        let _ = writeln!(out, "{{\"fact\":\"offset\",\"of\":\"sockaddr.sa_len\",\"value\":{}}}", offset_of!(T, sa_len));
        let _ = writeln!(out, "{{\"fact\":\"field size\",\"of\":\"sockaddr.sa_len\",\"value\":{}}}", size_of_field(|value: &T| &value.sa_len));
        let _ = writeln!(out, "{{\"fact\":\"offset\",\"of\":\"sockaddr.sa_family\",\"value\":{}}}", offset_of!(T, sa_family));
        let _ = writeln!(out, "{{\"fact\":\"field size\",\"of\":\"sockaddr.sa_family\",\"value\":{}}}", size_of_field(|value: &T| &value.sa_family));
        let _ = writeln!(out, "{{\"fact\":\"offset\",\"of\":\"sockaddr.sa_data\",\"value\":{}}}", offset_of!(T, sa_data));
        let _ = writeln!(out, "{{\"fact\":\"field size\",\"of\":\"sockaddr.sa_data\",\"value\":{}}}", size_of_field(|value: &T| &value.sa_data));
    }
    {
        type T = types::sockaddr_dl;
        let _ = writeln!(out, "{{\"fact\":\"size\",\"of\":\"sockaddr_dl\",\"value\":{}}}", size_of::<T>());
        let _ = writeln!(out, "{{\"fact\":\"align\",\"of\":\"sockaddr_dl\",\"value\":{}}}", align_of::<T>());
        let _ = writeln!(out, "{{\"fact\":\"offset\",\"of\":\"sockaddr_dl.sdl_len\",\"value\":{}}}", offset_of!(T, sdl_len));
        let _ = writeln!(out, "{{\"fact\":\"field size\",\"of\":\"sockaddr_dl.sdl_len\",\"value\":{}}}", size_of_field(|value: &T| &value.sdl_len));
        let _ = writeln!(out, "{{\"fact\":\"offset\",\"of\":\"sockaddr_dl.sdl_family\",\"value\":{}}}", offset_of!(T, sdl_family));
        let _ = writeln!(out, "{{\"fact\":\"field size\",\"of\":\"sockaddr_dl.sdl_family\",\"value\":{}}}", size_of_field(|value: &T| &value.sdl_family));
        let _ = writeln!(out, "{{\"fact\":\"offset\",\"of\":\"sockaddr_dl.sdl_index\",\"value\":{}}}", offset_of!(T, sdl_index));
        let _ = writeln!(out, "{{\"fact\":\"field size\",\"of\":\"sockaddr_dl.sdl_index\",\"value\":{}}}", size_of_field(|value: &T| &value.sdl_index));
        let _ = writeln!(out, "{{\"fact\":\"offset\",\"of\":\"sockaddr_dl.sdl_type\",\"value\":{}}}", offset_of!(T, sdl_type));
        let _ = writeln!(out, "{{\"fact\":\"field size\",\"of\":\"sockaddr_dl.sdl_type\",\"value\":{}}}", size_of_field(|value: &T| &value.sdl_type));
        let _ = writeln!(out, "{{\"fact\":\"offset\",\"of\":\"sockaddr_dl.sdl_nlen\",\"value\":{}}}", offset_of!(T, sdl_nlen));
        let _ = writeln!(out, "{{\"fact\":\"field size\",\"of\":\"sockaddr_dl.sdl_nlen\",\"value\":{}}}", size_of_field(|value: &T| &value.sdl_nlen));
        let _ = writeln!(out, "{{\"fact\":\"offset\",\"of\":\"sockaddr_dl.sdl_alen\",\"value\":{}}}", offset_of!(T, sdl_alen));
        let _ = writeln!(out, "{{\"fact\":\"field size\",\"of\":\"sockaddr_dl.sdl_alen\",\"value\":{}}}", size_of_field(|value: &T| &value.sdl_alen));
        let _ = writeln!(out, "{{\"fact\":\"offset\",\"of\":\"sockaddr_dl.sdl_slen\",\"value\":{}}}", offset_of!(T, sdl_slen));
        let _ = writeln!(out, "{{\"fact\":\"field size\",\"of\":\"sockaddr_dl.sdl_slen\",\"value\":{}}}", size_of_field(|value: &T| &value.sdl_slen));
        let _ = writeln!(out, "{{\"fact\":\"offset\",\"of\":\"sockaddr_dl.sdl_data\",\"value\":{}}}", offset_of!(T, sdl_data));
        let _ = writeln!(out, "{{\"fact\":\"field size\",\"of\":\"sockaddr_dl.sdl_data\",\"value\":{}}}", size_of_field(|value: &T| &value.sdl_data));
    }
    {
        type T = types::socklen_t;
        let _ = writeln!(out, "{{\"fact\":\"size\",\"of\":\"socklen_t\",\"value\":{}}}", size_of::<T>());
        let _ = writeln!(out, "{{\"fact\":\"align\",\"of\":\"socklen_t\",\"value\":{}}}", align_of::<T>());
    }
    {
        type T = types::speed_t;
        let _ = writeln!(out, "{{\"fact\":\"size\",\"of\":\"speed_t\",\"value\":{}}}", size_of::<T>());
        let _ = writeln!(out, "{{\"fact\":\"align\",\"of\":\"speed_t\",\"value\":{}}}", align_of::<T>());
    }
    {
        type T = types::ssize_t;
        let _ = writeln!(out, "{{\"fact\":\"size\",\"of\":\"ssize_t\",\"value\":{}}}", size_of::<T>());
        let _ = writeln!(out, "{{\"fact\":\"align\",\"of\":\"ssize_t\",\"value\":{}}}", align_of::<T>());
    }
    {
        type T = types::stat;
        let _ = writeln!(out, "{{\"fact\":\"size\",\"of\":\"stat\",\"value\":{}}}", size_of::<T>());
        let _ = writeln!(out, "{{\"fact\":\"align\",\"of\":\"stat\",\"value\":{}}}", align_of::<T>());
        let _ = writeln!(out, "{{\"fact\":\"offset\",\"of\":\"stat.st_dev\",\"value\":{}}}", offset_of!(T, st_dev));
        let _ = writeln!(out, "{{\"fact\":\"field size\",\"of\":\"stat.st_dev\",\"value\":{}}}", size_of_field(|value: &T| &value.st_dev));
        let _ = writeln!(out, "{{\"fact\":\"offset\",\"of\":\"stat.st_mode\",\"value\":{}}}", offset_of!(T, st_mode));
        let _ = writeln!(out, "{{\"fact\":\"field size\",\"of\":\"stat.st_mode\",\"value\":{}}}", size_of_field(|value: &T| &value.st_mode));
        let _ = writeln!(out, "{{\"fact\":\"offset\",\"of\":\"stat.st_nlink\",\"value\":{}}}", offset_of!(T, st_nlink));
        let _ = writeln!(out, "{{\"fact\":\"field size\",\"of\":\"stat.st_nlink\",\"value\":{}}}", size_of_field(|value: &T| &value.st_nlink));
        let _ = writeln!(out, "{{\"fact\":\"offset\",\"of\":\"stat.st_ino\",\"value\":{}}}", offset_of!(T, st_ino));
        let _ = writeln!(out, "{{\"fact\":\"field size\",\"of\":\"stat.st_ino\",\"value\":{}}}", size_of_field(|value: &T| &value.st_ino));
        let _ = writeln!(out, "{{\"fact\":\"offset\",\"of\":\"stat.st_uid\",\"value\":{}}}", offset_of!(T, st_uid));
        let _ = writeln!(out, "{{\"fact\":\"field size\",\"of\":\"stat.st_uid\",\"value\":{}}}", size_of_field(|value: &T| &value.st_uid));
        let _ = writeln!(out, "{{\"fact\":\"offset\",\"of\":\"stat.st_gid\",\"value\":{}}}", offset_of!(T, st_gid));
        let _ = writeln!(out, "{{\"fact\":\"field size\",\"of\":\"stat.st_gid\",\"value\":{}}}", size_of_field(|value: &T| &value.st_gid));
        let _ = writeln!(out, "{{\"fact\":\"offset\",\"of\":\"stat.st_rdev\",\"value\":{}}}", offset_of!(T, st_rdev));
        let _ = writeln!(out, "{{\"fact\":\"field size\",\"of\":\"stat.st_rdev\",\"value\":{}}}", size_of_field(|value: &T| &value.st_rdev));
        let _ = writeln!(out, "{{\"fact\":\"offset\",\"of\":\"stat.st_atime\",\"value\":{}}}", offset_of!(T, st_atime));
        let _ = writeln!(out, "{{\"fact\":\"field size\",\"of\":\"stat.st_atime\",\"value\":{}}}", size_of_field(|value: &T| &value.st_atime));
        let _ = writeln!(out, "{{\"fact\":\"offset\",\"of\":\"stat.st_atime_nsec\",\"value\":{}}}", offset_of!(T, st_atime_nsec));
        let _ = writeln!(out, "{{\"fact\":\"field size\",\"of\":\"stat.st_atime_nsec\",\"value\":{}}}", size_of_field(|value: &T| &value.st_atime_nsec));
        let _ = writeln!(out, "{{\"fact\":\"offset\",\"of\":\"stat.st_mtime\",\"value\":{}}}", offset_of!(T, st_mtime));
        let _ = writeln!(out, "{{\"fact\":\"field size\",\"of\":\"stat.st_mtime\",\"value\":{}}}", size_of_field(|value: &T| &value.st_mtime));
        let _ = writeln!(out, "{{\"fact\":\"offset\",\"of\":\"stat.st_mtime_nsec\",\"value\":{}}}", offset_of!(T, st_mtime_nsec));
        let _ = writeln!(out, "{{\"fact\":\"field size\",\"of\":\"stat.st_mtime_nsec\",\"value\":{}}}", size_of_field(|value: &T| &value.st_mtime_nsec));
        let _ = writeln!(out, "{{\"fact\":\"offset\",\"of\":\"stat.st_ctime\",\"value\":{}}}", offset_of!(T, st_ctime));
        let _ = writeln!(out, "{{\"fact\":\"field size\",\"of\":\"stat.st_ctime\",\"value\":{}}}", size_of_field(|value: &T| &value.st_ctime));
        let _ = writeln!(out, "{{\"fact\":\"offset\",\"of\":\"stat.st_ctime_nsec\",\"value\":{}}}", offset_of!(T, st_ctime_nsec));
        let _ = writeln!(out, "{{\"fact\":\"field size\",\"of\":\"stat.st_ctime_nsec\",\"value\":{}}}", size_of_field(|value: &T| &value.st_ctime_nsec));
        let _ = writeln!(out, "{{\"fact\":\"offset\",\"of\":\"stat.st_birthtime\",\"value\":{}}}", offset_of!(T, st_birthtime));
        let _ = writeln!(out, "{{\"fact\":\"field size\",\"of\":\"stat.st_birthtime\",\"value\":{}}}", size_of_field(|value: &T| &value.st_birthtime));
        let _ = writeln!(out, "{{\"fact\":\"offset\",\"of\":\"stat.st_birthtime_nsec\",\"value\":{}}}", offset_of!(T, st_birthtime_nsec));
        let _ = writeln!(out, "{{\"fact\":\"field size\",\"of\":\"stat.st_birthtime_nsec\",\"value\":{}}}", size_of_field(|value: &T| &value.st_birthtime_nsec));
        let _ = writeln!(out, "{{\"fact\":\"offset\",\"of\":\"stat.st_size\",\"value\":{}}}", offset_of!(T, st_size));
        let _ = writeln!(out, "{{\"fact\":\"field size\",\"of\":\"stat.st_size\",\"value\":{}}}", size_of_field(|value: &T| &value.st_size));
        let _ = writeln!(out, "{{\"fact\":\"offset\",\"of\":\"stat.st_blocks\",\"value\":{}}}", offset_of!(T, st_blocks));
        let _ = writeln!(out, "{{\"fact\":\"field size\",\"of\":\"stat.st_blocks\",\"value\":{}}}", size_of_field(|value: &T| &value.st_blocks));
        let _ = writeln!(out, "{{\"fact\":\"offset\",\"of\":\"stat.st_blksize\",\"value\":{}}}", offset_of!(T, st_blksize));
        let _ = writeln!(out, "{{\"fact\":\"field size\",\"of\":\"stat.st_blksize\",\"value\":{}}}", size_of_field(|value: &T| &value.st_blksize));
        let _ = writeln!(out, "{{\"fact\":\"offset\",\"of\":\"stat.st_flags\",\"value\":{}}}", offset_of!(T, st_flags));
        let _ = writeln!(out, "{{\"fact\":\"field size\",\"of\":\"stat.st_flags\",\"value\":{}}}", size_of_field(|value: &T| &value.st_flags));
        let _ = writeln!(out, "{{\"fact\":\"offset\",\"of\":\"stat.st_gen\",\"value\":{}}}", offset_of!(T, st_gen));
        let _ = writeln!(out, "{{\"fact\":\"field size\",\"of\":\"stat.st_gen\",\"value\":{}}}", size_of_field(|value: &T| &value.st_gen));
        let _ = writeln!(out, "{{\"fact\":\"offset\",\"of\":\"stat.st_lspare\",\"value\":{}}}", offset_of!(T, st_lspare));
        let _ = writeln!(out, "{{\"fact\":\"field size\",\"of\":\"stat.st_lspare\",\"value\":{}}}", size_of_field(|value: &T| &value.st_lspare));
        let _ = writeln!(out, "{{\"fact\":\"offset\",\"of\":\"stat.st_qspare\",\"value\":{}}}", offset_of!(T, st_qspare));
        let _ = writeln!(out, "{{\"fact\":\"field size\",\"of\":\"stat.st_qspare\",\"value\":{}}}", size_of_field(|value: &T| &value.st_qspare));
    }
    {
        type T = types::statfs;
        let _ = writeln!(out, "{{\"fact\":\"size\",\"of\":\"statfs\",\"value\":{}}}", size_of::<T>());
        let _ = writeln!(out, "{{\"fact\":\"align\",\"of\":\"statfs\",\"value\":{}}}", align_of::<T>());
        let _ = writeln!(out, "{{\"fact\":\"offset\",\"of\":\"statfs.f_bsize\",\"value\":{}}}", offset_of!(T, f_bsize));
        let _ = writeln!(out, "{{\"fact\":\"field size\",\"of\":\"statfs.f_bsize\",\"value\":{}}}", size_of_field(|value: &T| &value.f_bsize));
        let _ = writeln!(out, "{{\"fact\":\"offset\",\"of\":\"statfs.f_iosize\",\"value\":{}}}", offset_of!(T, f_iosize));
        let _ = writeln!(out, "{{\"fact\":\"field size\",\"of\":\"statfs.f_iosize\",\"value\":{}}}", size_of_field(|value: &T| &value.f_iosize));
        let _ = writeln!(out, "{{\"fact\":\"offset\",\"of\":\"statfs.f_blocks\",\"value\":{}}}", offset_of!(T, f_blocks));
        let _ = writeln!(out, "{{\"fact\":\"field size\",\"of\":\"statfs.f_blocks\",\"value\":{}}}", size_of_field(|value: &T| &value.f_blocks));
        let _ = writeln!(out, "{{\"fact\":\"offset\",\"of\":\"statfs.f_bfree\",\"value\":{}}}", offset_of!(T, f_bfree));
        let _ = writeln!(out, "{{\"fact\":\"field size\",\"of\":\"statfs.f_bfree\",\"value\":{}}}", size_of_field(|value: &T| &value.f_bfree));
        let _ = writeln!(out, "{{\"fact\":\"offset\",\"of\":\"statfs.f_bavail\",\"value\":{}}}", offset_of!(T, f_bavail));
        let _ = writeln!(out, "{{\"fact\":\"field size\",\"of\":\"statfs.f_bavail\",\"value\":{}}}", size_of_field(|value: &T| &value.f_bavail));
        let _ = writeln!(out, "{{\"fact\":\"offset\",\"of\":\"statfs.f_files\",\"value\":{}}}", offset_of!(T, f_files));
        let _ = writeln!(out, "{{\"fact\":\"field size\",\"of\":\"statfs.f_files\",\"value\":{}}}", size_of_field(|value: &T| &value.f_files));
        let _ = writeln!(out, "{{\"fact\":\"offset\",\"of\":\"statfs.f_ffree\",\"value\":{}}}", offset_of!(T, f_ffree));
        let _ = writeln!(out, "{{\"fact\":\"field size\",\"of\":\"statfs.f_ffree\",\"value\":{}}}", size_of_field(|value: &T| &value.f_ffree));
        let _ = writeln!(out, "{{\"fact\":\"offset\",\"of\":\"statfs.f_fsid\",\"value\":{}}}", offset_of!(T, f_fsid));
        let _ = writeln!(out, "{{\"fact\":\"field size\",\"of\":\"statfs.f_fsid\",\"value\":{}}}", size_of_field(|value: &T| &value.f_fsid));
        let _ = writeln!(out, "{{\"fact\":\"offset\",\"of\":\"statfs.f_owner\",\"value\":{}}}", offset_of!(T, f_owner));
        let _ = writeln!(out, "{{\"fact\":\"field size\",\"of\":\"statfs.f_owner\",\"value\":{}}}", size_of_field(|value: &T| &value.f_owner));
        let _ = writeln!(out, "{{\"fact\":\"offset\",\"of\":\"statfs.f_type\",\"value\":{}}}", offset_of!(T, f_type));
        let _ = writeln!(out, "{{\"fact\":\"field size\",\"of\":\"statfs.f_type\",\"value\":{}}}", size_of_field(|value: &T| &value.f_type));
        let _ = writeln!(out, "{{\"fact\":\"offset\",\"of\":\"statfs.f_flags\",\"value\":{}}}", offset_of!(T, f_flags));
        let _ = writeln!(out, "{{\"fact\":\"field size\",\"of\":\"statfs.f_flags\",\"value\":{}}}", size_of_field(|value: &T| &value.f_flags));
        let _ = writeln!(out, "{{\"fact\":\"offset\",\"of\":\"statfs.f_fssubtype\",\"value\":{}}}", offset_of!(T, f_fssubtype));
        let _ = writeln!(out, "{{\"fact\":\"field size\",\"of\":\"statfs.f_fssubtype\",\"value\":{}}}", size_of_field(|value: &T| &value.f_fssubtype));
        let _ = writeln!(out, "{{\"fact\":\"offset\",\"of\":\"statfs.f_fstypename\",\"value\":{}}}", offset_of!(T, f_fstypename));
        let _ = writeln!(out, "{{\"fact\":\"field size\",\"of\":\"statfs.f_fstypename\",\"value\":{}}}", size_of_field(|value: &T| &value.f_fstypename));
        let _ = writeln!(out, "{{\"fact\":\"offset\",\"of\":\"statfs.f_mntonname\",\"value\":{}}}", offset_of!(T, f_mntonname));
        let _ = writeln!(out, "{{\"fact\":\"field size\",\"of\":\"statfs.f_mntonname\",\"value\":{}}}", size_of_field(|value: &T| &value.f_mntonname));
        let _ = writeln!(out, "{{\"fact\":\"offset\",\"of\":\"statfs.f_mntfromname\",\"value\":{}}}", offset_of!(T, f_mntfromname));
        let _ = writeln!(out, "{{\"fact\":\"field size\",\"of\":\"statfs.f_mntfromname\",\"value\":{}}}", size_of_field(|value: &T| &value.f_mntfromname));
        let _ = writeln!(out, "{{\"fact\":\"offset\",\"of\":\"statfs.f_flags_ext\",\"value\":{}}}", offset_of!(T, f_flags_ext));
        let _ = writeln!(out, "{{\"fact\":\"field size\",\"of\":\"statfs.f_flags_ext\",\"value\":{}}}", size_of_field(|value: &T| &value.f_flags_ext));
        let _ = writeln!(out, "{{\"fact\":\"offset\",\"of\":\"statfs.f_reserved\",\"value\":{}}}", offset_of!(T, f_reserved));
        let _ = writeln!(out, "{{\"fact\":\"field size\",\"of\":\"statfs.f_reserved\",\"value\":{}}}", size_of_field(|value: &T| &value.f_reserved));
    }
    {
        type T = types::suseconds_t;
        let _ = writeln!(out, "{{\"fact\":\"size\",\"of\":\"suseconds_t\",\"value\":{}}}", size_of::<T>());
        let _ = writeln!(out, "{{\"fact\":\"align\",\"of\":\"suseconds_t\",\"value\":{}}}", align_of::<T>());
    }
    {
        type T = types::tcflag_t;
        let _ = writeln!(out, "{{\"fact\":\"size\",\"of\":\"tcflag_t\",\"value\":{}}}", size_of::<T>());
        let _ = writeln!(out, "{{\"fact\":\"align\",\"of\":\"tcflag_t\",\"value\":{}}}", align_of::<T>());
    }
    {
        type T = types::time_t;
        let _ = writeln!(out, "{{\"fact\":\"size\",\"of\":\"time_t\",\"value\":{}}}", size_of::<T>());
        let _ = writeln!(out, "{{\"fact\":\"align\",\"of\":\"time_t\",\"value\":{}}}", align_of::<T>());
    }
    {
        type T = types::timespec;
        let _ = writeln!(out, "{{\"fact\":\"size\",\"of\":\"timespec\",\"value\":{}}}", size_of::<T>());
        let _ = writeln!(out, "{{\"fact\":\"align\",\"of\":\"timespec\",\"value\":{}}}", align_of::<T>());
        let _ = writeln!(out, "{{\"fact\":\"offset\",\"of\":\"timespec.tv_sec\",\"value\":{}}}", offset_of!(T, tv_sec));
        let _ = writeln!(out, "{{\"fact\":\"field size\",\"of\":\"timespec.tv_sec\",\"value\":{}}}", size_of_field(|value: &T| &value.tv_sec));
        let _ = writeln!(out, "{{\"fact\":\"offset\",\"of\":\"timespec.tv_nsec\",\"value\":{}}}", offset_of!(T, tv_nsec));
        let _ = writeln!(out, "{{\"fact\":\"field size\",\"of\":\"timespec.tv_nsec\",\"value\":{}}}", size_of_field(|value: &T| &value.tv_nsec));
    }
    {
        type T = types::timeval;
        let _ = writeln!(out, "{{\"fact\":\"size\",\"of\":\"timeval\",\"value\":{}}}", size_of::<T>());
        let _ = writeln!(out, "{{\"fact\":\"align\",\"of\":\"timeval\",\"value\":{}}}", align_of::<T>());
        let _ = writeln!(out, "{{\"fact\":\"offset\",\"of\":\"timeval.tv_sec\",\"value\":{}}}", offset_of!(T, tv_sec));
        let _ = writeln!(out, "{{\"fact\":\"field size\",\"of\":\"timeval.tv_sec\",\"value\":{}}}", size_of_field(|value: &T| &value.tv_sec));
        let _ = writeln!(out, "{{\"fact\":\"offset\",\"of\":\"timeval.tv_usec\",\"value\":{}}}", offset_of!(T, tv_usec));
        let _ = writeln!(out, "{{\"fact\":\"field size\",\"of\":\"timeval.tv_usec\",\"value\":{}}}", size_of_field(|value: &T| &value.tv_usec));
    }
    {
        type T = types::uid_t;
        let _ = writeln!(out, "{{\"fact\":\"size\",\"of\":\"uid_t\",\"value\":{}}}", size_of::<T>());
        let _ = writeln!(out, "{{\"fact\":\"align\",\"of\":\"uid_t\",\"value\":{}}}", align_of::<T>());
    }
    {
        type T = types::uintptr_t;
        let _ = writeln!(out, "{{\"fact\":\"size\",\"of\":\"uintptr_t\",\"value\":{}}}", size_of::<T>());
        let _ = writeln!(out, "{{\"fact\":\"align\",\"of\":\"uintptr_t\",\"value\":{}}}", align_of::<T>());
    }
    {
        type T = types::vm_address_t;
        let _ = writeln!(out, "{{\"fact\":\"size\",\"of\":\"vm_address_t\",\"value\":{}}}", size_of::<T>());
        let _ = writeln!(out, "{{\"fact\":\"align\",\"of\":\"vm_address_t\",\"value\":{}}}", align_of::<T>());
    }
    {
        type T = types::vm_map_t;
        let _ = writeln!(out, "{{\"fact\":\"size\",\"of\":\"vm_map_t\",\"value\":{}}}", size_of::<T>());
        let _ = writeln!(out, "{{\"fact\":\"align\",\"of\":\"vm_map_t\",\"value\":{}}}", align_of::<T>());
    }
    {
        type T = types::vm_offset_t;
        let _ = writeln!(out, "{{\"fact\":\"size\",\"of\":\"vm_offset_t\",\"value\":{}}}", size_of::<T>());
        let _ = writeln!(out, "{{\"fact\":\"align\",\"of\":\"vm_offset_t\",\"value\":{}}}", align_of::<T>());
    }
    {
        type T = types::vm_size_t;
        let _ = writeln!(out, "{{\"fact\":\"size\",\"of\":\"vm_size_t\",\"value\":{}}}", size_of::<T>());
        let _ = writeln!(out, "{{\"fact\":\"align\",\"of\":\"vm_size_t\",\"value\":{}}}", align_of::<T>());
    }
    {
        type T = types::vm_statistics64;
        let _ = writeln!(out, "{{\"fact\":\"size\",\"of\":\"vm_statistics64\",\"value\":{}}}", size_of::<T>());
        let _ = writeln!(out, "{{\"fact\":\"align\",\"of\":\"vm_statistics64\",\"value\":{}}}", align_of::<T>());
        let _ = writeln!(out, "{{\"fact\":\"offset\",\"of\":\"vm_statistics64.free_count\",\"value\":{}}}", offset_of!(T, free_count));
        let _ = writeln!(out, "{{\"fact\":\"field size\",\"of\":\"vm_statistics64.free_count\",\"value\":{}}}", { let value: T = unsafe { core::mem::zeroed() }; let field = value.free_count; size_of_val(&field) });
        let _ = writeln!(out, "{{\"fact\":\"offset\",\"of\":\"vm_statistics64.active_count\",\"value\":{}}}", offset_of!(T, active_count));
        let _ = writeln!(out, "{{\"fact\":\"field size\",\"of\":\"vm_statistics64.active_count\",\"value\":{}}}", { let value: T = unsafe { core::mem::zeroed() }; let field = value.active_count; size_of_val(&field) });
        let _ = writeln!(out, "{{\"fact\":\"offset\",\"of\":\"vm_statistics64.inactive_count\",\"value\":{}}}", offset_of!(T, inactive_count));
        let _ = writeln!(out, "{{\"fact\":\"field size\",\"of\":\"vm_statistics64.inactive_count\",\"value\":{}}}", { let value: T = unsafe { core::mem::zeroed() }; let field = value.inactive_count; size_of_val(&field) });
        let _ = writeln!(out, "{{\"fact\":\"offset\",\"of\":\"vm_statistics64.wire_count\",\"value\":{}}}", offset_of!(T, wire_count));
        let _ = writeln!(out, "{{\"fact\":\"field size\",\"of\":\"vm_statistics64.wire_count\",\"value\":{}}}", { let value: T = unsafe { core::mem::zeroed() }; let field = value.wire_count; size_of_val(&field) });
        let _ = writeln!(out, "{{\"fact\":\"offset\",\"of\":\"vm_statistics64.zero_fill_count\",\"value\":{}}}", offset_of!(T, zero_fill_count));
        let _ = writeln!(out, "{{\"fact\":\"field size\",\"of\":\"vm_statistics64.zero_fill_count\",\"value\":{}}}", { let value: T = unsafe { core::mem::zeroed() }; let field = value.zero_fill_count; size_of_val(&field) });
        let _ = writeln!(out, "{{\"fact\":\"offset\",\"of\":\"vm_statistics64.reactivations\",\"value\":{}}}", offset_of!(T, reactivations));
        let _ = writeln!(out, "{{\"fact\":\"field size\",\"of\":\"vm_statistics64.reactivations\",\"value\":{}}}", { let value: T = unsafe { core::mem::zeroed() }; let field = value.reactivations; size_of_val(&field) });
        let _ = writeln!(out, "{{\"fact\":\"offset\",\"of\":\"vm_statistics64.pageins\",\"value\":{}}}", offset_of!(T, pageins));
        let _ = writeln!(out, "{{\"fact\":\"field size\",\"of\":\"vm_statistics64.pageins\",\"value\":{}}}", { let value: T = unsafe { core::mem::zeroed() }; let field = value.pageins; size_of_val(&field) });
        let _ = writeln!(out, "{{\"fact\":\"offset\",\"of\":\"vm_statistics64.pageouts\",\"value\":{}}}", offset_of!(T, pageouts));
        let _ = writeln!(out, "{{\"fact\":\"field size\",\"of\":\"vm_statistics64.pageouts\",\"value\":{}}}", { let value: T = unsafe { core::mem::zeroed() }; let field = value.pageouts; size_of_val(&field) });
        let _ = writeln!(out, "{{\"fact\":\"offset\",\"of\":\"vm_statistics64.faults\",\"value\":{}}}", offset_of!(T, faults));
        let _ = writeln!(out, "{{\"fact\":\"field size\",\"of\":\"vm_statistics64.faults\",\"value\":{}}}", { let value: T = unsafe { core::mem::zeroed() }; let field = value.faults; size_of_val(&field) });
        let _ = writeln!(out, "{{\"fact\":\"offset\",\"of\":\"vm_statistics64.cow_faults\",\"value\":{}}}", offset_of!(T, cow_faults));
        let _ = writeln!(out, "{{\"fact\":\"field size\",\"of\":\"vm_statistics64.cow_faults\",\"value\":{}}}", { let value: T = unsafe { core::mem::zeroed() }; let field = value.cow_faults; size_of_val(&field) });
        let _ = writeln!(out, "{{\"fact\":\"offset\",\"of\":\"vm_statistics64.lookups\",\"value\":{}}}", offset_of!(T, lookups));
        let _ = writeln!(out, "{{\"fact\":\"field size\",\"of\":\"vm_statistics64.lookups\",\"value\":{}}}", { let value: T = unsafe { core::mem::zeroed() }; let field = value.lookups; size_of_val(&field) });
        let _ = writeln!(out, "{{\"fact\":\"offset\",\"of\":\"vm_statistics64.hits\",\"value\":{}}}", offset_of!(T, hits));
        let _ = writeln!(out, "{{\"fact\":\"field size\",\"of\":\"vm_statistics64.hits\",\"value\":{}}}", { let value: T = unsafe { core::mem::zeroed() }; let field = value.hits; size_of_val(&field) });
        let _ = writeln!(out, "{{\"fact\":\"offset\",\"of\":\"vm_statistics64.purges\",\"value\":{}}}", offset_of!(T, purges));
        let _ = writeln!(out, "{{\"fact\":\"field size\",\"of\":\"vm_statistics64.purges\",\"value\":{}}}", { let value: T = unsafe { core::mem::zeroed() }; let field = value.purges; size_of_val(&field) });
        let _ = writeln!(out, "{{\"fact\":\"offset\",\"of\":\"vm_statistics64.purgeable_count\",\"value\":{}}}", offset_of!(T, purgeable_count));
        let _ = writeln!(out, "{{\"fact\":\"field size\",\"of\":\"vm_statistics64.purgeable_count\",\"value\":{}}}", { let value: T = unsafe { core::mem::zeroed() }; let field = value.purgeable_count; size_of_val(&field) });
        let _ = writeln!(out, "{{\"fact\":\"offset\",\"of\":\"vm_statistics64.speculative_count\",\"value\":{}}}", offset_of!(T, speculative_count));
        let _ = writeln!(out, "{{\"fact\":\"field size\",\"of\":\"vm_statistics64.speculative_count\",\"value\":{}}}", { let value: T = unsafe { core::mem::zeroed() }; let field = value.speculative_count; size_of_val(&field) });
        let _ = writeln!(out, "{{\"fact\":\"offset\",\"of\":\"vm_statistics64.decompressions\",\"value\":{}}}", offset_of!(T, decompressions));
        let _ = writeln!(out, "{{\"fact\":\"field size\",\"of\":\"vm_statistics64.decompressions\",\"value\":{}}}", { let value: T = unsafe { core::mem::zeroed() }; let field = value.decompressions; size_of_val(&field) });
        let _ = writeln!(out, "{{\"fact\":\"offset\",\"of\":\"vm_statistics64.compressions\",\"value\":{}}}", offset_of!(T, compressions));
        let _ = writeln!(out, "{{\"fact\":\"field size\",\"of\":\"vm_statistics64.compressions\",\"value\":{}}}", { let value: T = unsafe { core::mem::zeroed() }; let field = value.compressions; size_of_val(&field) });
        let _ = writeln!(out, "{{\"fact\":\"offset\",\"of\":\"vm_statistics64.swapins\",\"value\":{}}}", offset_of!(T, swapins));
        let _ = writeln!(out, "{{\"fact\":\"field size\",\"of\":\"vm_statistics64.swapins\",\"value\":{}}}", { let value: T = unsafe { core::mem::zeroed() }; let field = value.swapins; size_of_val(&field) });
        let _ = writeln!(out, "{{\"fact\":\"offset\",\"of\":\"vm_statistics64.swapouts\",\"value\":{}}}", offset_of!(T, swapouts));
        let _ = writeln!(out, "{{\"fact\":\"field size\",\"of\":\"vm_statistics64.swapouts\",\"value\":{}}}", { let value: T = unsafe { core::mem::zeroed() }; let field = value.swapouts; size_of_val(&field) });
        let _ = writeln!(out, "{{\"fact\":\"offset\",\"of\":\"vm_statistics64.compressor_page_count\",\"value\":{}}}", offset_of!(T, compressor_page_count));
        let _ = writeln!(out, "{{\"fact\":\"field size\",\"of\":\"vm_statistics64.compressor_page_count\",\"value\":{}}}", { let value: T = unsafe { core::mem::zeroed() }; let field = value.compressor_page_count; size_of_val(&field) });
        let _ = writeln!(out, "{{\"fact\":\"offset\",\"of\":\"vm_statistics64.throttled_count\",\"value\":{}}}", offset_of!(T, throttled_count));
        let _ = writeln!(out, "{{\"fact\":\"field size\",\"of\":\"vm_statistics64.throttled_count\",\"value\":{}}}", { let value: T = unsafe { core::mem::zeroed() }; let field = value.throttled_count; size_of_val(&field) });
        let _ = writeln!(out, "{{\"fact\":\"offset\",\"of\":\"vm_statistics64.external_page_count\",\"value\":{}}}", offset_of!(T, external_page_count));
        let _ = writeln!(out, "{{\"fact\":\"field size\",\"of\":\"vm_statistics64.external_page_count\",\"value\":{}}}", { let value: T = unsafe { core::mem::zeroed() }; let field = value.external_page_count; size_of_val(&field) });
        let _ = writeln!(out, "{{\"fact\":\"offset\",\"of\":\"vm_statistics64.internal_page_count\",\"value\":{}}}", offset_of!(T, internal_page_count));
        let _ = writeln!(out, "{{\"fact\":\"field size\",\"of\":\"vm_statistics64.internal_page_count\",\"value\":{}}}", { let value: T = unsafe { core::mem::zeroed() }; let field = value.internal_page_count; size_of_val(&field) });
        let _ = writeln!(out, "{{\"fact\":\"offset\",\"of\":\"vm_statistics64.total_uncompressed_pages_in_compressor\",\"value\":{}}}", offset_of!(T, total_uncompressed_pages_in_compressor));
        let _ = writeln!(out, "{{\"fact\":\"field size\",\"of\":\"vm_statistics64.total_uncompressed_pages_in_compressor\",\"value\":{}}}", { let value: T = unsafe { core::mem::zeroed() }; let field = value.total_uncompressed_pages_in_compressor; size_of_val(&field) });
    }
    {
        type T = types::vm_statistics64_data_t;
        let _ = writeln!(out, "{{\"fact\":\"size\",\"of\":\"vm_statistics64_data_t\",\"value\":{}}}", size_of::<T>());
        let _ = writeln!(out, "{{\"fact\":\"align\",\"of\":\"vm_statistics64_data_t\",\"value\":{}}}", align_of::<T>());
    }
    let _ = writeln!(out, "{{\"fact\":\"constant\",\"of\":\"AT_EACCESS\",\"value\":{}}}", constants::AT_EACCESS as i64);
    let _ = writeln!(out, "{{\"fact\":\"constant\",\"of\":\"AT_FDCWD\",\"value\":{}}}", constants::AT_FDCWD as i64);
    let _ = writeln!(out, "{{\"fact\":\"constant\",\"of\":\"AT_REMOVEDIR\",\"value\":{}}}", constants::AT_REMOVEDIR as i64);
    let _ = writeln!(out, "{{\"fact\":\"constant\",\"of\":\"AT_SYMLINK_FOLLOW\",\"value\":{}}}", constants::AT_SYMLINK_FOLLOW as i64);
    let _ = writeln!(out, "{{\"fact\":\"constant\",\"of\":\"AT_SYMLINK_NOFOLLOW\",\"value\":{}}}", constants::AT_SYMLINK_NOFOLLOW as i64);
    let _ = writeln!(out, "{{\"fact\":\"constant\",\"of\":\"COPYFILE_ACL\",\"value\":{}}}", constants::COPYFILE_ACL as i64);
    let _ = writeln!(out, "{{\"fact\":\"constant\",\"of\":\"COPYFILE_CHECK\",\"value\":{}}}", constants::COPYFILE_CHECK as i64);
    let _ = writeln!(out, "{{\"fact\":\"constant\",\"of\":\"COPYFILE_CLONE\",\"value\":{}}}", constants::COPYFILE_CLONE as i64);
    let _ = writeln!(out, "{{\"fact\":\"constant\",\"of\":\"COPYFILE_CLONE_FORCE\",\"value\":{}}}", constants::COPYFILE_CLONE_FORCE as i64);
    let _ = writeln!(out, "{{\"fact\":\"constant\",\"of\":\"COPYFILE_CONTINUE\",\"value\":{}}}", constants::COPYFILE_CONTINUE as i64);
    let _ = writeln!(out, "{{\"fact\":\"constant\",\"of\":\"COPYFILE_COPY_DATA\",\"value\":{}}}", constants::COPYFILE_COPY_DATA as i64);
    let _ = writeln!(out, "{{\"fact\":\"constant\",\"of\":\"COPYFILE_COPY_XATTR\",\"value\":{}}}", constants::COPYFILE_COPY_XATTR as i64);
    let _ = writeln!(out, "{{\"fact\":\"constant\",\"of\":\"COPYFILE_DATA\",\"value\":{}}}", constants::COPYFILE_DATA as i64);
    let _ = writeln!(out, "{{\"fact\":\"constant\",\"of\":\"COPYFILE_DATA_SPARSE\",\"value\":{}}}", constants::COPYFILE_DATA_SPARSE as i64);
    let _ = writeln!(out, "{{\"fact\":\"constant\",\"of\":\"COPYFILE_ERR\",\"value\":{}}}", constants::COPYFILE_ERR as i64);
    let _ = writeln!(out, "{{\"fact\":\"constant\",\"of\":\"COPYFILE_EXCL\",\"value\":{}}}", constants::COPYFILE_EXCL as i64);
    let _ = writeln!(out, "{{\"fact\":\"constant\",\"of\":\"COPYFILE_FINISH\",\"value\":{}}}", constants::COPYFILE_FINISH as i64);
    let _ = writeln!(out, "{{\"fact\":\"constant\",\"of\":\"COPYFILE_METADATA\",\"value\":{}}}", constants::COPYFILE_METADATA as i64);
    let _ = writeln!(out, "{{\"fact\":\"constant\",\"of\":\"COPYFILE_MOVE\",\"value\":{}}}", constants::COPYFILE_MOVE as i64);
    let _ = writeln!(out, "{{\"fact\":\"constant\",\"of\":\"COPYFILE_NOFOLLOW\",\"value\":{}}}", constants::COPYFILE_NOFOLLOW as i64);
    let _ = writeln!(out, "{{\"fact\":\"constant\",\"of\":\"COPYFILE_NOFOLLOW_DST\",\"value\":{}}}", constants::COPYFILE_NOFOLLOW_DST as i64);
    let _ = writeln!(out, "{{\"fact\":\"constant\",\"of\":\"COPYFILE_NOFOLLOW_SRC\",\"value\":{}}}", constants::COPYFILE_NOFOLLOW_SRC as i64);
    let _ = writeln!(out, "{{\"fact\":\"constant\",\"of\":\"COPYFILE_PACK\",\"value\":{}}}", constants::COPYFILE_PACK as i64);
    let _ = writeln!(out, "{{\"fact\":\"constant\",\"of\":\"COPYFILE_PRESERVE_DST_TRACKED\",\"value\":{}}}", constants::COPYFILE_PRESERVE_DST_TRACKED as i64);
    let _ = writeln!(out, "{{\"fact\":\"constant\",\"of\":\"COPYFILE_PROGRESS\",\"value\":{}}}", constants::COPYFILE_PROGRESS as i64);
    let _ = writeln!(out, "{{\"fact\":\"constant\",\"of\":\"COPYFILE_QUIT\",\"value\":{}}}", constants::COPYFILE_QUIT as i64);
    let _ = writeln!(out, "{{\"fact\":\"constant\",\"of\":\"COPYFILE_RECURSE_DIR\",\"value\":{}}}", constants::COPYFILE_RECURSE_DIR as i64);
    let _ = writeln!(out, "{{\"fact\":\"constant\",\"of\":\"COPYFILE_RECURSE_DIR_CLEANUP\",\"value\":{}}}", constants::COPYFILE_RECURSE_DIR_CLEANUP as i64);
    let _ = writeln!(out, "{{\"fact\":\"constant\",\"of\":\"COPYFILE_RECURSE_ERROR\",\"value\":{}}}", constants::COPYFILE_RECURSE_ERROR as i64);
    let _ = writeln!(out, "{{\"fact\":\"constant\",\"of\":\"COPYFILE_RECURSE_FILE\",\"value\":{}}}", constants::COPYFILE_RECURSE_FILE as i64);
    let _ = writeln!(out, "{{\"fact\":\"constant\",\"of\":\"COPYFILE_RECURSIVE\",\"value\":{}}}", constants::COPYFILE_RECURSIVE as i64);
    let _ = writeln!(out, "{{\"fact\":\"constant\",\"of\":\"COPYFILE_RUN_IN_PLACE\",\"value\":{}}}", constants::COPYFILE_RUN_IN_PLACE as i64);
    let _ = writeln!(out, "{{\"fact\":\"constant\",\"of\":\"COPYFILE_SECURITY\",\"value\":{}}}", constants::COPYFILE_SECURITY as i64);
    let _ = writeln!(out, "{{\"fact\":\"constant\",\"of\":\"COPYFILE_SKIP\",\"value\":{}}}", constants::COPYFILE_SKIP as i64);
    let _ = writeln!(out, "{{\"fact\":\"constant\",\"of\":\"COPYFILE_START\",\"value\":{}}}", constants::COPYFILE_START as i64);
    let _ = writeln!(out, "{{\"fact\":\"constant\",\"of\":\"COPYFILE_STAT\",\"value\":{}}}", constants::COPYFILE_STAT as i64);
    let _ = writeln!(out, "{{\"fact\":\"constant\",\"of\":\"COPYFILE_STATE_BSIZE\",\"value\":{}}}", constants::COPYFILE_STATE_BSIZE as i64);
    let _ = writeln!(out, "{{\"fact\":\"constant\",\"of\":\"COPYFILE_STATE_COPIED\",\"value\":{}}}", constants::COPYFILE_STATE_COPIED as i64);
    let _ = writeln!(out, "{{\"fact\":\"constant\",\"of\":\"COPYFILE_STATE_DST_BSIZE\",\"value\":{}}}", constants::COPYFILE_STATE_DST_BSIZE as i64);
    let _ = writeln!(out, "{{\"fact\":\"constant\",\"of\":\"COPYFILE_STATE_DST_FD\",\"value\":{}}}", constants::COPYFILE_STATE_DST_FD as i64);
    let _ = writeln!(out, "{{\"fact\":\"constant\",\"of\":\"COPYFILE_STATE_DST_FILENAME\",\"value\":{}}}", constants::COPYFILE_STATE_DST_FILENAME as i64);
    let _ = writeln!(out, "{{\"fact\":\"constant\",\"of\":\"COPYFILE_STATE_QUARANTINE\",\"value\":{}}}", constants::COPYFILE_STATE_QUARANTINE as i64);
    let _ = writeln!(out, "{{\"fact\":\"constant\",\"of\":\"COPYFILE_STATE_SRC_BSIZE\",\"value\":{}}}", constants::COPYFILE_STATE_SRC_BSIZE as i64);
    let _ = writeln!(out, "{{\"fact\":\"constant\",\"of\":\"COPYFILE_STATE_SRC_FD\",\"value\":{}}}", constants::COPYFILE_STATE_SRC_FD as i64);
    let _ = writeln!(out, "{{\"fact\":\"constant\",\"of\":\"COPYFILE_STATE_SRC_FILENAME\",\"value\":{}}}", constants::COPYFILE_STATE_SRC_FILENAME as i64);
    let _ = writeln!(out, "{{\"fact\":\"constant\",\"of\":\"COPYFILE_STATE_STATUS_CB\",\"value\":{}}}", constants::COPYFILE_STATE_STATUS_CB as i64);
    let _ = writeln!(out, "{{\"fact\":\"constant\",\"of\":\"COPYFILE_STATE_STATUS_CTX\",\"value\":{}}}", constants::COPYFILE_STATE_STATUS_CTX as i64);
    let _ = writeln!(out, "{{\"fact\":\"constant\",\"of\":\"COPYFILE_STATE_WAS_CLONED\",\"value\":{}}}", constants::COPYFILE_STATE_WAS_CLONED as i64);
    let _ = writeln!(out, "{{\"fact\":\"constant\",\"of\":\"COPYFILE_STATE_XATTRNAME\",\"value\":{}}}", constants::COPYFILE_STATE_XATTRNAME as i64);
    let _ = writeln!(out, "{{\"fact\":\"constant\",\"of\":\"COPYFILE_UNLINK\",\"value\":{}}}", constants::COPYFILE_UNLINK as i64);
    let _ = writeln!(out, "{{\"fact\":\"constant\",\"of\":\"COPYFILE_UNPACK\",\"value\":{}}}", constants::COPYFILE_UNPACK as i64);
    let _ = writeln!(out, "{{\"fact\":\"constant\",\"of\":\"COPYFILE_VERBOSE\",\"value\":{}}}", constants::COPYFILE_VERBOSE as i64);
    let _ = writeln!(out, "{{\"fact\":\"constant\",\"of\":\"COPYFILE_XATTR\",\"value\":{}}}", constants::COPYFILE_XATTR as i64);
    let _ = writeln!(out, "{{\"fact\":\"constant\",\"of\":\"CPU_STATE_IDLE\",\"value\":{}}}", constants::CPU_STATE_IDLE as i64);
    let _ = writeln!(out, "{{\"fact\":\"constant\",\"of\":\"CPU_STATE_MAX\",\"value\":{}}}", constants::CPU_STATE_MAX as i64);
    let _ = writeln!(out, "{{\"fact\":\"constant\",\"of\":\"CPU_STATE_NICE\",\"value\":{}}}", constants::CPU_STATE_NICE as i64);
    let _ = writeln!(out, "{{\"fact\":\"constant\",\"of\":\"CPU_STATE_SYSTEM\",\"value\":{}}}", constants::CPU_STATE_SYSTEM as i64);
    let _ = writeln!(out, "{{\"fact\":\"constant\",\"of\":\"CPU_STATE_USER\",\"value\":{}}}", constants::CPU_STATE_USER as i64);
    let _ = writeln!(out, "{{\"fact\":\"constant\",\"of\":\"DT_BLK\",\"value\":{}}}", constants::DT_BLK as i64);
    let _ = writeln!(out, "{{\"fact\":\"constant\",\"of\":\"DT_CHR\",\"value\":{}}}", constants::DT_CHR as i64);
    let _ = writeln!(out, "{{\"fact\":\"constant\",\"of\":\"DT_DIR\",\"value\":{}}}", constants::DT_DIR as i64);
    let _ = writeln!(out, "{{\"fact\":\"constant\",\"of\":\"DT_FIFO\",\"value\":{}}}", constants::DT_FIFO as i64);
    let _ = writeln!(out, "{{\"fact\":\"constant\",\"of\":\"DT_LNK\",\"value\":{}}}", constants::DT_LNK as i64);
    let _ = writeln!(out, "{{\"fact\":\"constant\",\"of\":\"DT_REG\",\"value\":{}}}", constants::DT_REG as i64);
    let _ = writeln!(out, "{{\"fact\":\"constant\",\"of\":\"DT_SOCK\",\"value\":{}}}", constants::DT_SOCK as i64);
    let _ = writeln!(out, "{{\"fact\":\"constant\",\"of\":\"DT_UNKNOWN\",\"value\":{}}}", constants::DT_UNKNOWN as i64);
    let _ = writeln!(out, "{{\"fact\":\"constant\",\"of\":\"E2BIG\",\"value\":{}}}", constants::E2BIG as i64);
    let _ = writeln!(out, "{{\"fact\":\"constant\",\"of\":\"EACCES\",\"value\":{}}}", constants::EACCES as i64);
    let _ = writeln!(out, "{{\"fact\":\"constant\",\"of\":\"EADDRINUSE\",\"value\":{}}}", constants::EADDRINUSE as i64);
    let _ = writeln!(out, "{{\"fact\":\"constant\",\"of\":\"EADDRNOTAVAIL\",\"value\":{}}}", constants::EADDRNOTAVAIL as i64);
    let _ = writeln!(out, "{{\"fact\":\"constant\",\"of\":\"EAFNOSUPPORT\",\"value\":{}}}", constants::EAFNOSUPPORT as i64);
    let _ = writeln!(out, "{{\"fact\":\"constant\",\"of\":\"EAGAIN\",\"value\":{}}}", constants::EAGAIN as i64);
    let _ = writeln!(out, "{{\"fact\":\"constant\",\"of\":\"EALREADY\",\"value\":{}}}", constants::EALREADY as i64);
    let _ = writeln!(out, "{{\"fact\":\"constant\",\"of\":\"EAUTH\",\"value\":{}}}", constants::EAUTH as i64);
    let _ = writeln!(out, "{{\"fact\":\"constant\",\"of\":\"EBADARCH\",\"value\":{}}}", constants::EBADARCH as i64);
    let _ = writeln!(out, "{{\"fact\":\"constant\",\"of\":\"EBADEXEC\",\"value\":{}}}", constants::EBADEXEC as i64);
    let _ = writeln!(out, "{{\"fact\":\"constant\",\"of\":\"EBADF\",\"value\":{}}}", constants::EBADF as i64);
    let _ = writeln!(out, "{{\"fact\":\"constant\",\"of\":\"EBADMACHO\",\"value\":{}}}", constants::EBADMACHO as i64);
    let _ = writeln!(out, "{{\"fact\":\"constant\",\"of\":\"EBADMSG\",\"value\":{}}}", constants::EBADMSG as i64);
    let _ = writeln!(out, "{{\"fact\":\"constant\",\"of\":\"EBADRPC\",\"value\":{}}}", constants::EBADRPC as i64);
    let _ = writeln!(out, "{{\"fact\":\"constant\",\"of\":\"EBUSY\",\"value\":{}}}", constants::EBUSY as i64);
    let _ = writeln!(out, "{{\"fact\":\"constant\",\"of\":\"ECANCELED\",\"value\":{}}}", constants::ECANCELED as i64);
    let _ = writeln!(out, "{{\"fact\":\"constant\",\"of\":\"ECHILD\",\"value\":{}}}", constants::ECHILD as i64);
    let _ = writeln!(out, "{{\"fact\":\"constant\",\"of\":\"ECHO\",\"value\":{}}}", constants::ECHO as i64);
    let _ = writeln!(out, "{{\"fact\":\"constant\",\"of\":\"ECHOCTL\",\"value\":{}}}", constants::ECHOCTL as i64);
    let _ = writeln!(out, "{{\"fact\":\"constant\",\"of\":\"ECHOE\",\"value\":{}}}", constants::ECHOE as i64);
    let _ = writeln!(out, "{{\"fact\":\"constant\",\"of\":\"ECHOK\",\"value\":{}}}", constants::ECHOK as i64);
    let _ = writeln!(out, "{{\"fact\":\"constant\",\"of\":\"ECHOKE\",\"value\":{}}}", constants::ECHOKE as i64);
    let _ = writeln!(out, "{{\"fact\":\"constant\",\"of\":\"ECHONL\",\"value\":{}}}", constants::ECHONL as i64);
    let _ = writeln!(out, "{{\"fact\":\"constant\",\"of\":\"ECHOPRT\",\"value\":{}}}", constants::ECHOPRT as i64);
    let _ = writeln!(out, "{{\"fact\":\"constant\",\"of\":\"ECONNABORTED\",\"value\":{}}}", constants::ECONNABORTED as i64);
    let _ = writeln!(out, "{{\"fact\":\"constant\",\"of\":\"ECONNREFUSED\",\"value\":{}}}", constants::ECONNREFUSED as i64);
    let _ = writeln!(out, "{{\"fact\":\"constant\",\"of\":\"ECONNRESET\",\"value\":{}}}", constants::ECONNRESET as i64);
    let _ = writeln!(out, "{{\"fact\":\"constant\",\"of\":\"EDEADLK\",\"value\":{}}}", constants::EDEADLK as i64);
    let _ = writeln!(out, "{{\"fact\":\"constant\",\"of\":\"EDESTADDRREQ\",\"value\":{}}}", constants::EDESTADDRREQ as i64);
    let _ = writeln!(out, "{{\"fact\":\"constant\",\"of\":\"EDEVERR\",\"value\":{}}}", constants::EDEVERR as i64);
    let _ = writeln!(out, "{{\"fact\":\"constant\",\"of\":\"EDOM\",\"value\":{}}}", constants::EDOM as i64);
    let _ = writeln!(out, "{{\"fact\":\"constant\",\"of\":\"EDQUOT\",\"value\":{}}}", constants::EDQUOT as i64);
    let _ = writeln!(out, "{{\"fact\":\"constant\",\"of\":\"EEXIST\",\"value\":{}}}", constants::EEXIST as i64);
    let _ = writeln!(out, "{{\"fact\":\"constant\",\"of\":\"EFAULT\",\"value\":{}}}", constants::EFAULT as i64);
    let _ = writeln!(out, "{{\"fact\":\"constant\",\"of\":\"EFBIG\",\"value\":{}}}", constants::EFBIG as i64);
    let _ = writeln!(out, "{{\"fact\":\"constant\",\"of\":\"EFTYPE\",\"value\":{}}}", constants::EFTYPE as i64);
    let _ = writeln!(out, "{{\"fact\":\"constant\",\"of\":\"EHOSTDOWN\",\"value\":{}}}", constants::EHOSTDOWN as i64);
    let _ = writeln!(out, "{{\"fact\":\"constant\",\"of\":\"EHOSTUNREACH\",\"value\":{}}}", constants::EHOSTUNREACH as i64);
    let _ = writeln!(out, "{{\"fact\":\"constant\",\"of\":\"EIDRM\",\"value\":{}}}", constants::EIDRM as i64);
    let _ = writeln!(out, "{{\"fact\":\"constant\",\"of\":\"EILSEQ\",\"value\":{}}}", constants::EILSEQ as i64);
    let _ = writeln!(out, "{{\"fact\":\"constant\",\"of\":\"EINPROGRESS\",\"value\":{}}}", constants::EINPROGRESS as i64);
    let _ = writeln!(out, "{{\"fact\":\"constant\",\"of\":\"EINTR\",\"value\":{}}}", constants::EINTR as i64);
    let _ = writeln!(out, "{{\"fact\":\"constant\",\"of\":\"EINVAL\",\"value\":{}}}", constants::EINVAL as i64);
    let _ = writeln!(out, "{{\"fact\":\"constant\",\"of\":\"EIO\",\"value\":{}}}", constants::EIO as i64);
    let _ = writeln!(out, "{{\"fact\":\"constant\",\"of\":\"EISCONN\",\"value\":{}}}", constants::EISCONN as i64);
    let _ = writeln!(out, "{{\"fact\":\"constant\",\"of\":\"EISDIR\",\"value\":{}}}", constants::EISDIR as i64);
    let _ = writeln!(out, "{{\"fact\":\"constant\",\"of\":\"ELAST\",\"value\":{}}}", constants::ELAST as i64);
    let _ = writeln!(out, "{{\"fact\":\"constant\",\"of\":\"ELOOP\",\"value\":{}}}", constants::ELOOP as i64);
    let _ = writeln!(out, "{{\"fact\":\"constant\",\"of\":\"EMFILE\",\"value\":{}}}", constants::EMFILE as i64);
    let _ = writeln!(out, "{{\"fact\":\"constant\",\"of\":\"EMLINK\",\"value\":{}}}", constants::EMLINK as i64);
    let _ = writeln!(out, "{{\"fact\":\"constant\",\"of\":\"EMPTY\",\"value\":{}}}", constants::EMPTY as i64);
    let _ = writeln!(out, "{{\"fact\":\"constant\",\"of\":\"EMSGSIZE\",\"value\":{}}}", constants::EMSGSIZE as i64);
    let _ = writeln!(out, "{{\"fact\":\"constant\",\"of\":\"EMULTIHOP\",\"value\":{}}}", constants::EMULTIHOP as i64);
    let _ = writeln!(out, "{{\"fact\":\"constant\",\"of\":\"ENAMETOOLONG\",\"value\":{}}}", constants::ENAMETOOLONG as i64);
    let _ = writeln!(out, "{{\"fact\":\"constant\",\"of\":\"ENEEDAUTH\",\"value\":{}}}", constants::ENEEDAUTH as i64);
    let _ = writeln!(out, "{{\"fact\":\"constant\",\"of\":\"ENETDOWN\",\"value\":{}}}", constants::ENETDOWN as i64);
    let _ = writeln!(out, "{{\"fact\":\"constant\",\"of\":\"ENETRESET\",\"value\":{}}}", constants::ENETRESET as i64);
    let _ = writeln!(out, "{{\"fact\":\"constant\",\"of\":\"ENETUNREACH\",\"value\":{}}}", constants::ENETUNREACH as i64);
    let _ = writeln!(out, "{{\"fact\":\"constant\",\"of\":\"ENFILE\",\"value\":{}}}", constants::ENFILE as i64);
    let _ = writeln!(out, "{{\"fact\":\"constant\",\"of\":\"ENOATTR\",\"value\":{}}}", constants::ENOATTR as i64);
    let _ = writeln!(out, "{{\"fact\":\"constant\",\"of\":\"ENOBUFS\",\"value\":{}}}", constants::ENOBUFS as i64);
    let _ = writeln!(out, "{{\"fact\":\"constant\",\"of\":\"ENODATA\",\"value\":{}}}", constants::ENODATA as i64);
    let _ = writeln!(out, "{{\"fact\":\"constant\",\"of\":\"ENODEV\",\"value\":{}}}", constants::ENODEV as i64);
    let _ = writeln!(out, "{{\"fact\":\"constant\",\"of\":\"ENOENT\",\"value\":{}}}", constants::ENOENT as i64);
    let _ = writeln!(out, "{{\"fact\":\"constant\",\"of\":\"ENOEXEC\",\"value\":{}}}", constants::ENOEXEC as i64);
    let _ = writeln!(out, "{{\"fact\":\"constant\",\"of\":\"ENOLCK\",\"value\":{}}}", constants::ENOLCK as i64);
    let _ = writeln!(out, "{{\"fact\":\"constant\",\"of\":\"ENOLINK\",\"value\":{}}}", constants::ENOLINK as i64);
    let _ = writeln!(out, "{{\"fact\":\"constant\",\"of\":\"ENOMEM\",\"value\":{}}}", constants::ENOMEM as i64);
    let _ = writeln!(out, "{{\"fact\":\"constant\",\"of\":\"ENOMSG\",\"value\":{}}}", constants::ENOMSG as i64);
    let _ = writeln!(out, "{{\"fact\":\"constant\",\"of\":\"ENOPOLICY\",\"value\":{}}}", constants::ENOPOLICY as i64);
    let _ = writeln!(out, "{{\"fact\":\"constant\",\"of\":\"ENOPROTOOPT\",\"value\":{}}}", constants::ENOPROTOOPT as i64);
    let _ = writeln!(out, "{{\"fact\":\"constant\",\"of\":\"ENOSPC\",\"value\":{}}}", constants::ENOSPC as i64);
    let _ = writeln!(out, "{{\"fact\":\"constant\",\"of\":\"ENOSR\",\"value\":{}}}", constants::ENOSR as i64);
    let _ = writeln!(out, "{{\"fact\":\"constant\",\"of\":\"ENOSTR\",\"value\":{}}}", constants::ENOSTR as i64);
    let _ = writeln!(out, "{{\"fact\":\"constant\",\"of\":\"ENOSYS\",\"value\":{}}}", constants::ENOSYS as i64);
    let _ = writeln!(out, "{{\"fact\":\"constant\",\"of\":\"ENOTBLK\",\"value\":{}}}", constants::ENOTBLK as i64);
    let _ = writeln!(out, "{{\"fact\":\"constant\",\"of\":\"ENOTCONN\",\"value\":{}}}", constants::ENOTCONN as i64);
    let _ = writeln!(out, "{{\"fact\":\"constant\",\"of\":\"ENOTDIR\",\"value\":{}}}", constants::ENOTDIR as i64);
    let _ = writeln!(out, "{{\"fact\":\"constant\",\"of\":\"ENOTEMPTY\",\"value\":{}}}", constants::ENOTEMPTY as i64);
    let _ = writeln!(out, "{{\"fact\":\"constant\",\"of\":\"ENOTRECOVERABLE\",\"value\":{}}}", constants::ENOTRECOVERABLE as i64);
    let _ = writeln!(out, "{{\"fact\":\"constant\",\"of\":\"ENOTSOCK\",\"value\":{}}}", constants::ENOTSOCK as i64);
    let _ = writeln!(out, "{{\"fact\":\"constant\",\"of\":\"ENOTSUP\",\"value\":{}}}", constants::ENOTSUP as i64);
    let _ = writeln!(out, "{{\"fact\":\"constant\",\"of\":\"ENOTTY\",\"value\":{}}}", constants::ENOTTY as i64);
    let _ = writeln!(out, "{{\"fact\":\"constant\",\"of\":\"ENXIO\",\"value\":{}}}", constants::ENXIO as i64);
    let _ = writeln!(out, "{{\"fact\":\"constant\",\"of\":\"EOF\",\"value\":{}}}", constants::EOF as i64);
    let _ = writeln!(out, "{{\"fact\":\"constant\",\"of\":\"EOPNOTSUPP\",\"value\":{}}}", constants::EOPNOTSUPP as i64);
    let _ = writeln!(out, "{{\"fact\":\"constant\",\"of\":\"EOVERFLOW\",\"value\":{}}}", constants::EOVERFLOW as i64);
    let _ = writeln!(out, "{{\"fact\":\"constant\",\"of\":\"EOWNERDEAD\",\"value\":{}}}", constants::EOWNERDEAD as i64);
    let _ = writeln!(out, "{{\"fact\":\"constant\",\"of\":\"EPERM\",\"value\":{}}}", constants::EPERM as i64);
    let _ = writeln!(out, "{{\"fact\":\"constant\",\"of\":\"EPFNOSUPPORT\",\"value\":{}}}", constants::EPFNOSUPPORT as i64);
    let _ = writeln!(out, "{{\"fact\":\"constant\",\"of\":\"EPIPE\",\"value\":{}}}", constants::EPIPE as i64);
    let _ = writeln!(out, "{{\"fact\":\"constant\",\"of\":\"EPROCLIM\",\"value\":{}}}", constants::EPROCLIM as i64);
    let _ = writeln!(out, "{{\"fact\":\"constant\",\"of\":\"EPROCUNAVAIL\",\"value\":{}}}", constants::EPROCUNAVAIL as i64);
    let _ = writeln!(out, "{{\"fact\":\"constant\",\"of\":\"EPROGMISMATCH\",\"value\":{}}}", constants::EPROGMISMATCH as i64);
    let _ = writeln!(out, "{{\"fact\":\"constant\",\"of\":\"EPROGUNAVAIL\",\"value\":{}}}", constants::EPROGUNAVAIL as i64);
    let _ = writeln!(out, "{{\"fact\":\"constant\",\"of\":\"EPROTO\",\"value\":{}}}", constants::EPROTO as i64);
    let _ = writeln!(out, "{{\"fact\":\"constant\",\"of\":\"EPROTONOSUPPORT\",\"value\":{}}}", constants::EPROTONOSUPPORT as i64);
    let _ = writeln!(out, "{{\"fact\":\"constant\",\"of\":\"EPROTOTYPE\",\"value\":{}}}", constants::EPROTOTYPE as i64);
    let _ = writeln!(out, "{{\"fact\":\"constant\",\"of\":\"EPWROFF\",\"value\":{}}}", constants::EPWROFF as i64);
    let _ = writeln!(out, "{{\"fact\":\"constant\",\"of\":\"EQFULL\",\"value\":{}}}", constants::EQFULL as i64);
    let _ = writeln!(out, "{{\"fact\":\"constant\",\"of\":\"ERA\",\"value\":{}}}", constants::ERA as i64);
    let _ = writeln!(out, "{{\"fact\":\"constant\",\"of\":\"ERANGE\",\"value\":{}}}", constants::ERANGE as i64);
    let _ = writeln!(out, "{{\"fact\":\"constant\",\"of\":\"EREMOTE\",\"value\":{}}}", constants::EREMOTE as i64);
    let _ = writeln!(out, "{{\"fact\":\"constant\",\"of\":\"EROFS\",\"value\":{}}}", constants::EROFS as i64);
    let _ = writeln!(out, "{{\"fact\":\"constant\",\"of\":\"ERPCMISMATCH\",\"value\":{}}}", constants::ERPCMISMATCH as i64);
    let _ = writeln!(out, "{{\"fact\":\"constant\",\"of\":\"ESHLIBVERS\",\"value\":{}}}", constants::ESHLIBVERS as i64);
    let _ = writeln!(out, "{{\"fact\":\"constant\",\"of\":\"ESHUTDOWN\",\"value\":{}}}", constants::ESHUTDOWN as i64);
    let _ = writeln!(out, "{{\"fact\":\"constant\",\"of\":\"ESOCKTNOSUPPORT\",\"value\":{}}}", constants::ESOCKTNOSUPPORT as i64);
    let _ = writeln!(out, "{{\"fact\":\"constant\",\"of\":\"ESPIPE\",\"value\":{}}}", constants::ESPIPE as i64);
    let _ = writeln!(out, "{{\"fact\":\"constant\",\"of\":\"ESRCH\",\"value\":{}}}", constants::ESRCH as i64);
    let _ = writeln!(out, "{{\"fact\":\"constant\",\"of\":\"ESTALE\",\"value\":{}}}", constants::ESTALE as i64);
    let _ = writeln!(out, "{{\"fact\":\"constant\",\"of\":\"ETIME\",\"value\":{}}}", constants::ETIME as i64);
    let _ = writeln!(out, "{{\"fact\":\"constant\",\"of\":\"ETIMEDOUT\",\"value\":{}}}", constants::ETIMEDOUT as i64);
    let _ = writeln!(out, "{{\"fact\":\"constant\",\"of\":\"ETOOMANYREFS\",\"value\":{}}}", constants::ETOOMANYREFS as i64);
    let _ = writeln!(out, "{{\"fact\":\"constant\",\"of\":\"ETXTBSY\",\"value\":{}}}", constants::ETXTBSY as i64);
    let _ = writeln!(out, "{{\"fact\":\"constant\",\"of\":\"EUSERS\",\"value\":{}}}", constants::EUSERS as i64);
    let _ = writeln!(out, "{{\"fact\":\"constant\",\"of\":\"EV_ADD\",\"value\":{}}}", constants::EV_ADD as i64);
    let _ = writeln!(out, "{{\"fact\":\"constant\",\"of\":\"EV_CLEAR\",\"value\":{}}}", constants::EV_CLEAR as i64);
    let _ = writeln!(out, "{{\"fact\":\"constant\",\"of\":\"EV_DELETE\",\"value\":{}}}", constants::EV_DELETE as i64);
    let _ = writeln!(out, "{{\"fact\":\"constant\",\"of\":\"EV_DISABLE\",\"value\":{}}}", constants::EV_DISABLE as i64);
    let _ = writeln!(out, "{{\"fact\":\"constant\",\"of\":\"EV_DISPATCH\",\"value\":{}}}", constants::EV_DISPATCH as i64);
    let _ = writeln!(out, "{{\"fact\":\"constant\",\"of\":\"EV_ENABLE\",\"value\":{}}}", constants::EV_ENABLE as i64);
    let _ = writeln!(out, "{{\"fact\":\"constant\",\"of\":\"EV_EOF\",\"value\":{}}}", constants::EV_EOF as i64);
    let _ = writeln!(out, "{{\"fact\":\"constant\",\"of\":\"EV_ERROR\",\"value\":{}}}", constants::EV_ERROR as i64);
    let _ = writeln!(out, "{{\"fact\":\"constant\",\"of\":\"EV_ONESHOT\",\"value\":{}}}", constants::EV_ONESHOT as i64);
    let _ = writeln!(out, "{{\"fact\":\"constant\",\"of\":\"EV_RECEIPT\",\"value\":{}}}", constants::EV_RECEIPT as i64);
    let _ = writeln!(out, "{{\"fact\":\"constant\",\"of\":\"EVFILT_MACHPORT\",\"value\":{}}}", constants::EVFILT_MACHPORT as i64);
    let _ = writeln!(out, "{{\"fact\":\"constant\",\"of\":\"EVFILT_PROC\",\"value\":{}}}", constants::EVFILT_PROC as i64);
    let _ = writeln!(out, "{{\"fact\":\"constant\",\"of\":\"EVFILT_READ\",\"value\":{}}}", constants::EVFILT_READ as i64);
    let _ = writeln!(out, "{{\"fact\":\"constant\",\"of\":\"EVFILT_SIGNAL\",\"value\":{}}}", constants::EVFILT_SIGNAL as i64);
    let _ = writeln!(out, "{{\"fact\":\"constant\",\"of\":\"EVFILT_TIMER\",\"value\":{}}}", constants::EVFILT_TIMER as i64);
    let _ = writeln!(out, "{{\"fact\":\"constant\",\"of\":\"EVFILT_USER\",\"value\":{}}}", constants::EVFILT_USER as i64);
    let _ = writeln!(out, "{{\"fact\":\"constant\",\"of\":\"EVFILT_VNODE\",\"value\":{}}}", constants::EVFILT_VNODE as i64);
    let _ = writeln!(out, "{{\"fact\":\"constant\",\"of\":\"EVFILT_WRITE\",\"value\":{}}}", constants::EVFILT_WRITE as i64);
    let _ = writeln!(out, "{{\"fact\":\"constant\",\"of\":\"EWOULDBLOCK\",\"value\":{}}}", constants::EWOULDBLOCK as i64);
    let _ = writeln!(out, "{{\"fact\":\"constant\",\"of\":\"EXDEV\",\"value\":{}}}", constants::EXDEV as i64);
    let _ = writeln!(out, "{{\"fact\":\"constant\",\"of\":\"EXTA\",\"value\":{}}}", constants::EXTA as i64);
    let _ = writeln!(out, "{{\"fact\":\"constant\",\"of\":\"EXTB\",\"value\":{}}}", constants::EXTB as i64);
    let _ = writeln!(out, "{{\"fact\":\"constant\",\"of\":\"EXTPROC\",\"value\":{}}}", constants::EXTPROC as i64);
    let _ = writeln!(out, "{{\"fact\":\"constant\",\"of\":\"F_ALLOCATEALL\",\"value\":{}}}", constants::F_ALLOCATEALL as i64);
    let _ = writeln!(out, "{{\"fact\":\"constant\",\"of\":\"F_ALLOCATECONTIG\",\"value\":{}}}", constants::F_ALLOCATECONTIG as i64);
    let _ = writeln!(out, "{{\"fact\":\"constant\",\"of\":\"F_BARRIERFSYNC\",\"value\":{}}}", constants::F_BARRIERFSYNC as i64);
    let _ = writeln!(out, "{{\"fact\":\"constant\",\"of\":\"F_DUPFD\",\"value\":{}}}", constants::F_DUPFD as i64);
    let _ = writeln!(out, "{{\"fact\":\"constant\",\"of\":\"F_DUPFD_CLOEXEC\",\"value\":{}}}", constants::F_DUPFD_CLOEXEC as i64);
    let _ = writeln!(out, "{{\"fact\":\"constant\",\"of\":\"F_FULLFSYNC\",\"value\":{}}}", constants::F_FULLFSYNC as i64);
    let _ = writeln!(out, "{{\"fact\":\"constant\",\"of\":\"F_GETFD\",\"value\":{}}}", constants::F_GETFD as i64);
    let _ = writeln!(out, "{{\"fact\":\"constant\",\"of\":\"F_GETFL\",\"value\":{}}}", constants::F_GETFL as i64);
    let _ = writeln!(out, "{{\"fact\":\"constant\",\"of\":\"F_GETLK\",\"value\":{}}}", constants::F_GETLK as i64);
    let _ = writeln!(out, "{{\"fact\":\"constant\",\"of\":\"F_GETPATH\",\"value\":{}}}", constants::F_GETPATH as i64);
    let _ = writeln!(out, "{{\"fact\":\"constant\",\"of\":\"F_GETPATH_NOFIRMLINK\",\"value\":{}}}", constants::F_GETPATH_NOFIRMLINK as i64);
    let _ = writeln!(out, "{{\"fact\":\"constant\",\"of\":\"F_NOCACHE\",\"value\":{}}}", constants::F_NOCACHE as i64);
    let _ = writeln!(out, "{{\"fact\":\"constant\",\"of\":\"F_OK\",\"value\":{}}}", constants::F_OK as i64);
    let _ = writeln!(out, "{{\"fact\":\"constant\",\"of\":\"F_PEOFPOSMODE\",\"value\":{}}}", constants::F_PEOFPOSMODE as i64);
    let _ = writeln!(out, "{{\"fact\":\"constant\",\"of\":\"F_PREALLOCATE\",\"value\":{}}}", constants::F_PREALLOCATE as i64);
    let _ = writeln!(out, "{{\"fact\":\"constant\",\"of\":\"F_RDADVISE\",\"value\":{}}}", constants::F_RDADVISE as i64);
    let _ = writeln!(out, "{{\"fact\":\"constant\",\"of\":\"F_RDAHEAD\",\"value\":{}}}", constants::F_RDAHEAD as i64);
    let _ = writeln!(out, "{{\"fact\":\"constant\",\"of\":\"F_RDLCK\",\"value\":{}}}", constants::F_RDLCK as i64);
    let _ = writeln!(out, "{{\"fact\":\"constant\",\"of\":\"F_SETFD\",\"value\":{}}}", constants::F_SETFD as i64);
    let _ = writeln!(out, "{{\"fact\":\"constant\",\"of\":\"F_SETFL\",\"value\":{}}}", constants::F_SETFL as i64);
    let _ = writeln!(out, "{{\"fact\":\"constant\",\"of\":\"F_SETLK\",\"value\":{}}}", constants::F_SETLK as i64);
    let _ = writeln!(out, "{{\"fact\":\"constant\",\"of\":\"F_SETLKW\",\"value\":{}}}", constants::F_SETLKW as i64);
    let _ = writeln!(out, "{{\"fact\":\"constant\",\"of\":\"F_UNLCK\",\"value\":{}}}", constants::F_UNLCK as i64);
    let _ = writeln!(out, "{{\"fact\":\"constant\",\"of\":\"F_VOLPOSMODE\",\"value\":{}}}", constants::F_VOLPOSMODE as i64);
    let _ = writeln!(out, "{{\"fact\":\"constant\",\"of\":\"F_WRLCK\",\"value\":{}}}", constants::F_WRLCK as i64);
    let _ = writeln!(out, "{{\"fact\":\"constant\",\"of\":\"FD_CLOEXEC\",\"value\":{}}}", constants::FD_CLOEXEC as i64);
    let _ = writeln!(out, "{{\"fact\":\"constant\",\"of\":\"HOST_VM_INFO64\",\"value\":{}}}", constants::HOST_VM_INFO64 as i64);
    let _ = writeln!(out, "{{\"fact\":\"constant\",\"of\":\"HOST_VM_INFO64_COUNT\",\"value\":{}}}", constants::HOST_VM_INFO64_COUNT as i64);
    let _ = writeln!(out, "{{\"fact\":\"constant\",\"of\":\"MAXPATHLEN\",\"value\":{}}}", constants::MAXPATHLEN as i64);
    let _ = writeln!(out, "{{\"fact\":\"constant\",\"of\":\"MSG_CTRUNC\",\"value\":{}}}", constants::MSG_CTRUNC as i64);
    let _ = writeln!(out, "{{\"fact\":\"constant\",\"of\":\"MSG_DONTROUTE\",\"value\":{}}}", constants::MSG_DONTROUTE as i64);
    let _ = writeln!(out, "{{\"fact\":\"constant\",\"of\":\"MSG_DONTWAIT\",\"value\":{}}}", constants::MSG_DONTWAIT as i64);
    let _ = writeln!(out, "{{\"fact\":\"constant\",\"of\":\"MSG_EOF\",\"value\":{}}}", constants::MSG_EOF as i64);
    let _ = writeln!(out, "{{\"fact\":\"constant\",\"of\":\"MSG_EOR\",\"value\":{}}}", constants::MSG_EOR as i64);
    let _ = writeln!(out, "{{\"fact\":\"constant\",\"of\":\"MSG_FLUSH\",\"value\":{}}}", constants::MSG_FLUSH as i64);
    let _ = writeln!(out, "{{\"fact\":\"constant\",\"of\":\"MSG_HAVEMORE\",\"value\":{}}}", constants::MSG_HAVEMORE as i64);
    let _ = writeln!(out, "{{\"fact\":\"constant\",\"of\":\"MSG_HOLD\",\"value\":{}}}", constants::MSG_HOLD as i64);
    let _ = writeln!(out, "{{\"fact\":\"constant\",\"of\":\"MSG_NEEDSA\",\"value\":{}}}", constants::MSG_NEEDSA as i64);
    let _ = writeln!(out, "{{\"fact\":\"constant\",\"of\":\"MSG_NOSIGNAL\",\"value\":{}}}", constants::MSG_NOSIGNAL as i64);
    let _ = writeln!(out, "{{\"fact\":\"constant\",\"of\":\"MSG_OOB\",\"value\":{}}}", constants::MSG_OOB as i64);
    let _ = writeln!(out, "{{\"fact\":\"constant\",\"of\":\"MSG_PEEK\",\"value\":{}}}", constants::MSG_PEEK as i64);
    let _ = writeln!(out, "{{\"fact\":\"constant\",\"of\":\"MSG_RCVMORE\",\"value\":{}}}", constants::MSG_RCVMORE as i64);
    let _ = writeln!(out, "{{\"fact\":\"constant\",\"of\":\"MSG_SEND\",\"value\":{}}}", constants::MSG_SEND as i64);
    let _ = writeln!(out, "{{\"fact\":\"constant\",\"of\":\"MSG_TRUNC\",\"value\":{}}}", constants::MSG_TRUNC as i64);
    let _ = writeln!(out, "{{\"fact\":\"constant\",\"of\":\"MSG_WAITALL\",\"value\":{}}}", constants::MSG_WAITALL as i64);
    let _ = writeln!(out, "{{\"fact\":\"constant\",\"of\":\"NOTE_ATTRIB\",\"value\":{}}}", constants::NOTE_ATTRIB as i64);
    let _ = writeln!(out, "{{\"fact\":\"constant\",\"of\":\"NOTE_DELETE\",\"value\":{}}}", constants::NOTE_DELETE as i64);
    let _ = writeln!(out, "{{\"fact\":\"constant\",\"of\":\"NOTE_EXEC\",\"value\":{}}}", constants::NOTE_EXEC as i64);
    let _ = writeln!(out, "{{\"fact\":\"constant\",\"of\":\"NOTE_EXIT\",\"value\":{}}}", constants::NOTE_EXIT as i64);
    let _ = writeln!(out, "{{\"fact\":\"constant\",\"of\":\"NOTE_EXITSTATUS\",\"value\":{}}}", constants::NOTE_EXITSTATUS as i64);
    let _ = writeln!(out, "{{\"fact\":\"constant\",\"of\":\"NOTE_EXTEND\",\"value\":{}}}", constants::NOTE_EXTEND as i64);
    let _ = writeln!(out, "{{\"fact\":\"constant\",\"of\":\"NOTE_FORK\",\"value\":{}}}", constants::NOTE_FORK as i64);
    let _ = writeln!(out, "{{\"fact\":\"constant\",\"of\":\"NOTE_LINK\",\"value\":{}}}", constants::NOTE_LINK as i64);
    let _ = writeln!(out, "{{\"fact\":\"constant\",\"of\":\"NOTE_RENAME\",\"value\":{}}}", constants::NOTE_RENAME as i64);
    let _ = writeln!(out, "{{\"fact\":\"constant\",\"of\":\"NOTE_REVOKE\",\"value\":{}}}", constants::NOTE_REVOKE as i64);
    let _ = writeln!(out, "{{\"fact\":\"constant\",\"of\":\"NOTE_SIGNAL\",\"value\":{}}}", constants::NOTE_SIGNAL as i64);
    let _ = writeln!(out, "{{\"fact\":\"constant\",\"of\":\"NOTE_TRIGGER\",\"value\":{}}}", constants::NOTE_TRIGGER as i64);
    let _ = writeln!(out, "{{\"fact\":\"constant\",\"of\":\"NOTE_WRITE\",\"value\":{}}}", constants::NOTE_WRITE as i64);
    let _ = writeln!(out, "{{\"fact\":\"constant\",\"of\":\"O_ACCMODE\",\"value\":{}}}", constants::O_ACCMODE as i64);
    let _ = writeln!(out, "{{\"fact\":\"constant\",\"of\":\"O_APPEND\",\"value\":{}}}", constants::O_APPEND as i64);
    let _ = writeln!(out, "{{\"fact\":\"constant\",\"of\":\"O_ASYNC\",\"value\":{}}}", constants::O_ASYNC as i64);
    let _ = writeln!(out, "{{\"fact\":\"constant\",\"of\":\"O_CLOEXEC\",\"value\":{}}}", constants::O_CLOEXEC as i64);
    let _ = writeln!(out, "{{\"fact\":\"constant\",\"of\":\"O_CREAT\",\"value\":{}}}", constants::O_CREAT as i64);
    let _ = writeln!(out, "{{\"fact\":\"constant\",\"of\":\"O_DIRECTORY\",\"value\":{}}}", constants::O_DIRECTORY as i64);
    let _ = writeln!(out, "{{\"fact\":\"constant\",\"of\":\"O_DSYNC\",\"value\":{}}}", constants::O_DSYNC as i64);
    let _ = writeln!(out, "{{\"fact\":\"constant\",\"of\":\"O_EVTONLY\",\"value\":{}}}", constants::O_EVTONLY as i64);
    let _ = writeln!(out, "{{\"fact\":\"constant\",\"of\":\"O_EXCL\",\"value\":{}}}", constants::O_EXCL as i64);
    let _ = writeln!(out, "{{\"fact\":\"constant\",\"of\":\"O_EXEC\",\"value\":{}}}", constants::O_EXEC as i64);
    let _ = writeln!(out, "{{\"fact\":\"constant\",\"of\":\"O_EXLOCK\",\"value\":{}}}", constants::O_EXLOCK as i64);
    let _ = writeln!(out, "{{\"fact\":\"constant\",\"of\":\"O_FSYNC\",\"value\":{}}}", constants::O_FSYNC as i64);
    let _ = writeln!(out, "{{\"fact\":\"constant\",\"of\":\"O_NDELAY\",\"value\":{}}}", constants::O_NDELAY as i64);
    let _ = writeln!(out, "{{\"fact\":\"constant\",\"of\":\"O_NOCTTY\",\"value\":{}}}", constants::O_NOCTTY as i64);
    let _ = writeln!(out, "{{\"fact\":\"constant\",\"of\":\"O_NOFOLLOW\",\"value\":{}}}", constants::O_NOFOLLOW as i64);
    let _ = writeln!(out, "{{\"fact\":\"constant\",\"of\":\"O_NOFOLLOW_ANY\",\"value\":{}}}", constants::O_NOFOLLOW_ANY as i64);
    let _ = writeln!(out, "{{\"fact\":\"constant\",\"of\":\"O_NONBLOCK\",\"value\":{}}}", constants::O_NONBLOCK as i64);
    let _ = writeln!(out, "{{\"fact\":\"constant\",\"of\":\"O_RDONLY\",\"value\":{}}}", constants::O_RDONLY as i64);
    let _ = writeln!(out, "{{\"fact\":\"constant\",\"of\":\"O_RDWR\",\"value\":{}}}", constants::O_RDWR as i64);
    let _ = writeln!(out, "{{\"fact\":\"constant\",\"of\":\"O_SEARCH\",\"value\":{}}}", constants::O_SEARCH as i64);
    let _ = writeln!(out, "{{\"fact\":\"constant\",\"of\":\"O_SHLOCK\",\"value\":{}}}", constants::O_SHLOCK as i64);
    let _ = writeln!(out, "{{\"fact\":\"constant\",\"of\":\"O_SYMLINK\",\"value\":{}}}", constants::O_SYMLINK as i64);
    let _ = writeln!(out, "{{\"fact\":\"constant\",\"of\":\"O_SYNC\",\"value\":{}}}", constants::O_SYNC as i64);
    let _ = writeln!(out, "{{\"fact\":\"constant\",\"of\":\"O_TRUNC\",\"value\":{}}}", constants::O_TRUNC as i64);
    let _ = writeln!(out, "{{\"fact\":\"constant\",\"of\":\"O_WRONLY\",\"value\":{}}}", constants::O_WRONLY as i64);
    let _ = writeln!(out, "{{\"fact\":\"constant\",\"of\":\"PATH_MAX\",\"value\":{}}}", constants::PATH_MAX as i64);
    let _ = writeln!(out, "{{\"fact\":\"constant\",\"of\":\"POLLERR\",\"value\":{}}}", constants::POLLERR as i64);
    let _ = writeln!(out, "{{\"fact\":\"constant\",\"of\":\"POLLHUP\",\"value\":{}}}", constants::POLLHUP as i64);
    let _ = writeln!(out, "{{\"fact\":\"constant\",\"of\":\"POLLIN\",\"value\":{}}}", constants::POLLIN as i64);
    let _ = writeln!(out, "{{\"fact\":\"constant\",\"of\":\"POLLNVAL\",\"value\":{}}}", constants::POLLNVAL as i64);
    let _ = writeln!(out, "{{\"fact\":\"constant\",\"of\":\"POLLOUT\",\"value\":{}}}", constants::POLLOUT as i64);
    let _ = writeln!(out, "{{\"fact\":\"constant\",\"of\":\"POLLPRI\",\"value\":{}}}", constants::POLLPRI as i64);
    let _ = writeln!(out, "{{\"fact\":\"constant\",\"of\":\"POLLRDBAND\",\"value\":{}}}", constants::POLLRDBAND as i64);
    let _ = writeln!(out, "{{\"fact\":\"constant\",\"of\":\"POLLRDNORM\",\"value\":{}}}", constants::POLLRDNORM as i64);
    let _ = writeln!(out, "{{\"fact\":\"constant\",\"of\":\"POLLWRBAND\",\"value\":{}}}", constants::POLLWRBAND as i64);
    let _ = writeln!(out, "{{\"fact\":\"constant\",\"of\":\"POLLWRNORM\",\"value\":{}}}", constants::POLLWRNORM as i64);
    let _ = writeln!(out, "{{\"fact\":\"constant\",\"of\":\"PROCESSOR_CPU_LOAD_INFO\",\"value\":{}}}", constants::PROCESSOR_CPU_LOAD_INFO as i64);
    let _ = writeln!(out, "{{\"fact\":\"constant\",\"of\":\"R_OK\",\"value\":{}}}", constants::R_OK as i64);
    let _ = writeln!(out, "{{\"fact\":\"constant\",\"of\":\"RENAME_EXCL\",\"value\":{}}}", constants::RENAME_EXCL as i64);
    let _ = writeln!(out, "{{\"fact\":\"constant\",\"of\":\"RENAME_SWAP\",\"value\":{}}}", constants::RENAME_SWAP as i64);
    let _ = writeln!(out, "{{\"fact\":\"constant\",\"of\":\"S_IEXEC\",\"value\":{}}}", constants::S_IEXEC as i64);
    let _ = writeln!(out, "{{\"fact\":\"constant\",\"of\":\"S_IFBLK\",\"value\":{}}}", constants::S_IFBLK as i64);
    let _ = writeln!(out, "{{\"fact\":\"constant\",\"of\":\"S_IFCHR\",\"value\":{}}}", constants::S_IFCHR as i64);
    let _ = writeln!(out, "{{\"fact\":\"constant\",\"of\":\"S_IFDIR\",\"value\":{}}}", constants::S_IFDIR as i64);
    let _ = writeln!(out, "{{\"fact\":\"constant\",\"of\":\"S_IFIFO\",\"value\":{}}}", constants::S_IFIFO as i64);
    let _ = writeln!(out, "{{\"fact\":\"constant\",\"of\":\"S_IFLNK\",\"value\":{}}}", constants::S_IFLNK as i64);
    let _ = writeln!(out, "{{\"fact\":\"constant\",\"of\":\"S_IFMT\",\"value\":{}}}", constants::S_IFMT as i64);
    let _ = writeln!(out, "{{\"fact\":\"constant\",\"of\":\"S_IFREG\",\"value\":{}}}", constants::S_IFREG as i64);
    let _ = writeln!(out, "{{\"fact\":\"constant\",\"of\":\"S_IFSOCK\",\"value\":{}}}", constants::S_IFSOCK as i64);
    let _ = writeln!(out, "{{\"fact\":\"constant\",\"of\":\"S_IREAD\",\"value\":{}}}", constants::S_IREAD as i64);
    let _ = writeln!(out, "{{\"fact\":\"constant\",\"of\":\"S_IRGRP\",\"value\":{}}}", constants::S_IRGRP as i64);
    let _ = writeln!(out, "{{\"fact\":\"constant\",\"of\":\"S_IROTH\",\"value\":{}}}", constants::S_IROTH as i64);
    let _ = writeln!(out, "{{\"fact\":\"constant\",\"of\":\"S_IRUSR\",\"value\":{}}}", constants::S_IRUSR as i64);
    let _ = writeln!(out, "{{\"fact\":\"constant\",\"of\":\"S_IRWXG\",\"value\":{}}}", constants::S_IRWXG as i64);
    let _ = writeln!(out, "{{\"fact\":\"constant\",\"of\":\"S_IRWXO\",\"value\":{}}}", constants::S_IRWXO as i64);
    let _ = writeln!(out, "{{\"fact\":\"constant\",\"of\":\"S_IRWXU\",\"value\":{}}}", constants::S_IRWXU as i64);
    let _ = writeln!(out, "{{\"fact\":\"constant\",\"of\":\"S_ISGID\",\"value\":{}}}", constants::S_ISGID as i64);
    let _ = writeln!(out, "{{\"fact\":\"constant\",\"of\":\"S_ISUID\",\"value\":{}}}", constants::S_ISUID as i64);
    let _ = writeln!(out, "{{\"fact\":\"constant\",\"of\":\"S_ISVTX\",\"value\":{}}}", constants::S_ISVTX as i64);
    let _ = writeln!(out, "{{\"fact\":\"constant\",\"of\":\"S_IWGRP\",\"value\":{}}}", constants::S_IWGRP as i64);
    let _ = writeln!(out, "{{\"fact\":\"constant\",\"of\":\"S_IWOTH\",\"value\":{}}}", constants::S_IWOTH as i64);
    let _ = writeln!(out, "{{\"fact\":\"constant\",\"of\":\"S_IWRITE\",\"value\":{}}}", constants::S_IWRITE as i64);
    let _ = writeln!(out, "{{\"fact\":\"constant\",\"of\":\"S_IWUSR\",\"value\":{}}}", constants::S_IWUSR as i64);
    let _ = writeln!(out, "{{\"fact\":\"constant\",\"of\":\"S_IXGRP\",\"value\":{}}}", constants::S_IXGRP as i64);
    let _ = writeln!(out, "{{\"fact\":\"constant\",\"of\":\"S_IXOTH\",\"value\":{}}}", constants::S_IXOTH as i64);
    let _ = writeln!(out, "{{\"fact\":\"constant\",\"of\":\"S_IXUSR\",\"value\":{}}}", constants::S_IXUSR as i64);
    let _ = writeln!(out, "{{\"fact\":\"constant\",\"of\":\"SEEK_CUR\",\"value\":{}}}", constants::SEEK_CUR as i64);
    let _ = writeln!(out, "{{\"fact\":\"constant\",\"of\":\"SEEK_DATA\",\"value\":{}}}", constants::SEEK_DATA as i64);
    let _ = writeln!(out, "{{\"fact\":\"constant\",\"of\":\"SEEK_END\",\"value\":{}}}", constants::SEEK_END as i64);
    let _ = writeln!(out, "{{\"fact\":\"constant\",\"of\":\"SEEK_HOLE\",\"value\":{}}}", constants::SEEK_HOLE as i64);
    let _ = writeln!(out, "{{\"fact\":\"constant\",\"of\":\"SEEK_SET\",\"value\":{}}}", constants::SEEK_SET as i64);
    let _ = writeln!(out, "{{\"fact\":\"constant\",\"of\":\"SIGABRT\",\"value\":{}}}", constants::SIGABRT as i64);
    let _ = writeln!(out, "{{\"fact\":\"constant\",\"of\":\"SIGALRM\",\"value\":{}}}", constants::SIGALRM as i64);
    let _ = writeln!(out, "{{\"fact\":\"constant\",\"of\":\"SIGBUS\",\"value\":{}}}", constants::SIGBUS as i64);
    let _ = writeln!(out, "{{\"fact\":\"constant\",\"of\":\"SIGCHLD\",\"value\":{}}}", constants::SIGCHLD as i64);
    let _ = writeln!(out, "{{\"fact\":\"constant\",\"of\":\"SIGCONT\",\"value\":{}}}", constants::SIGCONT as i64);
    let _ = writeln!(out, "{{\"fact\":\"constant\",\"of\":\"SIGEMT\",\"value\":{}}}", constants::SIGEMT as i64);
    let _ = writeln!(out, "{{\"fact\":\"constant\",\"of\":\"SIGFPE\",\"value\":{}}}", constants::SIGFPE as i64);
    let _ = writeln!(out, "{{\"fact\":\"constant\",\"of\":\"SIGHUP\",\"value\":{}}}", constants::SIGHUP as i64);
    let _ = writeln!(out, "{{\"fact\":\"constant\",\"of\":\"SIGILL\",\"value\":{}}}", constants::SIGILL as i64);
    let _ = writeln!(out, "{{\"fact\":\"constant\",\"of\":\"SIGINFO\",\"value\":{}}}", constants::SIGINFO as i64);
    let _ = writeln!(out, "{{\"fact\":\"constant\",\"of\":\"SIGINT\",\"value\":{}}}", constants::SIGINT as i64);
    let _ = writeln!(out, "{{\"fact\":\"constant\",\"of\":\"SIGIO\",\"value\":{}}}", constants::SIGIO as i64);
    let _ = writeln!(out, "{{\"fact\":\"constant\",\"of\":\"SIGIOT\",\"value\":{}}}", constants::SIGIOT as i64);
    let _ = writeln!(out, "{{\"fact\":\"constant\",\"of\":\"SIGKILL\",\"value\":{}}}", constants::SIGKILL as i64);
    let _ = writeln!(out, "{{\"fact\":\"constant\",\"of\":\"SIGNATURE\",\"value\":{}}}", constants::SIGNATURE as i64);
    let _ = writeln!(out, "{{\"fact\":\"constant\",\"of\":\"SIGPIPE\",\"value\":{}}}", constants::SIGPIPE as i64);
    let _ = writeln!(out, "{{\"fact\":\"constant\",\"of\":\"SIGPROF\",\"value\":{}}}", constants::SIGPROF as i64);
    let _ = writeln!(out, "{{\"fact\":\"constant\",\"of\":\"SIGQUIT\",\"value\":{}}}", constants::SIGQUIT as i64);
    let _ = writeln!(out, "{{\"fact\":\"constant\",\"of\":\"SIGSEGV\",\"value\":{}}}", constants::SIGSEGV as i64);
    let _ = writeln!(out, "{{\"fact\":\"constant\",\"of\":\"SIGSTKSZ\",\"value\":{}}}", constants::SIGSTKSZ as i64);
    let _ = writeln!(out, "{{\"fact\":\"constant\",\"of\":\"SIGSTOP\",\"value\":{}}}", constants::SIGSTOP as i64);
    let _ = writeln!(out, "{{\"fact\":\"constant\",\"of\":\"SIGSYS\",\"value\":{}}}", constants::SIGSYS as i64);
    let _ = writeln!(out, "{{\"fact\":\"constant\",\"of\":\"SIGTERM\",\"value\":{}}}", constants::SIGTERM as i64);
    let _ = writeln!(out, "{{\"fact\":\"constant\",\"of\":\"SIGTRAP\",\"value\":{}}}", constants::SIGTRAP as i64);
    let _ = writeln!(out, "{{\"fact\":\"constant\",\"of\":\"SIGTSTP\",\"value\":{}}}", constants::SIGTSTP as i64);
    let _ = writeln!(out, "{{\"fact\":\"constant\",\"of\":\"SIGTTIN\",\"value\":{}}}", constants::SIGTTIN as i64);
    let _ = writeln!(out, "{{\"fact\":\"constant\",\"of\":\"SIGTTOU\",\"value\":{}}}", constants::SIGTTOU as i64);
    let _ = writeln!(out, "{{\"fact\":\"constant\",\"of\":\"SIGURG\",\"value\":{}}}", constants::SIGURG as i64);
    let _ = writeln!(out, "{{\"fact\":\"constant\",\"of\":\"SIGUSR1\",\"value\":{}}}", constants::SIGUSR1 as i64);
    let _ = writeln!(out, "{{\"fact\":\"constant\",\"of\":\"SIGUSR2\",\"value\":{}}}", constants::SIGUSR2 as i64);
    let _ = writeln!(out, "{{\"fact\":\"constant\",\"of\":\"SIGVTALRM\",\"value\":{}}}", constants::SIGVTALRM as i64);
    let _ = writeln!(out, "{{\"fact\":\"constant\",\"of\":\"SIGWINCH\",\"value\":{}}}", constants::SIGWINCH as i64);
    let _ = writeln!(out, "{{\"fact\":\"constant\",\"of\":\"SIGXCPU\",\"value\":{}}}", constants::SIGXCPU as i64);
    let _ = writeln!(out, "{{\"fact\":\"constant\",\"of\":\"SIGXFSZ\",\"value\":{}}}", constants::SIGXFSZ as i64);
    let _ = writeln!(out, "{{\"fact\":\"constant\",\"of\":\"SO_NOSIGPIPE\",\"value\":{}}}", constants::SO_NOSIGPIPE as i64);
    let _ = writeln!(out, "{{\"fact\":\"constant\",\"of\":\"SO_RCVBUF\",\"value\":{}}}", constants::SO_RCVBUF as i64);
    let _ = writeln!(out, "{{\"fact\":\"constant\",\"of\":\"SO_SNDBUF\",\"value\":{}}}", constants::SO_SNDBUF as i64);
    let _ = writeln!(out, "{{\"fact\":\"constant\",\"of\":\"SOL_SOCKET\",\"value\":{}}}", constants::SOL_SOCKET as i64);
    let _ = writeln!(out, "{{\"fact\":\"constant\",\"of\":\"W_OK\",\"value\":{}}}", constants::W_OK as i64);
    let _ = writeln!(out, "{{\"fact\":\"constant\",\"of\":\"WNOHANG\",\"value\":{}}}", constants::WNOHANG as i64);
    let _ = writeln!(out, "{{\"fact\":\"constant\",\"of\":\"WUNTRACED\",\"value\":{}}}", constants::WUNTRACED as i64);
    let _ = writeln!(out, "{{\"fact\":\"constant\",\"of\":\"X_OK\",\"value\":{}}}", constants::X_OK as i64);
}
