// Written by misctools/portable/bindings/darwin.ts. Do not edit.
//
// Prints what the headers of macOS say about the structures and the constants of bun_darwin_sys, one
// JSON object on each line: {"fact": "size" | "align" | "offset" | "field size" | "constant", "of", "value"}.
// `bun_fs_slice.img --layout-darwin` prints the same lines from the image, in the same order.
//
// The program has 66 parts, one for each structure and one for the constants, and is compiled once for
// each: a name that the headers of this macOS do not have stops one part and not the others.
//   cc -DPART=<n> -o part darwin_layout.c && ./part        n = 1 .. 66
//   cc -DPART=0 ...                                         prints the number of parts
// A field that the headers do not have is left out with -DSKIP_<type>_<field>, which run-on-mac.sh
// does from the message of the compiler.
#include <sys/types.h>
#include <sys/stat.h>
#include <sys/mount.h>
#include <sys/dirent.h>
#include <sys/event.h>
#include <sys/attr.h>
#include <sys/clonefile.h>
#include <sys/socket.h>
#include <sys/time.h>
#include <sys/uio.h>
#include <sys/wait.h>
#include <sys/sysctl.h>
#include <sys/param.h>
#include <net/if_dl.h>
#include <copyfile.h>
#include <errno.h>
#include <fcntl.h>
#include <poll.h>
#include <signal.h>
#include <spawn.h>
#include <stdio.h>
#include <unistd.h>
#include <pthread.h>
#include <os/lock.h>
#include <mach/mach.h>
#include <mach/mach_time.h>
#include <libproc.h>
#include <dlfcn.h>
#include <stddef.h>

int main(void) {
#if PART == 0
  printf("66\n");
#endif
#if PART == 1
  printf("{\"fact\":\"size\",\"of\":\"attrgroup_t\",\"value\":%zu}\n", sizeof(attrgroup_t));
  printf("{\"fact\":\"align\",\"of\":\"attrgroup_t\",\"value\":%zu}\n", _Alignof(attrgroup_t));
#endif
#if PART == 2
  printf("{\"fact\":\"size\",\"of\":\"attrlist\",\"value\":%zu}\n", sizeof(struct attrlist));
  printf("{\"fact\":\"align\",\"of\":\"attrlist\",\"value\":%zu}\n", _Alignof(struct attrlist));
#ifndef SKIP_attrlist_bitmapcount
  printf("{\"fact\":\"offset\",\"of\":\"attrlist.bitmapcount\",\"value\":%zu}\n", offsetof(struct attrlist, bitmapcount));
  printf("{\"fact\":\"field size\",\"of\":\"attrlist.bitmapcount\",\"value\":%zu}\n", sizeof(((struct attrlist *)0)->bitmapcount));
#endif
#ifndef SKIP_attrlist_reserved
  printf("{\"fact\":\"offset\",\"of\":\"attrlist.reserved\",\"value\":%zu}\n", offsetof(struct attrlist, reserved));
  printf("{\"fact\":\"field size\",\"of\":\"attrlist.reserved\",\"value\":%zu}\n", sizeof(((struct attrlist *)0)->reserved));
#endif
#ifndef SKIP_attrlist_commonattr
  printf("{\"fact\":\"offset\",\"of\":\"attrlist.commonattr\",\"value\":%zu}\n", offsetof(struct attrlist, commonattr));
  printf("{\"fact\":\"field size\",\"of\":\"attrlist.commonattr\",\"value\":%zu}\n", sizeof(((struct attrlist *)0)->commonattr));
#endif
#ifndef SKIP_attrlist_volattr
  printf("{\"fact\":\"offset\",\"of\":\"attrlist.volattr\",\"value\":%zu}\n", offsetof(struct attrlist, volattr));
  printf("{\"fact\":\"field size\",\"of\":\"attrlist.volattr\",\"value\":%zu}\n", sizeof(((struct attrlist *)0)->volattr));
#endif
#ifndef SKIP_attrlist_dirattr
  printf("{\"fact\":\"offset\",\"of\":\"attrlist.dirattr\",\"value\":%zu}\n", offsetof(struct attrlist, dirattr));
  printf("{\"fact\":\"field size\",\"of\":\"attrlist.dirattr\",\"value\":%zu}\n", sizeof(((struct attrlist *)0)->dirattr));
#endif
#ifndef SKIP_attrlist_fileattr
  printf("{\"fact\":\"offset\",\"of\":\"attrlist.fileattr\",\"value\":%zu}\n", offsetof(struct attrlist, fileattr));
  printf("{\"fact\":\"field size\",\"of\":\"attrlist.fileattr\",\"value\":%zu}\n", sizeof(((struct attrlist *)0)->fileattr));
#endif
#ifndef SKIP_attrlist_forkattr
  printf("{\"fact\":\"offset\",\"of\":\"attrlist.forkattr\",\"value\":%zu}\n", offsetof(struct attrlist, forkattr));
  printf("{\"fact\":\"field size\",\"of\":\"attrlist.forkattr\",\"value\":%zu}\n", sizeof(((struct attrlist *)0)->forkattr));
#endif
#endif
#if PART == 3
  printf("{\"fact\":\"size\",\"of\":\"blkcnt_t\",\"value\":%zu}\n", sizeof(blkcnt_t));
  printf("{\"fact\":\"align\",\"of\":\"blkcnt_t\",\"value\":%zu}\n", _Alignof(blkcnt_t));
#endif
#if PART == 4
  printf("{\"fact\":\"size\",\"of\":\"blksize_t\",\"value\":%zu}\n", sizeof(blksize_t));
  printf("{\"fact\":\"align\",\"of\":\"blksize_t\",\"value\":%zu}\n", _Alignof(blksize_t));
#endif
#if PART == 5
  printf("{\"fact\":\"size\",\"of\":\"copyfile_flags_t\",\"value\":%zu}\n", sizeof(copyfile_flags_t));
  printf("{\"fact\":\"align\",\"of\":\"copyfile_flags_t\",\"value\":%zu}\n", _Alignof(copyfile_flags_t));
#endif
#if PART == 6
  printf("{\"fact\":\"size\",\"of\":\"copyfile_state_t\",\"value\":%zu}\n", sizeof(copyfile_state_t));
  printf("{\"fact\":\"align\",\"of\":\"copyfile_state_t\",\"value\":%zu}\n", _Alignof(copyfile_state_t));
#endif
#if PART == 7
  printf("{\"fact\":\"size\",\"of\":\"dev_t\",\"value\":%zu}\n", sizeof(dev_t));
  printf("{\"fact\":\"align\",\"of\":\"dev_t\",\"value\":%zu}\n", _Alignof(dev_t));
#endif
#if PART == 8
  printf("{\"fact\":\"size\",\"of\":\"dirent\",\"value\":%zu}\n", sizeof(struct dirent));
  printf("{\"fact\":\"align\",\"of\":\"dirent\",\"value\":%zu}\n", _Alignof(struct dirent));
#ifndef SKIP_dirent_d_ino
  printf("{\"fact\":\"offset\",\"of\":\"dirent.d_ino\",\"value\":%zu}\n", offsetof(struct dirent, d_ino));
  printf("{\"fact\":\"field size\",\"of\":\"dirent.d_ino\",\"value\":%zu}\n", sizeof(((struct dirent *)0)->d_ino));
#endif
#ifndef SKIP_dirent_d_seekoff
  printf("{\"fact\":\"offset\",\"of\":\"dirent.d_seekoff\",\"value\":%zu}\n", offsetof(struct dirent, d_seekoff));
  printf("{\"fact\":\"field size\",\"of\":\"dirent.d_seekoff\",\"value\":%zu}\n", sizeof(((struct dirent *)0)->d_seekoff));
#endif
#ifndef SKIP_dirent_d_reclen
  printf("{\"fact\":\"offset\",\"of\":\"dirent.d_reclen\",\"value\":%zu}\n", offsetof(struct dirent, d_reclen));
  printf("{\"fact\":\"field size\",\"of\":\"dirent.d_reclen\",\"value\":%zu}\n", sizeof(((struct dirent *)0)->d_reclen));
#endif
#ifndef SKIP_dirent_d_namlen
  printf("{\"fact\":\"offset\",\"of\":\"dirent.d_namlen\",\"value\":%zu}\n", offsetof(struct dirent, d_namlen));
  printf("{\"fact\":\"field size\",\"of\":\"dirent.d_namlen\",\"value\":%zu}\n", sizeof(((struct dirent *)0)->d_namlen));
#endif
#ifndef SKIP_dirent_d_type
  printf("{\"fact\":\"offset\",\"of\":\"dirent.d_type\",\"value\":%zu}\n", offsetof(struct dirent, d_type));
  printf("{\"fact\":\"field size\",\"of\":\"dirent.d_type\",\"value\":%zu}\n", sizeof(((struct dirent *)0)->d_type));
#endif
#ifndef SKIP_dirent_d_name
  printf("{\"fact\":\"offset\",\"of\":\"dirent.d_name\",\"value\":%zu}\n", offsetof(struct dirent, d_name));
  printf("{\"fact\":\"field size\",\"of\":\"dirent.d_name\",\"value\":%zu}\n", sizeof(((struct dirent *)0)->d_name));
#endif
#endif
#if PART == 9
  printf("{\"fact\":\"size\",\"of\":\"flock\",\"value\":%zu}\n", sizeof(struct flock));
  printf("{\"fact\":\"align\",\"of\":\"flock\",\"value\":%zu}\n", _Alignof(struct flock));
#ifndef SKIP_flock_l_start
  printf("{\"fact\":\"offset\",\"of\":\"flock.l_start\",\"value\":%zu}\n", offsetof(struct flock, l_start));
  printf("{\"fact\":\"field size\",\"of\":\"flock.l_start\",\"value\":%zu}\n", sizeof(((struct flock *)0)->l_start));
#endif
#ifndef SKIP_flock_l_len
  printf("{\"fact\":\"offset\",\"of\":\"flock.l_len\",\"value\":%zu}\n", offsetof(struct flock, l_len));
  printf("{\"fact\":\"field size\",\"of\":\"flock.l_len\",\"value\":%zu}\n", sizeof(((struct flock *)0)->l_len));
#endif
#ifndef SKIP_flock_l_pid
  printf("{\"fact\":\"offset\",\"of\":\"flock.l_pid\",\"value\":%zu}\n", offsetof(struct flock, l_pid));
  printf("{\"fact\":\"field size\",\"of\":\"flock.l_pid\",\"value\":%zu}\n", sizeof(((struct flock *)0)->l_pid));
#endif
#ifndef SKIP_flock_l_type
  printf("{\"fact\":\"offset\",\"of\":\"flock.l_type\",\"value\":%zu}\n", offsetof(struct flock, l_type));
  printf("{\"fact\":\"field size\",\"of\":\"flock.l_type\",\"value\":%zu}\n", sizeof(((struct flock *)0)->l_type));
#endif
#ifndef SKIP_flock_l_whence
  printf("{\"fact\":\"offset\",\"of\":\"flock.l_whence\",\"value\":%zu}\n", offsetof(struct flock, l_whence));
  printf("{\"fact\":\"field size\",\"of\":\"flock.l_whence\",\"value\":%zu}\n", sizeof(((struct flock *)0)->l_whence));
#endif
#endif
#if PART == 10
  printf("{\"fact\":\"size\",\"of\":\"fsid_t\",\"value\":%zu}\n", sizeof(fsid_t));
  printf("{\"fact\":\"align\",\"of\":\"fsid_t\",\"value\":%zu}\n", _Alignof(fsid_t));
#endif
#if PART == 11
  printf("{\"fact\":\"size\",\"of\":\"fstore_t\",\"value\":%zu}\n", sizeof(fstore_t));
  printf("{\"fact\":\"align\",\"of\":\"fstore_t\",\"value\":%zu}\n", _Alignof(fstore_t));
#ifndef SKIP_fstore_t_fst_flags
  printf("{\"fact\":\"offset\",\"of\":\"fstore_t.fst_flags\",\"value\":%zu}\n", offsetof(fstore_t, fst_flags));
  printf("{\"fact\":\"field size\",\"of\":\"fstore_t.fst_flags\",\"value\":%zu}\n", sizeof(((fstore_t *)0)->fst_flags));
#endif
#ifndef SKIP_fstore_t_fst_posmode
  printf("{\"fact\":\"offset\",\"of\":\"fstore_t.fst_posmode\",\"value\":%zu}\n", offsetof(fstore_t, fst_posmode));
  printf("{\"fact\":\"field size\",\"of\":\"fstore_t.fst_posmode\",\"value\":%zu}\n", sizeof(((fstore_t *)0)->fst_posmode));
#endif
#ifndef SKIP_fstore_t_fst_offset
  printf("{\"fact\":\"offset\",\"of\":\"fstore_t.fst_offset\",\"value\":%zu}\n", offsetof(fstore_t, fst_offset));
  printf("{\"fact\":\"field size\",\"of\":\"fstore_t.fst_offset\",\"value\":%zu}\n", sizeof(((fstore_t *)0)->fst_offset));
#endif
#ifndef SKIP_fstore_t_fst_length
  printf("{\"fact\":\"offset\",\"of\":\"fstore_t.fst_length\",\"value\":%zu}\n", offsetof(fstore_t, fst_length));
  printf("{\"fact\":\"field size\",\"of\":\"fstore_t.fst_length\",\"value\":%zu}\n", sizeof(((fstore_t *)0)->fst_length));
#endif
#ifndef SKIP_fstore_t_fst_bytesalloc
  printf("{\"fact\":\"offset\",\"of\":\"fstore_t.fst_bytesalloc\",\"value\":%zu}\n", offsetof(fstore_t, fst_bytesalloc));
  printf("{\"fact\":\"field size\",\"of\":\"fstore_t.fst_bytesalloc\",\"value\":%zu}\n", sizeof(((fstore_t *)0)->fst_bytesalloc));
#endif
#endif
#if PART == 12
  printf("{\"fact\":\"size\",\"of\":\"gid_t\",\"value\":%zu}\n", sizeof(gid_t));
  printf("{\"fact\":\"align\",\"of\":\"gid_t\",\"value\":%zu}\n", _Alignof(gid_t));
#endif
#if PART == 13
  printf("{\"fact\":\"size\",\"of\":\"host_flavor_t\",\"value\":%zu}\n", sizeof(host_flavor_t));
  printf("{\"fact\":\"align\",\"of\":\"host_flavor_t\",\"value\":%zu}\n", _Alignof(host_flavor_t));
#endif
#if PART == 14
  printf("{\"fact\":\"size\",\"of\":\"host_info64_t\",\"value\":%zu}\n", sizeof(host_info64_t));
  printf("{\"fact\":\"align\",\"of\":\"host_info64_t\",\"value\":%zu}\n", _Alignof(host_info64_t));
#endif
#if PART == 15
  printf("{\"fact\":\"size\",\"of\":\"host_t\",\"value\":%zu}\n", sizeof(host_t));
  printf("{\"fact\":\"align\",\"of\":\"host_t\",\"value\":%zu}\n", _Alignof(host_t));
#endif
#if PART == 16
  printf("{\"fact\":\"size\",\"of\":\"ino_t\",\"value\":%zu}\n", sizeof(ino_t));
  printf("{\"fact\":\"align\",\"of\":\"ino_t\",\"value\":%zu}\n", _Alignof(ino_t));
#endif
#if PART == 17
  printf("{\"fact\":\"size\",\"of\":\"integer_t\",\"value\":%zu}\n", sizeof(integer_t));
  printf("{\"fact\":\"align\",\"of\":\"integer_t\",\"value\":%zu}\n", _Alignof(integer_t));
#endif
#if PART == 18
  printf("{\"fact\":\"size\",\"of\":\"intptr_t\",\"value\":%zu}\n", sizeof(intptr_t));
  printf("{\"fact\":\"align\",\"of\":\"intptr_t\",\"value\":%zu}\n", _Alignof(intptr_t));
#endif
#if PART == 19
  printf("{\"fact\":\"size\",\"of\":\"iovec\",\"value\":%zu}\n", sizeof(struct iovec));
  printf("{\"fact\":\"align\",\"of\":\"iovec\",\"value\":%zu}\n", _Alignof(struct iovec));
#ifndef SKIP_iovec_iov_base
  printf("{\"fact\":\"offset\",\"of\":\"iovec.iov_base\",\"value\":%zu}\n", offsetof(struct iovec, iov_base));
  printf("{\"fact\":\"field size\",\"of\":\"iovec.iov_base\",\"value\":%zu}\n", sizeof(((struct iovec *)0)->iov_base));
#endif
#ifndef SKIP_iovec_iov_len
  printf("{\"fact\":\"offset\",\"of\":\"iovec.iov_len\",\"value\":%zu}\n", offsetof(struct iovec, iov_len));
  printf("{\"fact\":\"field size\",\"of\":\"iovec.iov_len\",\"value\":%zu}\n", sizeof(((struct iovec *)0)->iov_len));
#endif
#endif
#if PART == 20
  printf("{\"fact\":\"size\",\"of\":\"kern_return_t\",\"value\":%zu}\n", sizeof(kern_return_t));
  printf("{\"fact\":\"align\",\"of\":\"kern_return_t\",\"value\":%zu}\n", _Alignof(kern_return_t));
#endif
#if PART == 21
  printf("{\"fact\":\"size\",\"of\":\"kevent\",\"value\":%zu}\n", sizeof(struct kevent));
  printf("{\"fact\":\"align\",\"of\":\"kevent\",\"value\":%zu}\n", _Alignof(struct kevent));
#ifndef SKIP_kevent_ident
  printf("{\"fact\":\"offset\",\"of\":\"kevent.ident\",\"value\":%zu}\n", offsetof(struct kevent, ident));
  printf("{\"fact\":\"field size\",\"of\":\"kevent.ident\",\"value\":%zu}\n", sizeof(((struct kevent *)0)->ident));
#endif
#ifndef SKIP_kevent_filter
  printf("{\"fact\":\"offset\",\"of\":\"kevent.filter\",\"value\":%zu}\n", offsetof(struct kevent, filter));
  printf("{\"fact\":\"field size\",\"of\":\"kevent.filter\",\"value\":%zu}\n", sizeof(((struct kevent *)0)->filter));
#endif
#ifndef SKIP_kevent_flags
  printf("{\"fact\":\"offset\",\"of\":\"kevent.flags\",\"value\":%zu}\n", offsetof(struct kevent, flags));
  printf("{\"fact\":\"field size\",\"of\":\"kevent.flags\",\"value\":%zu}\n", sizeof(((struct kevent *)0)->flags));
#endif
#ifndef SKIP_kevent_fflags
  printf("{\"fact\":\"offset\",\"of\":\"kevent.fflags\",\"value\":%zu}\n", offsetof(struct kevent, fflags));
  printf("{\"fact\":\"field size\",\"of\":\"kevent.fflags\",\"value\":%zu}\n", sizeof(((struct kevent *)0)->fflags));
#endif
#ifndef SKIP_kevent_data
  printf("{\"fact\":\"offset\",\"of\":\"kevent.data\",\"value\":%zu}\n", offsetof(struct kevent, data));
  printf("{\"fact\":\"field size\",\"of\":\"kevent.data\",\"value\":%zu}\n", sizeof(((struct kevent *)0)->data));
#endif
#ifndef SKIP_kevent_udata
  printf("{\"fact\":\"offset\",\"of\":\"kevent.udata\",\"value\":%zu}\n", offsetof(struct kevent, udata));
  printf("{\"fact\":\"field size\",\"of\":\"kevent.udata\",\"value\":%zu}\n", sizeof(((struct kevent *)0)->udata));
#endif
#endif
#if PART == 22
  printf("{\"fact\":\"size\",\"of\":\"kevent64_s\",\"value\":%zu}\n", sizeof(struct kevent64_s));
  printf("{\"fact\":\"align\",\"of\":\"kevent64_s\",\"value\":%zu}\n", _Alignof(struct kevent64_s));
#ifndef SKIP_kevent64_s_ident
  printf("{\"fact\":\"offset\",\"of\":\"kevent64_s.ident\",\"value\":%zu}\n", offsetof(struct kevent64_s, ident));
  printf("{\"fact\":\"field size\",\"of\":\"kevent64_s.ident\",\"value\":%zu}\n", sizeof(((struct kevent64_s *)0)->ident));
#endif
#ifndef SKIP_kevent64_s_filter
  printf("{\"fact\":\"offset\",\"of\":\"kevent64_s.filter\",\"value\":%zu}\n", offsetof(struct kevent64_s, filter));
  printf("{\"fact\":\"field size\",\"of\":\"kevent64_s.filter\",\"value\":%zu}\n", sizeof(((struct kevent64_s *)0)->filter));
#endif
#ifndef SKIP_kevent64_s_flags
  printf("{\"fact\":\"offset\",\"of\":\"kevent64_s.flags\",\"value\":%zu}\n", offsetof(struct kevent64_s, flags));
  printf("{\"fact\":\"field size\",\"of\":\"kevent64_s.flags\",\"value\":%zu}\n", sizeof(((struct kevent64_s *)0)->flags));
#endif
#ifndef SKIP_kevent64_s_fflags
  printf("{\"fact\":\"offset\",\"of\":\"kevent64_s.fflags\",\"value\":%zu}\n", offsetof(struct kevent64_s, fflags));
  printf("{\"fact\":\"field size\",\"of\":\"kevent64_s.fflags\",\"value\":%zu}\n", sizeof(((struct kevent64_s *)0)->fflags));
#endif
#ifndef SKIP_kevent64_s_data
  printf("{\"fact\":\"offset\",\"of\":\"kevent64_s.data\",\"value\":%zu}\n", offsetof(struct kevent64_s, data));
  printf("{\"fact\":\"field size\",\"of\":\"kevent64_s.data\",\"value\":%zu}\n", sizeof(((struct kevent64_s *)0)->data));
#endif
#ifndef SKIP_kevent64_s_udata
  printf("{\"fact\":\"offset\",\"of\":\"kevent64_s.udata\",\"value\":%zu}\n", offsetof(struct kevent64_s, udata));
  printf("{\"fact\":\"field size\",\"of\":\"kevent64_s.udata\",\"value\":%zu}\n", sizeof(((struct kevent64_s *)0)->udata));
#endif
#ifndef SKIP_kevent64_s_ext
  printf("{\"fact\":\"offset\",\"of\":\"kevent64_s.ext\",\"value\":%zu}\n", offsetof(struct kevent64_s, ext));
  printf("{\"fact\":\"field size\",\"of\":\"kevent64_s.ext\",\"value\":%zu}\n", sizeof(((struct kevent64_s *)0)->ext));
#endif
#endif
#if PART == 23
  printf("{\"fact\":\"size\",\"of\":\"mach_msg_type_number_t\",\"value\":%zu}\n", sizeof(mach_msg_type_number_t));
  printf("{\"fact\":\"align\",\"of\":\"mach_msg_type_number_t\",\"value\":%zu}\n", _Alignof(mach_msg_type_number_t));
#endif
#if PART == 24
  printf("{\"fact\":\"size\",\"of\":\"mach_port_t\",\"value\":%zu}\n", sizeof(mach_port_t));
  printf("{\"fact\":\"align\",\"of\":\"mach_port_t\",\"value\":%zu}\n", _Alignof(mach_port_t));
#endif
#if PART == 25
  printf("{\"fact\":\"size\",\"of\":\"mach_timebase_info\",\"value\":%zu}\n", sizeof(struct mach_timebase_info));
  printf("{\"fact\":\"align\",\"of\":\"mach_timebase_info\",\"value\":%zu}\n", _Alignof(struct mach_timebase_info));
#ifndef SKIP_mach_timebase_info_numer
  printf("{\"fact\":\"offset\",\"of\":\"mach_timebase_info.numer\",\"value\":%zu}\n", offsetof(struct mach_timebase_info, numer));
  printf("{\"fact\":\"field size\",\"of\":\"mach_timebase_info.numer\",\"value\":%zu}\n", sizeof(((struct mach_timebase_info *)0)->numer));
#endif
#ifndef SKIP_mach_timebase_info_denom
  printf("{\"fact\":\"offset\",\"of\":\"mach_timebase_info.denom\",\"value\":%zu}\n", offsetof(struct mach_timebase_info, denom));
  printf("{\"fact\":\"field size\",\"of\":\"mach_timebase_info.denom\",\"value\":%zu}\n", sizeof(((struct mach_timebase_info *)0)->denom));
#endif
#endif
#if PART == 26
  printf("{\"fact\":\"size\",\"of\":\"mach_timebase_info_data_t\",\"value\":%zu}\n", sizeof(mach_timebase_info_data_t));
  printf("{\"fact\":\"align\",\"of\":\"mach_timebase_info_data_t\",\"value\":%zu}\n", _Alignof(mach_timebase_info_data_t));
#endif
#if PART == 27
  printf("{\"fact\":\"size\",\"of\":\"mode_t\",\"value\":%zu}\n", sizeof(mode_t));
  printf("{\"fact\":\"align\",\"of\":\"mode_t\",\"value\":%zu}\n", _Alignof(mode_t));
#endif
#if PART == 28
  printf("{\"fact\":\"size\",\"of\":\"natural_t\",\"value\":%zu}\n", sizeof(natural_t));
  printf("{\"fact\":\"align\",\"of\":\"natural_t\",\"value\":%zu}\n", _Alignof(natural_t));
#endif
#if PART == 29
  printf("{\"fact\":\"size\",\"of\":\"nfds_t\",\"value\":%zu}\n", sizeof(nfds_t));
  printf("{\"fact\":\"align\",\"of\":\"nfds_t\",\"value\":%zu}\n", _Alignof(nfds_t));
#endif
#if PART == 30
  printf("{\"fact\":\"size\",\"of\":\"nlink_t\",\"value\":%zu}\n", sizeof(nlink_t));
  printf("{\"fact\":\"align\",\"of\":\"nlink_t\",\"value\":%zu}\n", _Alignof(nlink_t));
#endif
#if PART == 31
  printf("{\"fact\":\"size\",\"of\":\"off_t\",\"value\":%zu}\n", sizeof(off_t));
  printf("{\"fact\":\"align\",\"of\":\"off_t\",\"value\":%zu}\n", _Alignof(off_t));
#endif
#if PART == 32
  printf("{\"fact\":\"size\",\"of\":\"os_unfair_lock\",\"value\":%zu}\n", sizeof(os_unfair_lock));
  printf("{\"fact\":\"align\",\"of\":\"os_unfair_lock\",\"value\":%zu}\n", _Alignof(os_unfair_lock));
#endif
#if PART == 33
  printf("{\"fact\":\"size\",\"of\":\"os_unfair_lock_s\",\"value\":%zu}\n", sizeof(struct os_unfair_lock_s));
  printf("{\"fact\":\"align\",\"of\":\"os_unfair_lock_s\",\"value\":%zu}\n", _Alignof(struct os_unfair_lock_s));
#endif
#if PART == 34
  printf("{\"fact\":\"size\",\"of\":\"os_unfair_lock_t\",\"value\":%zu}\n", sizeof(os_unfair_lock_t));
  printf("{\"fact\":\"align\",\"of\":\"os_unfair_lock_t\",\"value\":%zu}\n", _Alignof(os_unfair_lock_t));
#endif
#if PART == 35
  printf("{\"fact\":\"size\",\"of\":\"pid_t\",\"value\":%zu}\n", sizeof(pid_t));
  printf("{\"fact\":\"align\",\"of\":\"pid_t\",\"value\":%zu}\n", _Alignof(pid_t));
#endif
#if PART == 36
  printf("{\"fact\":\"size\",\"of\":\"pollfd\",\"value\":%zu}\n", sizeof(struct pollfd));
  printf("{\"fact\":\"align\",\"of\":\"pollfd\",\"value\":%zu}\n", _Alignof(struct pollfd));
#ifndef SKIP_pollfd_fd
  printf("{\"fact\":\"offset\",\"of\":\"pollfd.fd\",\"value\":%zu}\n", offsetof(struct pollfd, fd));
  printf("{\"fact\":\"field size\",\"of\":\"pollfd.fd\",\"value\":%zu}\n", sizeof(((struct pollfd *)0)->fd));
#endif
#ifndef SKIP_pollfd_events
  printf("{\"fact\":\"offset\",\"of\":\"pollfd.events\",\"value\":%zu}\n", offsetof(struct pollfd, events));
  printf("{\"fact\":\"field size\",\"of\":\"pollfd.events\",\"value\":%zu}\n", sizeof(((struct pollfd *)0)->events));
#endif
#ifndef SKIP_pollfd_revents
  printf("{\"fact\":\"offset\",\"of\":\"pollfd.revents\",\"value\":%zu}\n", offsetof(struct pollfd, revents));
  printf("{\"fact\":\"field size\",\"of\":\"pollfd.revents\",\"value\":%zu}\n", sizeof(((struct pollfd *)0)->revents));
#endif
#endif
#if PART == 37
  printf("{\"fact\":\"size\",\"of\":\"posix_spawn_file_actions_t\",\"value\":%zu}\n", sizeof(posix_spawn_file_actions_t));
  printf("{\"fact\":\"align\",\"of\":\"posix_spawn_file_actions_t\",\"value\":%zu}\n", _Alignof(posix_spawn_file_actions_t));
#endif
#if PART == 38
  printf("{\"fact\":\"size\",\"of\":\"posix_spawnattr_t\",\"value\":%zu}\n", sizeof(posix_spawnattr_t));
  printf("{\"fact\":\"align\",\"of\":\"posix_spawnattr_t\",\"value\":%zu}\n", _Alignof(posix_spawnattr_t));
#endif
#if PART == 39
  printf("{\"fact\":\"size\",\"of\":\"processor_cpu_load_info\",\"value\":%zu}\n", sizeof(struct processor_cpu_load_info));
  printf("{\"fact\":\"align\",\"of\":\"processor_cpu_load_info\",\"value\":%zu}\n", _Alignof(struct processor_cpu_load_info));
#ifndef SKIP_processor_cpu_load_info_cpu_ticks
  printf("{\"fact\":\"offset\",\"of\":\"processor_cpu_load_info.cpu_ticks\",\"value\":%zu}\n", offsetof(struct processor_cpu_load_info, cpu_ticks));
  printf("{\"fact\":\"field size\",\"of\":\"processor_cpu_load_info.cpu_ticks\",\"value\":%zu}\n", sizeof(((struct processor_cpu_load_info *)0)->cpu_ticks));
#endif
#endif
#if PART == 40
  printf("{\"fact\":\"size\",\"of\":\"processor_cpu_load_info_data_t\",\"value\":%zu}\n", sizeof(processor_cpu_load_info_data_t));
  printf("{\"fact\":\"align\",\"of\":\"processor_cpu_load_info_data_t\",\"value\":%zu}\n", _Alignof(processor_cpu_load_info_data_t));
#endif
#if PART == 41
  printf("{\"fact\":\"size\",\"of\":\"processor_flavor_t\",\"value\":%zu}\n", sizeof(processor_flavor_t));
  printf("{\"fact\":\"align\",\"of\":\"processor_flavor_t\",\"value\":%zu}\n", _Alignof(processor_flavor_t));
#endif
#if PART == 42
  printf("{\"fact\":\"size\",\"of\":\"processor_info_array_t\",\"value\":%zu}\n", sizeof(processor_info_array_t));
  printf("{\"fact\":\"align\",\"of\":\"processor_info_array_t\",\"value\":%zu}\n", _Alignof(processor_info_array_t));
#endif
#if PART == 43
  printf("{\"fact\":\"size\",\"of\":\"pthread_t\",\"value\":%zu}\n", sizeof(pthread_t));
  printf("{\"fact\":\"align\",\"of\":\"pthread_t\",\"value\":%zu}\n", _Alignof(pthread_t));
#endif
#if PART == 44
  printf("{\"fact\":\"size\",\"of\":\"sa_family_t\",\"value\":%zu}\n", sizeof(sa_family_t));
  printf("{\"fact\":\"align\",\"of\":\"sa_family_t\",\"value\":%zu}\n", _Alignof(sa_family_t));
#endif
#if PART == 45
  printf("{\"fact\":\"size\",\"of\":\"sf_hdtr\",\"value\":%zu}\n", sizeof(struct sf_hdtr));
  printf("{\"fact\":\"align\",\"of\":\"sf_hdtr\",\"value\":%zu}\n", _Alignof(struct sf_hdtr));
#ifndef SKIP_sf_hdtr_headers
  printf("{\"fact\":\"offset\",\"of\":\"sf_hdtr.headers\",\"value\":%zu}\n", offsetof(struct sf_hdtr, headers));
  printf("{\"fact\":\"field size\",\"of\":\"sf_hdtr.headers\",\"value\":%zu}\n", sizeof(((struct sf_hdtr *)0)->headers));
#endif
#ifndef SKIP_sf_hdtr_hdr_cnt
  printf("{\"fact\":\"offset\",\"of\":\"sf_hdtr.hdr_cnt\",\"value\":%zu}\n", offsetof(struct sf_hdtr, hdr_cnt));
  printf("{\"fact\":\"field size\",\"of\":\"sf_hdtr.hdr_cnt\",\"value\":%zu}\n", sizeof(((struct sf_hdtr *)0)->hdr_cnt));
#endif
#ifndef SKIP_sf_hdtr_trailers
  printf("{\"fact\":\"offset\",\"of\":\"sf_hdtr.trailers\",\"value\":%zu}\n", offsetof(struct sf_hdtr, trailers));
  printf("{\"fact\":\"field size\",\"of\":\"sf_hdtr.trailers\",\"value\":%zu}\n", sizeof(((struct sf_hdtr *)0)->trailers));
#endif
#ifndef SKIP_sf_hdtr_trl_cnt
  printf("{\"fact\":\"offset\",\"of\":\"sf_hdtr.trl_cnt\",\"value\":%zu}\n", offsetof(struct sf_hdtr, trl_cnt));
  printf("{\"fact\":\"field size\",\"of\":\"sf_hdtr.trl_cnt\",\"value\":%zu}\n", sizeof(((struct sf_hdtr *)0)->trl_cnt));
#endif
#endif
#if PART == 46
  printf("{\"fact\":\"size\",\"of\":\"sigset_t\",\"value\":%zu}\n", sizeof(sigset_t));
  printf("{\"fact\":\"align\",\"of\":\"sigset_t\",\"value\":%zu}\n", _Alignof(sigset_t));
#endif
#if PART == 47
  printf("{\"fact\":\"size\",\"of\":\"size_t\",\"value\":%zu}\n", sizeof(size_t));
  printf("{\"fact\":\"align\",\"of\":\"size_t\",\"value\":%zu}\n", _Alignof(size_t));
#endif
#if PART == 48
  printf("{\"fact\":\"size\",\"of\":\"sockaddr\",\"value\":%zu}\n", sizeof(struct sockaddr));
  printf("{\"fact\":\"align\",\"of\":\"sockaddr\",\"value\":%zu}\n", _Alignof(struct sockaddr));
#ifndef SKIP_sockaddr_sa_len
  printf("{\"fact\":\"offset\",\"of\":\"sockaddr.sa_len\",\"value\":%zu}\n", offsetof(struct sockaddr, sa_len));
  printf("{\"fact\":\"field size\",\"of\":\"sockaddr.sa_len\",\"value\":%zu}\n", sizeof(((struct sockaddr *)0)->sa_len));
#endif
#ifndef SKIP_sockaddr_sa_family
  printf("{\"fact\":\"offset\",\"of\":\"sockaddr.sa_family\",\"value\":%zu}\n", offsetof(struct sockaddr, sa_family));
  printf("{\"fact\":\"field size\",\"of\":\"sockaddr.sa_family\",\"value\":%zu}\n", sizeof(((struct sockaddr *)0)->sa_family));
#endif
#ifndef SKIP_sockaddr_sa_data
  printf("{\"fact\":\"offset\",\"of\":\"sockaddr.sa_data\",\"value\":%zu}\n", offsetof(struct sockaddr, sa_data));
  printf("{\"fact\":\"field size\",\"of\":\"sockaddr.sa_data\",\"value\":%zu}\n", sizeof(((struct sockaddr *)0)->sa_data));
#endif
#endif
#if PART == 49
  printf("{\"fact\":\"size\",\"of\":\"sockaddr_dl\",\"value\":%zu}\n", sizeof(struct sockaddr_dl));
  printf("{\"fact\":\"align\",\"of\":\"sockaddr_dl\",\"value\":%zu}\n", _Alignof(struct sockaddr_dl));
#ifndef SKIP_sockaddr_dl_sdl_len
  printf("{\"fact\":\"offset\",\"of\":\"sockaddr_dl.sdl_len\",\"value\":%zu}\n", offsetof(struct sockaddr_dl, sdl_len));
  printf("{\"fact\":\"field size\",\"of\":\"sockaddr_dl.sdl_len\",\"value\":%zu}\n", sizeof(((struct sockaddr_dl *)0)->sdl_len));
#endif
#ifndef SKIP_sockaddr_dl_sdl_family
  printf("{\"fact\":\"offset\",\"of\":\"sockaddr_dl.sdl_family\",\"value\":%zu}\n", offsetof(struct sockaddr_dl, sdl_family));
  printf("{\"fact\":\"field size\",\"of\":\"sockaddr_dl.sdl_family\",\"value\":%zu}\n", sizeof(((struct sockaddr_dl *)0)->sdl_family));
#endif
#ifndef SKIP_sockaddr_dl_sdl_index
  printf("{\"fact\":\"offset\",\"of\":\"sockaddr_dl.sdl_index\",\"value\":%zu}\n", offsetof(struct sockaddr_dl, sdl_index));
  printf("{\"fact\":\"field size\",\"of\":\"sockaddr_dl.sdl_index\",\"value\":%zu}\n", sizeof(((struct sockaddr_dl *)0)->sdl_index));
#endif
#ifndef SKIP_sockaddr_dl_sdl_type
  printf("{\"fact\":\"offset\",\"of\":\"sockaddr_dl.sdl_type\",\"value\":%zu}\n", offsetof(struct sockaddr_dl, sdl_type));
  printf("{\"fact\":\"field size\",\"of\":\"sockaddr_dl.sdl_type\",\"value\":%zu}\n", sizeof(((struct sockaddr_dl *)0)->sdl_type));
#endif
#ifndef SKIP_sockaddr_dl_sdl_nlen
  printf("{\"fact\":\"offset\",\"of\":\"sockaddr_dl.sdl_nlen\",\"value\":%zu}\n", offsetof(struct sockaddr_dl, sdl_nlen));
  printf("{\"fact\":\"field size\",\"of\":\"sockaddr_dl.sdl_nlen\",\"value\":%zu}\n", sizeof(((struct sockaddr_dl *)0)->sdl_nlen));
#endif
#ifndef SKIP_sockaddr_dl_sdl_alen
  printf("{\"fact\":\"offset\",\"of\":\"sockaddr_dl.sdl_alen\",\"value\":%zu}\n", offsetof(struct sockaddr_dl, sdl_alen));
  printf("{\"fact\":\"field size\",\"of\":\"sockaddr_dl.sdl_alen\",\"value\":%zu}\n", sizeof(((struct sockaddr_dl *)0)->sdl_alen));
#endif
#ifndef SKIP_sockaddr_dl_sdl_slen
  printf("{\"fact\":\"offset\",\"of\":\"sockaddr_dl.sdl_slen\",\"value\":%zu}\n", offsetof(struct sockaddr_dl, sdl_slen));
  printf("{\"fact\":\"field size\",\"of\":\"sockaddr_dl.sdl_slen\",\"value\":%zu}\n", sizeof(((struct sockaddr_dl *)0)->sdl_slen));
#endif
#ifndef SKIP_sockaddr_dl_sdl_data
  printf("{\"fact\":\"offset\",\"of\":\"sockaddr_dl.sdl_data\",\"value\":%zu}\n", offsetof(struct sockaddr_dl, sdl_data));
  printf("{\"fact\":\"field size\",\"of\":\"sockaddr_dl.sdl_data\",\"value\":%zu}\n", sizeof(((struct sockaddr_dl *)0)->sdl_data));
#endif
#endif
#if PART == 50
  printf("{\"fact\":\"size\",\"of\":\"socklen_t\",\"value\":%zu}\n", sizeof(socklen_t));
  printf("{\"fact\":\"align\",\"of\":\"socklen_t\",\"value\":%zu}\n", _Alignof(socklen_t));
#endif
#if PART == 51
  printf("{\"fact\":\"size\",\"of\":\"ssize_t\",\"value\":%zu}\n", sizeof(ssize_t));
  printf("{\"fact\":\"align\",\"of\":\"ssize_t\",\"value\":%zu}\n", _Alignof(ssize_t));
#endif
#if PART == 52
  printf("{\"fact\":\"size\",\"of\":\"stat\",\"value\":%zu}\n", sizeof(struct stat));
  printf("{\"fact\":\"align\",\"of\":\"stat\",\"value\":%zu}\n", _Alignof(struct stat));
#ifndef SKIP_stat_st_dev
  printf("{\"fact\":\"offset\",\"of\":\"stat.st_dev\",\"value\":%zu}\n", offsetof(struct stat, st_dev));
  printf("{\"fact\":\"field size\",\"of\":\"stat.st_dev\",\"value\":%zu}\n", sizeof(((struct stat *)0)->st_dev));
#endif
#ifndef SKIP_stat_st_mode
  printf("{\"fact\":\"offset\",\"of\":\"stat.st_mode\",\"value\":%zu}\n", offsetof(struct stat, st_mode));
  printf("{\"fact\":\"field size\",\"of\":\"stat.st_mode\",\"value\":%zu}\n", sizeof(((struct stat *)0)->st_mode));
#endif
#ifndef SKIP_stat_st_nlink
  printf("{\"fact\":\"offset\",\"of\":\"stat.st_nlink\",\"value\":%zu}\n", offsetof(struct stat, st_nlink));
  printf("{\"fact\":\"field size\",\"of\":\"stat.st_nlink\",\"value\":%zu}\n", sizeof(((struct stat *)0)->st_nlink));
#endif
#ifndef SKIP_stat_st_ino
  printf("{\"fact\":\"offset\",\"of\":\"stat.st_ino\",\"value\":%zu}\n", offsetof(struct stat, st_ino));
  printf("{\"fact\":\"field size\",\"of\":\"stat.st_ino\",\"value\":%zu}\n", sizeof(((struct stat *)0)->st_ino));
#endif
#ifndef SKIP_stat_st_uid
  printf("{\"fact\":\"offset\",\"of\":\"stat.st_uid\",\"value\":%zu}\n", offsetof(struct stat, st_uid));
  printf("{\"fact\":\"field size\",\"of\":\"stat.st_uid\",\"value\":%zu}\n", sizeof(((struct stat *)0)->st_uid));
#endif
#ifndef SKIP_stat_st_gid
  printf("{\"fact\":\"offset\",\"of\":\"stat.st_gid\",\"value\":%zu}\n", offsetof(struct stat, st_gid));
  printf("{\"fact\":\"field size\",\"of\":\"stat.st_gid\",\"value\":%zu}\n", sizeof(((struct stat *)0)->st_gid));
#endif
#ifndef SKIP_stat_st_rdev
  printf("{\"fact\":\"offset\",\"of\":\"stat.st_rdev\",\"value\":%zu}\n", offsetof(struct stat, st_rdev));
  printf("{\"fact\":\"field size\",\"of\":\"stat.st_rdev\",\"value\":%zu}\n", sizeof(((struct stat *)0)->st_rdev));
#endif
#ifndef SKIP_stat_st_atimespec
  printf("{\"fact\":\"offset\",\"of\":\"stat.st_atime\",\"value\":%zu}\n", offsetof(struct stat, st_atimespec.tv_sec));
  printf("{\"fact\":\"field size\",\"of\":\"stat.st_atime\",\"value\":%zu}\n", sizeof(((struct stat *)0)->st_atimespec.tv_sec));
#endif
#ifndef SKIP_stat_st_atimespec
  printf("{\"fact\":\"offset\",\"of\":\"stat.st_atime_nsec\",\"value\":%zu}\n", offsetof(struct stat, st_atimespec.tv_nsec));
  printf("{\"fact\":\"field size\",\"of\":\"stat.st_atime_nsec\",\"value\":%zu}\n", sizeof(((struct stat *)0)->st_atimespec.tv_nsec));
#endif
#ifndef SKIP_stat_st_mtimespec
  printf("{\"fact\":\"offset\",\"of\":\"stat.st_mtime\",\"value\":%zu}\n", offsetof(struct stat, st_mtimespec.tv_sec));
  printf("{\"fact\":\"field size\",\"of\":\"stat.st_mtime\",\"value\":%zu}\n", sizeof(((struct stat *)0)->st_mtimespec.tv_sec));
#endif
#ifndef SKIP_stat_st_mtimespec
  printf("{\"fact\":\"offset\",\"of\":\"stat.st_mtime_nsec\",\"value\":%zu}\n", offsetof(struct stat, st_mtimespec.tv_nsec));
  printf("{\"fact\":\"field size\",\"of\":\"stat.st_mtime_nsec\",\"value\":%zu}\n", sizeof(((struct stat *)0)->st_mtimespec.tv_nsec));
#endif
#ifndef SKIP_stat_st_ctimespec
  printf("{\"fact\":\"offset\",\"of\":\"stat.st_ctime\",\"value\":%zu}\n", offsetof(struct stat, st_ctimespec.tv_sec));
  printf("{\"fact\":\"field size\",\"of\":\"stat.st_ctime\",\"value\":%zu}\n", sizeof(((struct stat *)0)->st_ctimespec.tv_sec));
#endif
#ifndef SKIP_stat_st_ctimespec
  printf("{\"fact\":\"offset\",\"of\":\"stat.st_ctime_nsec\",\"value\":%zu}\n", offsetof(struct stat, st_ctimespec.tv_nsec));
  printf("{\"fact\":\"field size\",\"of\":\"stat.st_ctime_nsec\",\"value\":%zu}\n", sizeof(((struct stat *)0)->st_ctimespec.tv_nsec));
#endif
#ifndef SKIP_stat_st_birthtimespec
  printf("{\"fact\":\"offset\",\"of\":\"stat.st_birthtime\",\"value\":%zu}\n", offsetof(struct stat, st_birthtimespec.tv_sec));
  printf("{\"fact\":\"field size\",\"of\":\"stat.st_birthtime\",\"value\":%zu}\n", sizeof(((struct stat *)0)->st_birthtimespec.tv_sec));
#endif
#ifndef SKIP_stat_st_birthtimespec
  printf("{\"fact\":\"offset\",\"of\":\"stat.st_birthtime_nsec\",\"value\":%zu}\n", offsetof(struct stat, st_birthtimespec.tv_nsec));
  printf("{\"fact\":\"field size\",\"of\":\"stat.st_birthtime_nsec\",\"value\":%zu}\n", sizeof(((struct stat *)0)->st_birthtimespec.tv_nsec));
#endif
#ifndef SKIP_stat_st_size
  printf("{\"fact\":\"offset\",\"of\":\"stat.st_size\",\"value\":%zu}\n", offsetof(struct stat, st_size));
  printf("{\"fact\":\"field size\",\"of\":\"stat.st_size\",\"value\":%zu}\n", sizeof(((struct stat *)0)->st_size));
#endif
#ifndef SKIP_stat_st_blocks
  printf("{\"fact\":\"offset\",\"of\":\"stat.st_blocks\",\"value\":%zu}\n", offsetof(struct stat, st_blocks));
  printf("{\"fact\":\"field size\",\"of\":\"stat.st_blocks\",\"value\":%zu}\n", sizeof(((struct stat *)0)->st_blocks));
#endif
#ifndef SKIP_stat_st_blksize
  printf("{\"fact\":\"offset\",\"of\":\"stat.st_blksize\",\"value\":%zu}\n", offsetof(struct stat, st_blksize));
  printf("{\"fact\":\"field size\",\"of\":\"stat.st_blksize\",\"value\":%zu}\n", sizeof(((struct stat *)0)->st_blksize));
#endif
#ifndef SKIP_stat_st_flags
  printf("{\"fact\":\"offset\",\"of\":\"stat.st_flags\",\"value\":%zu}\n", offsetof(struct stat, st_flags));
  printf("{\"fact\":\"field size\",\"of\":\"stat.st_flags\",\"value\":%zu}\n", sizeof(((struct stat *)0)->st_flags));
#endif
#ifndef SKIP_stat_st_gen
  printf("{\"fact\":\"offset\",\"of\":\"stat.st_gen\",\"value\":%zu}\n", offsetof(struct stat, st_gen));
  printf("{\"fact\":\"field size\",\"of\":\"stat.st_gen\",\"value\":%zu}\n", sizeof(((struct stat *)0)->st_gen));
#endif
#ifndef SKIP_stat_st_lspare
  printf("{\"fact\":\"offset\",\"of\":\"stat.st_lspare\",\"value\":%zu}\n", offsetof(struct stat, st_lspare));
  printf("{\"fact\":\"field size\",\"of\":\"stat.st_lspare\",\"value\":%zu}\n", sizeof(((struct stat *)0)->st_lspare));
#endif
#ifndef SKIP_stat_st_qspare
  printf("{\"fact\":\"offset\",\"of\":\"stat.st_qspare\",\"value\":%zu}\n", offsetof(struct stat, st_qspare));
  printf("{\"fact\":\"field size\",\"of\":\"stat.st_qspare\",\"value\":%zu}\n", sizeof(((struct stat *)0)->st_qspare));
#endif
#endif
#if PART == 53
  printf("{\"fact\":\"size\",\"of\":\"statfs\",\"value\":%zu}\n", sizeof(struct statfs));
  printf("{\"fact\":\"align\",\"of\":\"statfs\",\"value\":%zu}\n", _Alignof(struct statfs));
#ifndef SKIP_statfs_f_bsize
  printf("{\"fact\":\"offset\",\"of\":\"statfs.f_bsize\",\"value\":%zu}\n", offsetof(struct statfs, f_bsize));
  printf("{\"fact\":\"field size\",\"of\":\"statfs.f_bsize\",\"value\":%zu}\n", sizeof(((struct statfs *)0)->f_bsize));
#endif
#ifndef SKIP_statfs_f_iosize
  printf("{\"fact\":\"offset\",\"of\":\"statfs.f_iosize\",\"value\":%zu}\n", offsetof(struct statfs, f_iosize));
  printf("{\"fact\":\"field size\",\"of\":\"statfs.f_iosize\",\"value\":%zu}\n", sizeof(((struct statfs *)0)->f_iosize));
#endif
#ifndef SKIP_statfs_f_blocks
  printf("{\"fact\":\"offset\",\"of\":\"statfs.f_blocks\",\"value\":%zu}\n", offsetof(struct statfs, f_blocks));
  printf("{\"fact\":\"field size\",\"of\":\"statfs.f_blocks\",\"value\":%zu}\n", sizeof(((struct statfs *)0)->f_blocks));
#endif
#ifndef SKIP_statfs_f_bfree
  printf("{\"fact\":\"offset\",\"of\":\"statfs.f_bfree\",\"value\":%zu}\n", offsetof(struct statfs, f_bfree));
  printf("{\"fact\":\"field size\",\"of\":\"statfs.f_bfree\",\"value\":%zu}\n", sizeof(((struct statfs *)0)->f_bfree));
#endif
#ifndef SKIP_statfs_f_bavail
  printf("{\"fact\":\"offset\",\"of\":\"statfs.f_bavail\",\"value\":%zu}\n", offsetof(struct statfs, f_bavail));
  printf("{\"fact\":\"field size\",\"of\":\"statfs.f_bavail\",\"value\":%zu}\n", sizeof(((struct statfs *)0)->f_bavail));
#endif
#ifndef SKIP_statfs_f_files
  printf("{\"fact\":\"offset\",\"of\":\"statfs.f_files\",\"value\":%zu}\n", offsetof(struct statfs, f_files));
  printf("{\"fact\":\"field size\",\"of\":\"statfs.f_files\",\"value\":%zu}\n", sizeof(((struct statfs *)0)->f_files));
#endif
#ifndef SKIP_statfs_f_ffree
  printf("{\"fact\":\"offset\",\"of\":\"statfs.f_ffree\",\"value\":%zu}\n", offsetof(struct statfs, f_ffree));
  printf("{\"fact\":\"field size\",\"of\":\"statfs.f_ffree\",\"value\":%zu}\n", sizeof(((struct statfs *)0)->f_ffree));
#endif
#ifndef SKIP_statfs_f_fsid
  printf("{\"fact\":\"offset\",\"of\":\"statfs.f_fsid\",\"value\":%zu}\n", offsetof(struct statfs, f_fsid));
  printf("{\"fact\":\"field size\",\"of\":\"statfs.f_fsid\",\"value\":%zu}\n", sizeof(((struct statfs *)0)->f_fsid));
#endif
#ifndef SKIP_statfs_f_owner
  printf("{\"fact\":\"offset\",\"of\":\"statfs.f_owner\",\"value\":%zu}\n", offsetof(struct statfs, f_owner));
  printf("{\"fact\":\"field size\",\"of\":\"statfs.f_owner\",\"value\":%zu}\n", sizeof(((struct statfs *)0)->f_owner));
#endif
#ifndef SKIP_statfs_f_type
  printf("{\"fact\":\"offset\",\"of\":\"statfs.f_type\",\"value\":%zu}\n", offsetof(struct statfs, f_type));
  printf("{\"fact\":\"field size\",\"of\":\"statfs.f_type\",\"value\":%zu}\n", sizeof(((struct statfs *)0)->f_type));
#endif
#ifndef SKIP_statfs_f_flags
  printf("{\"fact\":\"offset\",\"of\":\"statfs.f_flags\",\"value\":%zu}\n", offsetof(struct statfs, f_flags));
  printf("{\"fact\":\"field size\",\"of\":\"statfs.f_flags\",\"value\":%zu}\n", sizeof(((struct statfs *)0)->f_flags));
#endif
#ifndef SKIP_statfs_f_fssubtype
  printf("{\"fact\":\"offset\",\"of\":\"statfs.f_fssubtype\",\"value\":%zu}\n", offsetof(struct statfs, f_fssubtype));
  printf("{\"fact\":\"field size\",\"of\":\"statfs.f_fssubtype\",\"value\":%zu}\n", sizeof(((struct statfs *)0)->f_fssubtype));
#endif
#ifndef SKIP_statfs_f_fstypename
  printf("{\"fact\":\"offset\",\"of\":\"statfs.f_fstypename\",\"value\":%zu}\n", offsetof(struct statfs, f_fstypename));
  printf("{\"fact\":\"field size\",\"of\":\"statfs.f_fstypename\",\"value\":%zu}\n", sizeof(((struct statfs *)0)->f_fstypename));
#endif
#ifndef SKIP_statfs_f_mntonname
  printf("{\"fact\":\"offset\",\"of\":\"statfs.f_mntonname\",\"value\":%zu}\n", offsetof(struct statfs, f_mntonname));
  printf("{\"fact\":\"field size\",\"of\":\"statfs.f_mntonname\",\"value\":%zu}\n", sizeof(((struct statfs *)0)->f_mntonname));
#endif
#ifndef SKIP_statfs_f_mntfromname
  printf("{\"fact\":\"offset\",\"of\":\"statfs.f_mntfromname\",\"value\":%zu}\n", offsetof(struct statfs, f_mntfromname));
  printf("{\"fact\":\"field size\",\"of\":\"statfs.f_mntfromname\",\"value\":%zu}\n", sizeof(((struct statfs *)0)->f_mntfromname));
#endif
#ifndef SKIP_statfs_f_flags_ext
  printf("{\"fact\":\"offset\",\"of\":\"statfs.f_flags_ext\",\"value\":%zu}\n", offsetof(struct statfs, f_flags_ext));
  printf("{\"fact\":\"field size\",\"of\":\"statfs.f_flags_ext\",\"value\":%zu}\n", sizeof(((struct statfs *)0)->f_flags_ext));
#endif
#ifndef SKIP_statfs_f_reserved
  printf("{\"fact\":\"offset\",\"of\":\"statfs.f_reserved\",\"value\":%zu}\n", offsetof(struct statfs, f_reserved));
  printf("{\"fact\":\"field size\",\"of\":\"statfs.f_reserved\",\"value\":%zu}\n", sizeof(((struct statfs *)0)->f_reserved));
#endif
#endif
#if PART == 54
  printf("{\"fact\":\"size\",\"of\":\"suseconds_t\",\"value\":%zu}\n", sizeof(suseconds_t));
  printf("{\"fact\":\"align\",\"of\":\"suseconds_t\",\"value\":%zu}\n", _Alignof(suseconds_t));
#endif
#if PART == 55
  printf("{\"fact\":\"size\",\"of\":\"time_t\",\"value\":%zu}\n", sizeof(time_t));
  printf("{\"fact\":\"align\",\"of\":\"time_t\",\"value\":%zu}\n", _Alignof(time_t));
#endif
#if PART == 56
  printf("{\"fact\":\"size\",\"of\":\"timespec\",\"value\":%zu}\n", sizeof(struct timespec));
  printf("{\"fact\":\"align\",\"of\":\"timespec\",\"value\":%zu}\n", _Alignof(struct timespec));
#ifndef SKIP_timespec_tv_sec
  printf("{\"fact\":\"offset\",\"of\":\"timespec.tv_sec\",\"value\":%zu}\n", offsetof(struct timespec, tv_sec));
  printf("{\"fact\":\"field size\",\"of\":\"timespec.tv_sec\",\"value\":%zu}\n", sizeof(((struct timespec *)0)->tv_sec));
#endif
#ifndef SKIP_timespec_tv_nsec
  printf("{\"fact\":\"offset\",\"of\":\"timespec.tv_nsec\",\"value\":%zu}\n", offsetof(struct timespec, tv_nsec));
  printf("{\"fact\":\"field size\",\"of\":\"timespec.tv_nsec\",\"value\":%zu}\n", sizeof(((struct timespec *)0)->tv_nsec));
#endif
#endif
#if PART == 57
  printf("{\"fact\":\"size\",\"of\":\"timeval\",\"value\":%zu}\n", sizeof(struct timeval));
  printf("{\"fact\":\"align\",\"of\":\"timeval\",\"value\":%zu}\n", _Alignof(struct timeval));
#ifndef SKIP_timeval_tv_sec
  printf("{\"fact\":\"offset\",\"of\":\"timeval.tv_sec\",\"value\":%zu}\n", offsetof(struct timeval, tv_sec));
  printf("{\"fact\":\"field size\",\"of\":\"timeval.tv_sec\",\"value\":%zu}\n", sizeof(((struct timeval *)0)->tv_sec));
#endif
#ifndef SKIP_timeval_tv_usec
  printf("{\"fact\":\"offset\",\"of\":\"timeval.tv_usec\",\"value\":%zu}\n", offsetof(struct timeval, tv_usec));
  printf("{\"fact\":\"field size\",\"of\":\"timeval.tv_usec\",\"value\":%zu}\n", sizeof(((struct timeval *)0)->tv_usec));
#endif
#endif
#if PART == 58
  printf("{\"fact\":\"size\",\"of\":\"uid_t\",\"value\":%zu}\n", sizeof(uid_t));
  printf("{\"fact\":\"align\",\"of\":\"uid_t\",\"value\":%zu}\n", _Alignof(uid_t));
#endif
#if PART == 59
  printf("{\"fact\":\"size\",\"of\":\"uintptr_t\",\"value\":%zu}\n", sizeof(uintptr_t));
  printf("{\"fact\":\"align\",\"of\":\"uintptr_t\",\"value\":%zu}\n", _Alignof(uintptr_t));
#endif
#if PART == 60
  printf("{\"fact\":\"size\",\"of\":\"vm_address_t\",\"value\":%zu}\n", sizeof(vm_address_t));
  printf("{\"fact\":\"align\",\"of\":\"vm_address_t\",\"value\":%zu}\n", _Alignof(vm_address_t));
#endif
#if PART == 61
  printf("{\"fact\":\"size\",\"of\":\"vm_map_t\",\"value\":%zu}\n", sizeof(vm_map_t));
  printf("{\"fact\":\"align\",\"of\":\"vm_map_t\",\"value\":%zu}\n", _Alignof(vm_map_t));
#endif
#if PART == 62
  printf("{\"fact\":\"size\",\"of\":\"vm_offset_t\",\"value\":%zu}\n", sizeof(vm_offset_t));
  printf("{\"fact\":\"align\",\"of\":\"vm_offset_t\",\"value\":%zu}\n", _Alignof(vm_offset_t));
#endif
#if PART == 63
  printf("{\"fact\":\"size\",\"of\":\"vm_size_t\",\"value\":%zu}\n", sizeof(vm_size_t));
  printf("{\"fact\":\"align\",\"of\":\"vm_size_t\",\"value\":%zu}\n", _Alignof(vm_size_t));
#endif
#if PART == 64
  printf("{\"fact\":\"size\",\"of\":\"vm_statistics64\",\"value\":%zu}\n", sizeof(struct vm_statistics64));
  printf("{\"fact\":\"align\",\"of\":\"vm_statistics64\",\"value\":%zu}\n", _Alignof(struct vm_statistics64));
#ifndef SKIP_vm_statistics64_free_count
  printf("{\"fact\":\"offset\",\"of\":\"vm_statistics64.free_count\",\"value\":%zu}\n", offsetof(struct vm_statistics64, free_count));
  printf("{\"fact\":\"field size\",\"of\":\"vm_statistics64.free_count\",\"value\":%zu}\n", sizeof(((struct vm_statistics64 *)0)->free_count));
#endif
#ifndef SKIP_vm_statistics64_active_count
  printf("{\"fact\":\"offset\",\"of\":\"vm_statistics64.active_count\",\"value\":%zu}\n", offsetof(struct vm_statistics64, active_count));
  printf("{\"fact\":\"field size\",\"of\":\"vm_statistics64.active_count\",\"value\":%zu}\n", sizeof(((struct vm_statistics64 *)0)->active_count));
#endif
#ifndef SKIP_vm_statistics64_inactive_count
  printf("{\"fact\":\"offset\",\"of\":\"vm_statistics64.inactive_count\",\"value\":%zu}\n", offsetof(struct vm_statistics64, inactive_count));
  printf("{\"fact\":\"field size\",\"of\":\"vm_statistics64.inactive_count\",\"value\":%zu}\n", sizeof(((struct vm_statistics64 *)0)->inactive_count));
#endif
#ifndef SKIP_vm_statistics64_wire_count
  printf("{\"fact\":\"offset\",\"of\":\"vm_statistics64.wire_count\",\"value\":%zu}\n", offsetof(struct vm_statistics64, wire_count));
  printf("{\"fact\":\"field size\",\"of\":\"vm_statistics64.wire_count\",\"value\":%zu}\n", sizeof(((struct vm_statistics64 *)0)->wire_count));
#endif
#ifndef SKIP_vm_statistics64_zero_fill_count
  printf("{\"fact\":\"offset\",\"of\":\"vm_statistics64.zero_fill_count\",\"value\":%zu}\n", offsetof(struct vm_statistics64, zero_fill_count));
  printf("{\"fact\":\"field size\",\"of\":\"vm_statistics64.zero_fill_count\",\"value\":%zu}\n", sizeof(((struct vm_statistics64 *)0)->zero_fill_count));
#endif
#ifndef SKIP_vm_statistics64_reactivations
  printf("{\"fact\":\"offset\",\"of\":\"vm_statistics64.reactivations\",\"value\":%zu}\n", offsetof(struct vm_statistics64, reactivations));
  printf("{\"fact\":\"field size\",\"of\":\"vm_statistics64.reactivations\",\"value\":%zu}\n", sizeof(((struct vm_statistics64 *)0)->reactivations));
#endif
#ifndef SKIP_vm_statistics64_pageins
  printf("{\"fact\":\"offset\",\"of\":\"vm_statistics64.pageins\",\"value\":%zu}\n", offsetof(struct vm_statistics64, pageins));
  printf("{\"fact\":\"field size\",\"of\":\"vm_statistics64.pageins\",\"value\":%zu}\n", sizeof(((struct vm_statistics64 *)0)->pageins));
#endif
#ifndef SKIP_vm_statistics64_pageouts
  printf("{\"fact\":\"offset\",\"of\":\"vm_statistics64.pageouts\",\"value\":%zu}\n", offsetof(struct vm_statistics64, pageouts));
  printf("{\"fact\":\"field size\",\"of\":\"vm_statistics64.pageouts\",\"value\":%zu}\n", sizeof(((struct vm_statistics64 *)0)->pageouts));
#endif
#ifndef SKIP_vm_statistics64_faults
  printf("{\"fact\":\"offset\",\"of\":\"vm_statistics64.faults\",\"value\":%zu}\n", offsetof(struct vm_statistics64, faults));
  printf("{\"fact\":\"field size\",\"of\":\"vm_statistics64.faults\",\"value\":%zu}\n", sizeof(((struct vm_statistics64 *)0)->faults));
#endif
#ifndef SKIP_vm_statistics64_cow_faults
  printf("{\"fact\":\"offset\",\"of\":\"vm_statistics64.cow_faults\",\"value\":%zu}\n", offsetof(struct vm_statistics64, cow_faults));
  printf("{\"fact\":\"field size\",\"of\":\"vm_statistics64.cow_faults\",\"value\":%zu}\n", sizeof(((struct vm_statistics64 *)0)->cow_faults));
#endif
#ifndef SKIP_vm_statistics64_lookups
  printf("{\"fact\":\"offset\",\"of\":\"vm_statistics64.lookups\",\"value\":%zu}\n", offsetof(struct vm_statistics64, lookups));
  printf("{\"fact\":\"field size\",\"of\":\"vm_statistics64.lookups\",\"value\":%zu}\n", sizeof(((struct vm_statistics64 *)0)->lookups));
#endif
#ifndef SKIP_vm_statistics64_hits
  printf("{\"fact\":\"offset\",\"of\":\"vm_statistics64.hits\",\"value\":%zu}\n", offsetof(struct vm_statistics64, hits));
  printf("{\"fact\":\"field size\",\"of\":\"vm_statistics64.hits\",\"value\":%zu}\n", sizeof(((struct vm_statistics64 *)0)->hits));
#endif
#ifndef SKIP_vm_statistics64_purges
  printf("{\"fact\":\"offset\",\"of\":\"vm_statistics64.purges\",\"value\":%zu}\n", offsetof(struct vm_statistics64, purges));
  printf("{\"fact\":\"field size\",\"of\":\"vm_statistics64.purges\",\"value\":%zu}\n", sizeof(((struct vm_statistics64 *)0)->purges));
#endif
#ifndef SKIP_vm_statistics64_purgeable_count
  printf("{\"fact\":\"offset\",\"of\":\"vm_statistics64.purgeable_count\",\"value\":%zu}\n", offsetof(struct vm_statistics64, purgeable_count));
  printf("{\"fact\":\"field size\",\"of\":\"vm_statistics64.purgeable_count\",\"value\":%zu}\n", sizeof(((struct vm_statistics64 *)0)->purgeable_count));
#endif
#ifndef SKIP_vm_statistics64_speculative_count
  printf("{\"fact\":\"offset\",\"of\":\"vm_statistics64.speculative_count\",\"value\":%zu}\n", offsetof(struct vm_statistics64, speculative_count));
  printf("{\"fact\":\"field size\",\"of\":\"vm_statistics64.speculative_count\",\"value\":%zu}\n", sizeof(((struct vm_statistics64 *)0)->speculative_count));
#endif
#ifndef SKIP_vm_statistics64_decompressions
  printf("{\"fact\":\"offset\",\"of\":\"vm_statistics64.decompressions\",\"value\":%zu}\n", offsetof(struct vm_statistics64, decompressions));
  printf("{\"fact\":\"field size\",\"of\":\"vm_statistics64.decompressions\",\"value\":%zu}\n", sizeof(((struct vm_statistics64 *)0)->decompressions));
#endif
#ifndef SKIP_vm_statistics64_compressions
  printf("{\"fact\":\"offset\",\"of\":\"vm_statistics64.compressions\",\"value\":%zu}\n", offsetof(struct vm_statistics64, compressions));
  printf("{\"fact\":\"field size\",\"of\":\"vm_statistics64.compressions\",\"value\":%zu}\n", sizeof(((struct vm_statistics64 *)0)->compressions));
#endif
#ifndef SKIP_vm_statistics64_swapins
  printf("{\"fact\":\"offset\",\"of\":\"vm_statistics64.swapins\",\"value\":%zu}\n", offsetof(struct vm_statistics64, swapins));
  printf("{\"fact\":\"field size\",\"of\":\"vm_statistics64.swapins\",\"value\":%zu}\n", sizeof(((struct vm_statistics64 *)0)->swapins));
#endif
#ifndef SKIP_vm_statistics64_swapouts
  printf("{\"fact\":\"offset\",\"of\":\"vm_statistics64.swapouts\",\"value\":%zu}\n", offsetof(struct vm_statistics64, swapouts));
  printf("{\"fact\":\"field size\",\"of\":\"vm_statistics64.swapouts\",\"value\":%zu}\n", sizeof(((struct vm_statistics64 *)0)->swapouts));
#endif
#ifndef SKIP_vm_statistics64_compressor_page_count
  printf("{\"fact\":\"offset\",\"of\":\"vm_statistics64.compressor_page_count\",\"value\":%zu}\n", offsetof(struct vm_statistics64, compressor_page_count));
  printf("{\"fact\":\"field size\",\"of\":\"vm_statistics64.compressor_page_count\",\"value\":%zu}\n", sizeof(((struct vm_statistics64 *)0)->compressor_page_count));
#endif
#ifndef SKIP_vm_statistics64_throttled_count
  printf("{\"fact\":\"offset\",\"of\":\"vm_statistics64.throttled_count\",\"value\":%zu}\n", offsetof(struct vm_statistics64, throttled_count));
  printf("{\"fact\":\"field size\",\"of\":\"vm_statistics64.throttled_count\",\"value\":%zu}\n", sizeof(((struct vm_statistics64 *)0)->throttled_count));
#endif
#ifndef SKIP_vm_statistics64_external_page_count
  printf("{\"fact\":\"offset\",\"of\":\"vm_statistics64.external_page_count\",\"value\":%zu}\n", offsetof(struct vm_statistics64, external_page_count));
  printf("{\"fact\":\"field size\",\"of\":\"vm_statistics64.external_page_count\",\"value\":%zu}\n", sizeof(((struct vm_statistics64 *)0)->external_page_count));
#endif
#ifndef SKIP_vm_statistics64_internal_page_count
  printf("{\"fact\":\"offset\",\"of\":\"vm_statistics64.internal_page_count\",\"value\":%zu}\n", offsetof(struct vm_statistics64, internal_page_count));
  printf("{\"fact\":\"field size\",\"of\":\"vm_statistics64.internal_page_count\",\"value\":%zu}\n", sizeof(((struct vm_statistics64 *)0)->internal_page_count));
#endif
#ifndef SKIP_vm_statistics64_total_uncompressed_pages_in_compressor
  printf("{\"fact\":\"offset\",\"of\":\"vm_statistics64.total_uncompressed_pages_in_compressor\",\"value\":%zu}\n", offsetof(struct vm_statistics64, total_uncompressed_pages_in_compressor));
  printf("{\"fact\":\"field size\",\"of\":\"vm_statistics64.total_uncompressed_pages_in_compressor\",\"value\":%zu}\n", sizeof(((struct vm_statistics64 *)0)->total_uncompressed_pages_in_compressor));
#endif
#endif
#if PART == 65
  printf("{\"fact\":\"size\",\"of\":\"vm_statistics64_data_t\",\"value\":%zu}\n", sizeof(vm_statistics64_data_t));
  printf("{\"fact\":\"align\",\"of\":\"vm_statistics64_data_t\",\"value\":%zu}\n", _Alignof(vm_statistics64_data_t));
#endif
#if PART == 66
#ifdef AT_EACCESS
  printf("{\"fact\":\"constant\",\"of\":\"AT_EACCESS\",\"value\":%lld}\n", (long long)(AT_EACCESS));
#else
  printf("{\"fact\":\"constant\",\"of\":\"AT_EACCESS\",\"value\":\"no macro of this name\"}\n");
#endif
#ifdef AT_FDCWD
  printf("{\"fact\":\"constant\",\"of\":\"AT_FDCWD\",\"value\":%lld}\n", (long long)(AT_FDCWD));
#else
  printf("{\"fact\":\"constant\",\"of\":\"AT_FDCWD\",\"value\":\"no macro of this name\"}\n");
#endif
#ifdef AT_REMOVEDIR
  printf("{\"fact\":\"constant\",\"of\":\"AT_REMOVEDIR\",\"value\":%lld}\n", (long long)(AT_REMOVEDIR));
#else
  printf("{\"fact\":\"constant\",\"of\":\"AT_REMOVEDIR\",\"value\":\"no macro of this name\"}\n");
#endif
#ifdef AT_SYMLINK_FOLLOW
  printf("{\"fact\":\"constant\",\"of\":\"AT_SYMLINK_FOLLOW\",\"value\":%lld}\n", (long long)(AT_SYMLINK_FOLLOW));
#else
  printf("{\"fact\":\"constant\",\"of\":\"AT_SYMLINK_FOLLOW\",\"value\":\"no macro of this name\"}\n");
#endif
#ifdef AT_SYMLINK_NOFOLLOW
  printf("{\"fact\":\"constant\",\"of\":\"AT_SYMLINK_NOFOLLOW\",\"value\":%lld}\n", (long long)(AT_SYMLINK_NOFOLLOW));
#else
  printf("{\"fact\":\"constant\",\"of\":\"AT_SYMLINK_NOFOLLOW\",\"value\":\"no macro of this name\"}\n");
#endif
#ifdef COPYFILE_ACL
  printf("{\"fact\":\"constant\",\"of\":\"COPYFILE_ACL\",\"value\":%lld}\n", (long long)(COPYFILE_ACL));
#else
  printf("{\"fact\":\"constant\",\"of\":\"COPYFILE_ACL\",\"value\":\"no macro of this name\"}\n");
#endif
#ifdef COPYFILE_CHECK
  printf("{\"fact\":\"constant\",\"of\":\"COPYFILE_CHECK\",\"value\":%lld}\n", (long long)(COPYFILE_CHECK));
#else
  printf("{\"fact\":\"constant\",\"of\":\"COPYFILE_CHECK\",\"value\":\"no macro of this name\"}\n");
#endif
#ifdef COPYFILE_CLONE
  printf("{\"fact\":\"constant\",\"of\":\"COPYFILE_CLONE\",\"value\":%lld}\n", (long long)(COPYFILE_CLONE));
#else
  printf("{\"fact\":\"constant\",\"of\":\"COPYFILE_CLONE\",\"value\":\"no macro of this name\"}\n");
#endif
#ifdef COPYFILE_CLONE_FORCE
  printf("{\"fact\":\"constant\",\"of\":\"COPYFILE_CLONE_FORCE\",\"value\":%lld}\n", (long long)(COPYFILE_CLONE_FORCE));
#else
  printf("{\"fact\":\"constant\",\"of\":\"COPYFILE_CLONE_FORCE\",\"value\":\"no macro of this name\"}\n");
#endif
#ifdef COPYFILE_CONTINUE
  printf("{\"fact\":\"constant\",\"of\":\"COPYFILE_CONTINUE\",\"value\":%lld}\n", (long long)(COPYFILE_CONTINUE));
#else
  printf("{\"fact\":\"constant\",\"of\":\"COPYFILE_CONTINUE\",\"value\":\"no macro of this name\"}\n");
#endif
#ifdef COPYFILE_COPY_DATA
  printf("{\"fact\":\"constant\",\"of\":\"COPYFILE_COPY_DATA\",\"value\":%lld}\n", (long long)(COPYFILE_COPY_DATA));
#else
  printf("{\"fact\":\"constant\",\"of\":\"COPYFILE_COPY_DATA\",\"value\":\"no macro of this name\"}\n");
#endif
#ifdef COPYFILE_COPY_XATTR
  printf("{\"fact\":\"constant\",\"of\":\"COPYFILE_COPY_XATTR\",\"value\":%lld}\n", (long long)(COPYFILE_COPY_XATTR));
#else
  printf("{\"fact\":\"constant\",\"of\":\"COPYFILE_COPY_XATTR\",\"value\":\"no macro of this name\"}\n");
#endif
#ifdef COPYFILE_DATA
  printf("{\"fact\":\"constant\",\"of\":\"COPYFILE_DATA\",\"value\":%lld}\n", (long long)(COPYFILE_DATA));
#else
  printf("{\"fact\":\"constant\",\"of\":\"COPYFILE_DATA\",\"value\":\"no macro of this name\"}\n");
#endif
#ifdef COPYFILE_DATA_SPARSE
  printf("{\"fact\":\"constant\",\"of\":\"COPYFILE_DATA_SPARSE\",\"value\":%lld}\n", (long long)(COPYFILE_DATA_SPARSE));
#else
  printf("{\"fact\":\"constant\",\"of\":\"COPYFILE_DATA_SPARSE\",\"value\":\"no macro of this name\"}\n");
#endif
#ifdef COPYFILE_ERR
  printf("{\"fact\":\"constant\",\"of\":\"COPYFILE_ERR\",\"value\":%lld}\n", (long long)(COPYFILE_ERR));
#else
  printf("{\"fact\":\"constant\",\"of\":\"COPYFILE_ERR\",\"value\":\"no macro of this name\"}\n");
#endif
#ifdef COPYFILE_EXCL
  printf("{\"fact\":\"constant\",\"of\":\"COPYFILE_EXCL\",\"value\":%lld}\n", (long long)(COPYFILE_EXCL));
#else
  printf("{\"fact\":\"constant\",\"of\":\"COPYFILE_EXCL\",\"value\":\"no macro of this name\"}\n");
#endif
#ifdef COPYFILE_FINISH
  printf("{\"fact\":\"constant\",\"of\":\"COPYFILE_FINISH\",\"value\":%lld}\n", (long long)(COPYFILE_FINISH));
#else
  printf("{\"fact\":\"constant\",\"of\":\"COPYFILE_FINISH\",\"value\":\"no macro of this name\"}\n");
#endif
#ifdef COPYFILE_METADATA
  printf("{\"fact\":\"constant\",\"of\":\"COPYFILE_METADATA\",\"value\":%lld}\n", (long long)(COPYFILE_METADATA));
#else
  printf("{\"fact\":\"constant\",\"of\":\"COPYFILE_METADATA\",\"value\":\"no macro of this name\"}\n");
#endif
#ifdef COPYFILE_MOVE
  printf("{\"fact\":\"constant\",\"of\":\"COPYFILE_MOVE\",\"value\":%lld}\n", (long long)(COPYFILE_MOVE));
#else
  printf("{\"fact\":\"constant\",\"of\":\"COPYFILE_MOVE\",\"value\":\"no macro of this name\"}\n");
#endif
#ifdef COPYFILE_NOFOLLOW
  printf("{\"fact\":\"constant\",\"of\":\"COPYFILE_NOFOLLOW\",\"value\":%lld}\n", (long long)(COPYFILE_NOFOLLOW));
#else
  printf("{\"fact\":\"constant\",\"of\":\"COPYFILE_NOFOLLOW\",\"value\":\"no macro of this name\"}\n");
#endif
#ifdef COPYFILE_NOFOLLOW_DST
  printf("{\"fact\":\"constant\",\"of\":\"COPYFILE_NOFOLLOW_DST\",\"value\":%lld}\n", (long long)(COPYFILE_NOFOLLOW_DST));
#else
  printf("{\"fact\":\"constant\",\"of\":\"COPYFILE_NOFOLLOW_DST\",\"value\":\"no macro of this name\"}\n");
#endif
#ifdef COPYFILE_NOFOLLOW_SRC
  printf("{\"fact\":\"constant\",\"of\":\"COPYFILE_NOFOLLOW_SRC\",\"value\":%lld}\n", (long long)(COPYFILE_NOFOLLOW_SRC));
#else
  printf("{\"fact\":\"constant\",\"of\":\"COPYFILE_NOFOLLOW_SRC\",\"value\":\"no macro of this name\"}\n");
#endif
#ifdef COPYFILE_PACK
  printf("{\"fact\":\"constant\",\"of\":\"COPYFILE_PACK\",\"value\":%lld}\n", (long long)(COPYFILE_PACK));
#else
  printf("{\"fact\":\"constant\",\"of\":\"COPYFILE_PACK\",\"value\":\"no macro of this name\"}\n");
#endif
#ifdef COPYFILE_PRESERVE_DST_TRACKED
  printf("{\"fact\":\"constant\",\"of\":\"COPYFILE_PRESERVE_DST_TRACKED\",\"value\":%lld}\n", (long long)(COPYFILE_PRESERVE_DST_TRACKED));
#else
  printf("{\"fact\":\"constant\",\"of\":\"COPYFILE_PRESERVE_DST_TRACKED\",\"value\":\"no macro of this name\"}\n");
#endif
#ifdef COPYFILE_PROGRESS
  printf("{\"fact\":\"constant\",\"of\":\"COPYFILE_PROGRESS\",\"value\":%lld}\n", (long long)(COPYFILE_PROGRESS));
#else
  printf("{\"fact\":\"constant\",\"of\":\"COPYFILE_PROGRESS\",\"value\":\"no macro of this name\"}\n");
#endif
#ifdef COPYFILE_QUIT
  printf("{\"fact\":\"constant\",\"of\":\"COPYFILE_QUIT\",\"value\":%lld}\n", (long long)(COPYFILE_QUIT));
#else
  printf("{\"fact\":\"constant\",\"of\":\"COPYFILE_QUIT\",\"value\":\"no macro of this name\"}\n");
#endif
#ifdef COPYFILE_RECURSE_DIR
  printf("{\"fact\":\"constant\",\"of\":\"COPYFILE_RECURSE_DIR\",\"value\":%lld}\n", (long long)(COPYFILE_RECURSE_DIR));
#else
  printf("{\"fact\":\"constant\",\"of\":\"COPYFILE_RECURSE_DIR\",\"value\":\"no macro of this name\"}\n");
#endif
#ifdef COPYFILE_RECURSE_DIR_CLEANUP
  printf("{\"fact\":\"constant\",\"of\":\"COPYFILE_RECURSE_DIR_CLEANUP\",\"value\":%lld}\n", (long long)(COPYFILE_RECURSE_DIR_CLEANUP));
#else
  printf("{\"fact\":\"constant\",\"of\":\"COPYFILE_RECURSE_DIR_CLEANUP\",\"value\":\"no macro of this name\"}\n");
#endif
#ifdef COPYFILE_RECURSE_ERROR
  printf("{\"fact\":\"constant\",\"of\":\"COPYFILE_RECURSE_ERROR\",\"value\":%lld}\n", (long long)(COPYFILE_RECURSE_ERROR));
#else
  printf("{\"fact\":\"constant\",\"of\":\"COPYFILE_RECURSE_ERROR\",\"value\":\"no macro of this name\"}\n");
#endif
#ifdef COPYFILE_RECURSE_FILE
  printf("{\"fact\":\"constant\",\"of\":\"COPYFILE_RECURSE_FILE\",\"value\":%lld}\n", (long long)(COPYFILE_RECURSE_FILE));
#else
  printf("{\"fact\":\"constant\",\"of\":\"COPYFILE_RECURSE_FILE\",\"value\":\"no macro of this name\"}\n");
#endif
#ifdef COPYFILE_RECURSIVE
  printf("{\"fact\":\"constant\",\"of\":\"COPYFILE_RECURSIVE\",\"value\":%lld}\n", (long long)(COPYFILE_RECURSIVE));
#else
  printf("{\"fact\":\"constant\",\"of\":\"COPYFILE_RECURSIVE\",\"value\":\"no macro of this name\"}\n");
#endif
#ifdef COPYFILE_RUN_IN_PLACE
  printf("{\"fact\":\"constant\",\"of\":\"COPYFILE_RUN_IN_PLACE\",\"value\":%lld}\n", (long long)(COPYFILE_RUN_IN_PLACE));
#else
  printf("{\"fact\":\"constant\",\"of\":\"COPYFILE_RUN_IN_PLACE\",\"value\":\"no macro of this name\"}\n");
#endif
#ifdef COPYFILE_SECURITY
  printf("{\"fact\":\"constant\",\"of\":\"COPYFILE_SECURITY\",\"value\":%lld}\n", (long long)(COPYFILE_SECURITY));
#else
  printf("{\"fact\":\"constant\",\"of\":\"COPYFILE_SECURITY\",\"value\":\"no macro of this name\"}\n");
#endif
#ifdef COPYFILE_SKIP
  printf("{\"fact\":\"constant\",\"of\":\"COPYFILE_SKIP\",\"value\":%lld}\n", (long long)(COPYFILE_SKIP));
#else
  printf("{\"fact\":\"constant\",\"of\":\"COPYFILE_SKIP\",\"value\":\"no macro of this name\"}\n");
#endif
#ifdef COPYFILE_START
  printf("{\"fact\":\"constant\",\"of\":\"COPYFILE_START\",\"value\":%lld}\n", (long long)(COPYFILE_START));
#else
  printf("{\"fact\":\"constant\",\"of\":\"COPYFILE_START\",\"value\":\"no macro of this name\"}\n");
#endif
#ifdef COPYFILE_STAT
  printf("{\"fact\":\"constant\",\"of\":\"COPYFILE_STAT\",\"value\":%lld}\n", (long long)(COPYFILE_STAT));
#else
  printf("{\"fact\":\"constant\",\"of\":\"COPYFILE_STAT\",\"value\":\"no macro of this name\"}\n");
#endif
#ifdef COPYFILE_STATE_BSIZE
  printf("{\"fact\":\"constant\",\"of\":\"COPYFILE_STATE_BSIZE\",\"value\":%lld}\n", (long long)(COPYFILE_STATE_BSIZE));
#else
  printf("{\"fact\":\"constant\",\"of\":\"COPYFILE_STATE_BSIZE\",\"value\":\"no macro of this name\"}\n");
#endif
#ifdef COPYFILE_STATE_COPIED
  printf("{\"fact\":\"constant\",\"of\":\"COPYFILE_STATE_COPIED\",\"value\":%lld}\n", (long long)(COPYFILE_STATE_COPIED));
#else
  printf("{\"fact\":\"constant\",\"of\":\"COPYFILE_STATE_COPIED\",\"value\":\"no macro of this name\"}\n");
#endif
#ifdef COPYFILE_STATE_DST_BSIZE
  printf("{\"fact\":\"constant\",\"of\":\"COPYFILE_STATE_DST_BSIZE\",\"value\":%lld}\n", (long long)(COPYFILE_STATE_DST_BSIZE));
#else
  printf("{\"fact\":\"constant\",\"of\":\"COPYFILE_STATE_DST_BSIZE\",\"value\":\"no macro of this name\"}\n");
#endif
#ifdef COPYFILE_STATE_DST_FD
  printf("{\"fact\":\"constant\",\"of\":\"COPYFILE_STATE_DST_FD\",\"value\":%lld}\n", (long long)(COPYFILE_STATE_DST_FD));
#else
  printf("{\"fact\":\"constant\",\"of\":\"COPYFILE_STATE_DST_FD\",\"value\":\"no macro of this name\"}\n");
#endif
#ifdef COPYFILE_STATE_DST_FILENAME
  printf("{\"fact\":\"constant\",\"of\":\"COPYFILE_STATE_DST_FILENAME\",\"value\":%lld}\n", (long long)(COPYFILE_STATE_DST_FILENAME));
#else
  printf("{\"fact\":\"constant\",\"of\":\"COPYFILE_STATE_DST_FILENAME\",\"value\":\"no macro of this name\"}\n");
#endif
#ifdef COPYFILE_STATE_QUARANTINE
  printf("{\"fact\":\"constant\",\"of\":\"COPYFILE_STATE_QUARANTINE\",\"value\":%lld}\n", (long long)(COPYFILE_STATE_QUARANTINE));
#else
  printf("{\"fact\":\"constant\",\"of\":\"COPYFILE_STATE_QUARANTINE\",\"value\":\"no macro of this name\"}\n");
#endif
#ifdef COPYFILE_STATE_SRC_BSIZE
  printf("{\"fact\":\"constant\",\"of\":\"COPYFILE_STATE_SRC_BSIZE\",\"value\":%lld}\n", (long long)(COPYFILE_STATE_SRC_BSIZE));
#else
  printf("{\"fact\":\"constant\",\"of\":\"COPYFILE_STATE_SRC_BSIZE\",\"value\":\"no macro of this name\"}\n");
#endif
#ifdef COPYFILE_STATE_SRC_FD
  printf("{\"fact\":\"constant\",\"of\":\"COPYFILE_STATE_SRC_FD\",\"value\":%lld}\n", (long long)(COPYFILE_STATE_SRC_FD));
#else
  printf("{\"fact\":\"constant\",\"of\":\"COPYFILE_STATE_SRC_FD\",\"value\":\"no macro of this name\"}\n");
#endif
#ifdef COPYFILE_STATE_SRC_FILENAME
  printf("{\"fact\":\"constant\",\"of\":\"COPYFILE_STATE_SRC_FILENAME\",\"value\":%lld}\n", (long long)(COPYFILE_STATE_SRC_FILENAME));
#else
  printf("{\"fact\":\"constant\",\"of\":\"COPYFILE_STATE_SRC_FILENAME\",\"value\":\"no macro of this name\"}\n");
#endif
#ifdef COPYFILE_STATE_STATUS_CB
  printf("{\"fact\":\"constant\",\"of\":\"COPYFILE_STATE_STATUS_CB\",\"value\":%lld}\n", (long long)(COPYFILE_STATE_STATUS_CB));
#else
  printf("{\"fact\":\"constant\",\"of\":\"COPYFILE_STATE_STATUS_CB\",\"value\":\"no macro of this name\"}\n");
#endif
#ifdef COPYFILE_STATE_STATUS_CTX
  printf("{\"fact\":\"constant\",\"of\":\"COPYFILE_STATE_STATUS_CTX\",\"value\":%lld}\n", (long long)(COPYFILE_STATE_STATUS_CTX));
#else
  printf("{\"fact\":\"constant\",\"of\":\"COPYFILE_STATE_STATUS_CTX\",\"value\":\"no macro of this name\"}\n");
#endif
#ifdef COPYFILE_STATE_WAS_CLONED
  printf("{\"fact\":\"constant\",\"of\":\"COPYFILE_STATE_WAS_CLONED\",\"value\":%lld}\n", (long long)(COPYFILE_STATE_WAS_CLONED));
#else
  printf("{\"fact\":\"constant\",\"of\":\"COPYFILE_STATE_WAS_CLONED\",\"value\":\"no macro of this name\"}\n");
#endif
#ifdef COPYFILE_STATE_XATTRNAME
  printf("{\"fact\":\"constant\",\"of\":\"COPYFILE_STATE_XATTRNAME\",\"value\":%lld}\n", (long long)(COPYFILE_STATE_XATTRNAME));
#else
  printf("{\"fact\":\"constant\",\"of\":\"COPYFILE_STATE_XATTRNAME\",\"value\":\"no macro of this name\"}\n");
#endif
#ifdef COPYFILE_UNLINK
  printf("{\"fact\":\"constant\",\"of\":\"COPYFILE_UNLINK\",\"value\":%lld}\n", (long long)(COPYFILE_UNLINK));
#else
  printf("{\"fact\":\"constant\",\"of\":\"COPYFILE_UNLINK\",\"value\":\"no macro of this name\"}\n");
#endif
#ifdef COPYFILE_UNPACK
  printf("{\"fact\":\"constant\",\"of\":\"COPYFILE_UNPACK\",\"value\":%lld}\n", (long long)(COPYFILE_UNPACK));
#else
  printf("{\"fact\":\"constant\",\"of\":\"COPYFILE_UNPACK\",\"value\":\"no macro of this name\"}\n");
#endif
#ifdef COPYFILE_VERBOSE
  printf("{\"fact\":\"constant\",\"of\":\"COPYFILE_VERBOSE\",\"value\":%lld}\n", (long long)(COPYFILE_VERBOSE));
#else
  printf("{\"fact\":\"constant\",\"of\":\"COPYFILE_VERBOSE\",\"value\":\"no macro of this name\"}\n");
#endif
#ifdef COPYFILE_XATTR
  printf("{\"fact\":\"constant\",\"of\":\"COPYFILE_XATTR\",\"value\":%lld}\n", (long long)(COPYFILE_XATTR));
#else
  printf("{\"fact\":\"constant\",\"of\":\"COPYFILE_XATTR\",\"value\":\"no macro of this name\"}\n");
#endif
#ifdef CPU_STATE_IDLE
  printf("{\"fact\":\"constant\",\"of\":\"CPU_STATE_IDLE\",\"value\":%lld}\n", (long long)(CPU_STATE_IDLE));
#else
  printf("{\"fact\":\"constant\",\"of\":\"CPU_STATE_IDLE\",\"value\":\"no macro of this name\"}\n");
#endif
#ifdef CPU_STATE_MAX
  printf("{\"fact\":\"constant\",\"of\":\"CPU_STATE_MAX\",\"value\":%lld}\n", (long long)(CPU_STATE_MAX));
#else
  printf("{\"fact\":\"constant\",\"of\":\"CPU_STATE_MAX\",\"value\":\"no macro of this name\"}\n");
#endif
#ifdef CPU_STATE_NICE
  printf("{\"fact\":\"constant\",\"of\":\"CPU_STATE_NICE\",\"value\":%lld}\n", (long long)(CPU_STATE_NICE));
#else
  printf("{\"fact\":\"constant\",\"of\":\"CPU_STATE_NICE\",\"value\":\"no macro of this name\"}\n");
#endif
#ifdef CPU_STATE_SYSTEM
  printf("{\"fact\":\"constant\",\"of\":\"CPU_STATE_SYSTEM\",\"value\":%lld}\n", (long long)(CPU_STATE_SYSTEM));
#else
  printf("{\"fact\":\"constant\",\"of\":\"CPU_STATE_SYSTEM\",\"value\":\"no macro of this name\"}\n");
#endif
#ifdef CPU_STATE_USER
  printf("{\"fact\":\"constant\",\"of\":\"CPU_STATE_USER\",\"value\":%lld}\n", (long long)(CPU_STATE_USER));
#else
  printf("{\"fact\":\"constant\",\"of\":\"CPU_STATE_USER\",\"value\":\"no macro of this name\"}\n");
#endif
#ifdef DT_BLK
  printf("{\"fact\":\"constant\",\"of\":\"DT_BLK\",\"value\":%lld}\n", (long long)(DT_BLK));
#else
  printf("{\"fact\":\"constant\",\"of\":\"DT_BLK\",\"value\":\"no macro of this name\"}\n");
#endif
#ifdef DT_CHR
  printf("{\"fact\":\"constant\",\"of\":\"DT_CHR\",\"value\":%lld}\n", (long long)(DT_CHR));
#else
  printf("{\"fact\":\"constant\",\"of\":\"DT_CHR\",\"value\":\"no macro of this name\"}\n");
#endif
#ifdef DT_DIR
  printf("{\"fact\":\"constant\",\"of\":\"DT_DIR\",\"value\":%lld}\n", (long long)(DT_DIR));
#else
  printf("{\"fact\":\"constant\",\"of\":\"DT_DIR\",\"value\":\"no macro of this name\"}\n");
#endif
#ifdef DT_FIFO
  printf("{\"fact\":\"constant\",\"of\":\"DT_FIFO\",\"value\":%lld}\n", (long long)(DT_FIFO));
#else
  printf("{\"fact\":\"constant\",\"of\":\"DT_FIFO\",\"value\":\"no macro of this name\"}\n");
#endif
#ifdef DT_LNK
  printf("{\"fact\":\"constant\",\"of\":\"DT_LNK\",\"value\":%lld}\n", (long long)(DT_LNK));
#else
  printf("{\"fact\":\"constant\",\"of\":\"DT_LNK\",\"value\":\"no macro of this name\"}\n");
#endif
#ifdef DT_REG
  printf("{\"fact\":\"constant\",\"of\":\"DT_REG\",\"value\":%lld}\n", (long long)(DT_REG));
#else
  printf("{\"fact\":\"constant\",\"of\":\"DT_REG\",\"value\":\"no macro of this name\"}\n");
#endif
#ifdef DT_SOCK
  printf("{\"fact\":\"constant\",\"of\":\"DT_SOCK\",\"value\":%lld}\n", (long long)(DT_SOCK));
#else
  printf("{\"fact\":\"constant\",\"of\":\"DT_SOCK\",\"value\":\"no macro of this name\"}\n");
#endif
#ifdef DT_UNKNOWN
  printf("{\"fact\":\"constant\",\"of\":\"DT_UNKNOWN\",\"value\":%lld}\n", (long long)(DT_UNKNOWN));
#else
  printf("{\"fact\":\"constant\",\"of\":\"DT_UNKNOWN\",\"value\":\"no macro of this name\"}\n");
#endif
#ifdef E2BIG
  printf("{\"fact\":\"constant\",\"of\":\"E2BIG\",\"value\":%lld}\n", (long long)(E2BIG));
#else
  printf("{\"fact\":\"constant\",\"of\":\"E2BIG\",\"value\":\"no macro of this name\"}\n");
#endif
#ifdef EACCES
  printf("{\"fact\":\"constant\",\"of\":\"EACCES\",\"value\":%lld}\n", (long long)(EACCES));
#else
  printf("{\"fact\":\"constant\",\"of\":\"EACCES\",\"value\":\"no macro of this name\"}\n");
#endif
#ifdef EADDRINUSE
  printf("{\"fact\":\"constant\",\"of\":\"EADDRINUSE\",\"value\":%lld}\n", (long long)(EADDRINUSE));
#else
  printf("{\"fact\":\"constant\",\"of\":\"EADDRINUSE\",\"value\":\"no macro of this name\"}\n");
#endif
#ifdef EADDRNOTAVAIL
  printf("{\"fact\":\"constant\",\"of\":\"EADDRNOTAVAIL\",\"value\":%lld}\n", (long long)(EADDRNOTAVAIL));
#else
  printf("{\"fact\":\"constant\",\"of\":\"EADDRNOTAVAIL\",\"value\":\"no macro of this name\"}\n");
#endif
#ifdef EAFNOSUPPORT
  printf("{\"fact\":\"constant\",\"of\":\"EAFNOSUPPORT\",\"value\":%lld}\n", (long long)(EAFNOSUPPORT));
#else
  printf("{\"fact\":\"constant\",\"of\":\"EAFNOSUPPORT\",\"value\":\"no macro of this name\"}\n");
#endif
#ifdef EAGAIN
  printf("{\"fact\":\"constant\",\"of\":\"EAGAIN\",\"value\":%lld}\n", (long long)(EAGAIN));
#else
  printf("{\"fact\":\"constant\",\"of\":\"EAGAIN\",\"value\":\"no macro of this name\"}\n");
#endif
#ifdef EALREADY
  printf("{\"fact\":\"constant\",\"of\":\"EALREADY\",\"value\":%lld}\n", (long long)(EALREADY));
#else
  printf("{\"fact\":\"constant\",\"of\":\"EALREADY\",\"value\":\"no macro of this name\"}\n");
#endif
#ifdef EAUTH
  printf("{\"fact\":\"constant\",\"of\":\"EAUTH\",\"value\":%lld}\n", (long long)(EAUTH));
#else
  printf("{\"fact\":\"constant\",\"of\":\"EAUTH\",\"value\":\"no macro of this name\"}\n");
#endif
#ifdef EBADARCH
  printf("{\"fact\":\"constant\",\"of\":\"EBADARCH\",\"value\":%lld}\n", (long long)(EBADARCH));
#else
  printf("{\"fact\":\"constant\",\"of\":\"EBADARCH\",\"value\":\"no macro of this name\"}\n");
#endif
#ifdef EBADEXEC
  printf("{\"fact\":\"constant\",\"of\":\"EBADEXEC\",\"value\":%lld}\n", (long long)(EBADEXEC));
#else
  printf("{\"fact\":\"constant\",\"of\":\"EBADEXEC\",\"value\":\"no macro of this name\"}\n");
#endif
#ifdef EBADF
  printf("{\"fact\":\"constant\",\"of\":\"EBADF\",\"value\":%lld}\n", (long long)(EBADF));
#else
  printf("{\"fact\":\"constant\",\"of\":\"EBADF\",\"value\":\"no macro of this name\"}\n");
#endif
#ifdef EBADMACHO
  printf("{\"fact\":\"constant\",\"of\":\"EBADMACHO\",\"value\":%lld}\n", (long long)(EBADMACHO));
#else
  printf("{\"fact\":\"constant\",\"of\":\"EBADMACHO\",\"value\":\"no macro of this name\"}\n");
#endif
#ifdef EBADMSG
  printf("{\"fact\":\"constant\",\"of\":\"EBADMSG\",\"value\":%lld}\n", (long long)(EBADMSG));
#else
  printf("{\"fact\":\"constant\",\"of\":\"EBADMSG\",\"value\":\"no macro of this name\"}\n");
#endif
#ifdef EBADRPC
  printf("{\"fact\":\"constant\",\"of\":\"EBADRPC\",\"value\":%lld}\n", (long long)(EBADRPC));
#else
  printf("{\"fact\":\"constant\",\"of\":\"EBADRPC\",\"value\":\"no macro of this name\"}\n");
#endif
#ifdef EBUSY
  printf("{\"fact\":\"constant\",\"of\":\"EBUSY\",\"value\":%lld}\n", (long long)(EBUSY));
#else
  printf("{\"fact\":\"constant\",\"of\":\"EBUSY\",\"value\":\"no macro of this name\"}\n");
#endif
#ifdef ECANCELED
  printf("{\"fact\":\"constant\",\"of\":\"ECANCELED\",\"value\":%lld}\n", (long long)(ECANCELED));
#else
  printf("{\"fact\":\"constant\",\"of\":\"ECANCELED\",\"value\":\"no macro of this name\"}\n");
#endif
#ifdef ECHILD
  printf("{\"fact\":\"constant\",\"of\":\"ECHILD\",\"value\":%lld}\n", (long long)(ECHILD));
#else
  printf("{\"fact\":\"constant\",\"of\":\"ECHILD\",\"value\":\"no macro of this name\"}\n");
#endif
#ifdef ECONNABORTED
  printf("{\"fact\":\"constant\",\"of\":\"ECONNABORTED\",\"value\":%lld}\n", (long long)(ECONNABORTED));
#else
  printf("{\"fact\":\"constant\",\"of\":\"ECONNABORTED\",\"value\":\"no macro of this name\"}\n");
#endif
#ifdef ECONNREFUSED
  printf("{\"fact\":\"constant\",\"of\":\"ECONNREFUSED\",\"value\":%lld}\n", (long long)(ECONNREFUSED));
#else
  printf("{\"fact\":\"constant\",\"of\":\"ECONNREFUSED\",\"value\":\"no macro of this name\"}\n");
#endif
#ifdef ECONNRESET
  printf("{\"fact\":\"constant\",\"of\":\"ECONNRESET\",\"value\":%lld}\n", (long long)(ECONNRESET));
#else
  printf("{\"fact\":\"constant\",\"of\":\"ECONNRESET\",\"value\":\"no macro of this name\"}\n");
#endif
#ifdef EDEADLK
  printf("{\"fact\":\"constant\",\"of\":\"EDEADLK\",\"value\":%lld}\n", (long long)(EDEADLK));
#else
  printf("{\"fact\":\"constant\",\"of\":\"EDEADLK\",\"value\":\"no macro of this name\"}\n");
#endif
#ifdef EDESTADDRREQ
  printf("{\"fact\":\"constant\",\"of\":\"EDESTADDRREQ\",\"value\":%lld}\n", (long long)(EDESTADDRREQ));
#else
  printf("{\"fact\":\"constant\",\"of\":\"EDESTADDRREQ\",\"value\":\"no macro of this name\"}\n");
#endif
#ifdef EDEVERR
  printf("{\"fact\":\"constant\",\"of\":\"EDEVERR\",\"value\":%lld}\n", (long long)(EDEVERR));
#else
  printf("{\"fact\":\"constant\",\"of\":\"EDEVERR\",\"value\":\"no macro of this name\"}\n");
#endif
#ifdef EDOM
  printf("{\"fact\":\"constant\",\"of\":\"EDOM\",\"value\":%lld}\n", (long long)(EDOM));
#else
  printf("{\"fact\":\"constant\",\"of\":\"EDOM\",\"value\":\"no macro of this name\"}\n");
#endif
#ifdef EDQUOT
  printf("{\"fact\":\"constant\",\"of\":\"EDQUOT\",\"value\":%lld}\n", (long long)(EDQUOT));
#else
  printf("{\"fact\":\"constant\",\"of\":\"EDQUOT\",\"value\":\"no macro of this name\"}\n");
#endif
#ifdef EEXIST
  printf("{\"fact\":\"constant\",\"of\":\"EEXIST\",\"value\":%lld}\n", (long long)(EEXIST));
#else
  printf("{\"fact\":\"constant\",\"of\":\"EEXIST\",\"value\":\"no macro of this name\"}\n");
#endif
#ifdef EFAULT
  printf("{\"fact\":\"constant\",\"of\":\"EFAULT\",\"value\":%lld}\n", (long long)(EFAULT));
#else
  printf("{\"fact\":\"constant\",\"of\":\"EFAULT\",\"value\":\"no macro of this name\"}\n");
#endif
#ifdef EFBIG
  printf("{\"fact\":\"constant\",\"of\":\"EFBIG\",\"value\":%lld}\n", (long long)(EFBIG));
#else
  printf("{\"fact\":\"constant\",\"of\":\"EFBIG\",\"value\":\"no macro of this name\"}\n");
#endif
#ifdef EFTYPE
  printf("{\"fact\":\"constant\",\"of\":\"EFTYPE\",\"value\":%lld}\n", (long long)(EFTYPE));
#else
  printf("{\"fact\":\"constant\",\"of\":\"EFTYPE\",\"value\":\"no macro of this name\"}\n");
#endif
#ifdef EHOSTDOWN
  printf("{\"fact\":\"constant\",\"of\":\"EHOSTDOWN\",\"value\":%lld}\n", (long long)(EHOSTDOWN));
#else
  printf("{\"fact\":\"constant\",\"of\":\"EHOSTDOWN\",\"value\":\"no macro of this name\"}\n");
#endif
#ifdef EHOSTUNREACH
  printf("{\"fact\":\"constant\",\"of\":\"EHOSTUNREACH\",\"value\":%lld}\n", (long long)(EHOSTUNREACH));
#else
  printf("{\"fact\":\"constant\",\"of\":\"EHOSTUNREACH\",\"value\":\"no macro of this name\"}\n");
#endif
#ifdef EIDRM
  printf("{\"fact\":\"constant\",\"of\":\"EIDRM\",\"value\":%lld}\n", (long long)(EIDRM));
#else
  printf("{\"fact\":\"constant\",\"of\":\"EIDRM\",\"value\":\"no macro of this name\"}\n");
#endif
#ifdef EILSEQ
  printf("{\"fact\":\"constant\",\"of\":\"EILSEQ\",\"value\":%lld}\n", (long long)(EILSEQ));
#else
  printf("{\"fact\":\"constant\",\"of\":\"EILSEQ\",\"value\":\"no macro of this name\"}\n");
#endif
#ifdef EINPROGRESS
  printf("{\"fact\":\"constant\",\"of\":\"EINPROGRESS\",\"value\":%lld}\n", (long long)(EINPROGRESS));
#else
  printf("{\"fact\":\"constant\",\"of\":\"EINPROGRESS\",\"value\":\"no macro of this name\"}\n");
#endif
#ifdef EINTR
  printf("{\"fact\":\"constant\",\"of\":\"EINTR\",\"value\":%lld}\n", (long long)(EINTR));
#else
  printf("{\"fact\":\"constant\",\"of\":\"EINTR\",\"value\":\"no macro of this name\"}\n");
#endif
#ifdef EINVAL
  printf("{\"fact\":\"constant\",\"of\":\"EINVAL\",\"value\":%lld}\n", (long long)(EINVAL));
#else
  printf("{\"fact\":\"constant\",\"of\":\"EINVAL\",\"value\":\"no macro of this name\"}\n");
#endif
#ifdef EIO
  printf("{\"fact\":\"constant\",\"of\":\"EIO\",\"value\":%lld}\n", (long long)(EIO));
#else
  printf("{\"fact\":\"constant\",\"of\":\"EIO\",\"value\":\"no macro of this name\"}\n");
#endif
#ifdef EISCONN
  printf("{\"fact\":\"constant\",\"of\":\"EISCONN\",\"value\":%lld}\n", (long long)(EISCONN));
#else
  printf("{\"fact\":\"constant\",\"of\":\"EISCONN\",\"value\":\"no macro of this name\"}\n");
#endif
#ifdef EISDIR
  printf("{\"fact\":\"constant\",\"of\":\"EISDIR\",\"value\":%lld}\n", (long long)(EISDIR));
#else
  printf("{\"fact\":\"constant\",\"of\":\"EISDIR\",\"value\":\"no macro of this name\"}\n");
#endif
#ifdef ELOOP
  printf("{\"fact\":\"constant\",\"of\":\"ELOOP\",\"value\":%lld}\n", (long long)(ELOOP));
#else
  printf("{\"fact\":\"constant\",\"of\":\"ELOOP\",\"value\":\"no macro of this name\"}\n");
#endif
#ifdef EMFILE
  printf("{\"fact\":\"constant\",\"of\":\"EMFILE\",\"value\":%lld}\n", (long long)(EMFILE));
#else
  printf("{\"fact\":\"constant\",\"of\":\"EMFILE\",\"value\":\"no macro of this name\"}\n");
#endif
#ifdef EMLINK
  printf("{\"fact\":\"constant\",\"of\":\"EMLINK\",\"value\":%lld}\n", (long long)(EMLINK));
#else
  printf("{\"fact\":\"constant\",\"of\":\"EMLINK\",\"value\":\"no macro of this name\"}\n");
#endif
#ifdef EMSGSIZE
  printf("{\"fact\":\"constant\",\"of\":\"EMSGSIZE\",\"value\":%lld}\n", (long long)(EMSGSIZE));
#else
  printf("{\"fact\":\"constant\",\"of\":\"EMSGSIZE\",\"value\":\"no macro of this name\"}\n");
#endif
#ifdef EMULTIHOP
  printf("{\"fact\":\"constant\",\"of\":\"EMULTIHOP\",\"value\":%lld}\n", (long long)(EMULTIHOP));
#else
  printf("{\"fact\":\"constant\",\"of\":\"EMULTIHOP\",\"value\":\"no macro of this name\"}\n");
#endif
#ifdef ENAMETOOLONG
  printf("{\"fact\":\"constant\",\"of\":\"ENAMETOOLONG\",\"value\":%lld}\n", (long long)(ENAMETOOLONG));
#else
  printf("{\"fact\":\"constant\",\"of\":\"ENAMETOOLONG\",\"value\":\"no macro of this name\"}\n");
#endif
#ifdef ENEEDAUTH
  printf("{\"fact\":\"constant\",\"of\":\"ENEEDAUTH\",\"value\":%lld}\n", (long long)(ENEEDAUTH));
#else
  printf("{\"fact\":\"constant\",\"of\":\"ENEEDAUTH\",\"value\":\"no macro of this name\"}\n");
#endif
#ifdef ENETDOWN
  printf("{\"fact\":\"constant\",\"of\":\"ENETDOWN\",\"value\":%lld}\n", (long long)(ENETDOWN));
#else
  printf("{\"fact\":\"constant\",\"of\":\"ENETDOWN\",\"value\":\"no macro of this name\"}\n");
#endif
#ifdef ENETRESET
  printf("{\"fact\":\"constant\",\"of\":\"ENETRESET\",\"value\":%lld}\n", (long long)(ENETRESET));
#else
  printf("{\"fact\":\"constant\",\"of\":\"ENETRESET\",\"value\":\"no macro of this name\"}\n");
#endif
#ifdef ENETUNREACH
  printf("{\"fact\":\"constant\",\"of\":\"ENETUNREACH\",\"value\":%lld}\n", (long long)(ENETUNREACH));
#else
  printf("{\"fact\":\"constant\",\"of\":\"ENETUNREACH\",\"value\":\"no macro of this name\"}\n");
#endif
#ifdef ENFILE
  printf("{\"fact\":\"constant\",\"of\":\"ENFILE\",\"value\":%lld}\n", (long long)(ENFILE));
#else
  printf("{\"fact\":\"constant\",\"of\":\"ENFILE\",\"value\":\"no macro of this name\"}\n");
#endif
#ifdef ENOATTR
  printf("{\"fact\":\"constant\",\"of\":\"ENOATTR\",\"value\":%lld}\n", (long long)(ENOATTR));
#else
  printf("{\"fact\":\"constant\",\"of\":\"ENOATTR\",\"value\":\"no macro of this name\"}\n");
#endif
#ifdef ENOBUFS
  printf("{\"fact\":\"constant\",\"of\":\"ENOBUFS\",\"value\":%lld}\n", (long long)(ENOBUFS));
#else
  printf("{\"fact\":\"constant\",\"of\":\"ENOBUFS\",\"value\":\"no macro of this name\"}\n");
#endif
#ifdef ENODATA
  printf("{\"fact\":\"constant\",\"of\":\"ENODATA\",\"value\":%lld}\n", (long long)(ENODATA));
#else
  printf("{\"fact\":\"constant\",\"of\":\"ENODATA\",\"value\":\"no macro of this name\"}\n");
#endif
#ifdef ENODEV
  printf("{\"fact\":\"constant\",\"of\":\"ENODEV\",\"value\":%lld}\n", (long long)(ENODEV));
#else
  printf("{\"fact\":\"constant\",\"of\":\"ENODEV\",\"value\":\"no macro of this name\"}\n");
#endif
#ifdef ENOENT
  printf("{\"fact\":\"constant\",\"of\":\"ENOENT\",\"value\":%lld}\n", (long long)(ENOENT));
#else
  printf("{\"fact\":\"constant\",\"of\":\"ENOENT\",\"value\":\"no macro of this name\"}\n");
#endif
#ifdef ENOEXEC
  printf("{\"fact\":\"constant\",\"of\":\"ENOEXEC\",\"value\":%lld}\n", (long long)(ENOEXEC));
#else
  printf("{\"fact\":\"constant\",\"of\":\"ENOEXEC\",\"value\":\"no macro of this name\"}\n");
#endif
#ifdef ENOLCK
  printf("{\"fact\":\"constant\",\"of\":\"ENOLCK\",\"value\":%lld}\n", (long long)(ENOLCK));
#else
  printf("{\"fact\":\"constant\",\"of\":\"ENOLCK\",\"value\":\"no macro of this name\"}\n");
#endif
#ifdef ENOLINK
  printf("{\"fact\":\"constant\",\"of\":\"ENOLINK\",\"value\":%lld}\n", (long long)(ENOLINK));
#else
  printf("{\"fact\":\"constant\",\"of\":\"ENOLINK\",\"value\":\"no macro of this name\"}\n");
#endif
#ifdef ENOMEM
  printf("{\"fact\":\"constant\",\"of\":\"ENOMEM\",\"value\":%lld}\n", (long long)(ENOMEM));
#else
  printf("{\"fact\":\"constant\",\"of\":\"ENOMEM\",\"value\":\"no macro of this name\"}\n");
#endif
#ifdef ENOMSG
  printf("{\"fact\":\"constant\",\"of\":\"ENOMSG\",\"value\":%lld}\n", (long long)(ENOMSG));
#else
  printf("{\"fact\":\"constant\",\"of\":\"ENOMSG\",\"value\":\"no macro of this name\"}\n");
#endif
#ifdef ENOPOLICY
  printf("{\"fact\":\"constant\",\"of\":\"ENOPOLICY\",\"value\":%lld}\n", (long long)(ENOPOLICY));
#else
  printf("{\"fact\":\"constant\",\"of\":\"ENOPOLICY\",\"value\":\"no macro of this name\"}\n");
#endif
#ifdef ENOPROTOOPT
  printf("{\"fact\":\"constant\",\"of\":\"ENOPROTOOPT\",\"value\":%lld}\n", (long long)(ENOPROTOOPT));
#else
  printf("{\"fact\":\"constant\",\"of\":\"ENOPROTOOPT\",\"value\":\"no macro of this name\"}\n");
#endif
#ifdef ENOSPC
  printf("{\"fact\":\"constant\",\"of\":\"ENOSPC\",\"value\":%lld}\n", (long long)(ENOSPC));
#else
  printf("{\"fact\":\"constant\",\"of\":\"ENOSPC\",\"value\":\"no macro of this name\"}\n");
#endif
#ifdef ENOSR
  printf("{\"fact\":\"constant\",\"of\":\"ENOSR\",\"value\":%lld}\n", (long long)(ENOSR));
#else
  printf("{\"fact\":\"constant\",\"of\":\"ENOSR\",\"value\":\"no macro of this name\"}\n");
#endif
#ifdef ENOSTR
  printf("{\"fact\":\"constant\",\"of\":\"ENOSTR\",\"value\":%lld}\n", (long long)(ENOSTR));
#else
  printf("{\"fact\":\"constant\",\"of\":\"ENOSTR\",\"value\":\"no macro of this name\"}\n");
#endif
#ifdef ENOSYS
  printf("{\"fact\":\"constant\",\"of\":\"ENOSYS\",\"value\":%lld}\n", (long long)(ENOSYS));
#else
  printf("{\"fact\":\"constant\",\"of\":\"ENOSYS\",\"value\":\"no macro of this name\"}\n");
#endif
#ifdef ENOTBLK
  printf("{\"fact\":\"constant\",\"of\":\"ENOTBLK\",\"value\":%lld}\n", (long long)(ENOTBLK));
#else
  printf("{\"fact\":\"constant\",\"of\":\"ENOTBLK\",\"value\":\"no macro of this name\"}\n");
#endif
#ifdef ENOTCONN
  printf("{\"fact\":\"constant\",\"of\":\"ENOTCONN\",\"value\":%lld}\n", (long long)(ENOTCONN));
#else
  printf("{\"fact\":\"constant\",\"of\":\"ENOTCONN\",\"value\":\"no macro of this name\"}\n");
#endif
#ifdef ENOTDIR
  printf("{\"fact\":\"constant\",\"of\":\"ENOTDIR\",\"value\":%lld}\n", (long long)(ENOTDIR));
#else
  printf("{\"fact\":\"constant\",\"of\":\"ENOTDIR\",\"value\":\"no macro of this name\"}\n");
#endif
#ifdef ENOTEMPTY
  printf("{\"fact\":\"constant\",\"of\":\"ENOTEMPTY\",\"value\":%lld}\n", (long long)(ENOTEMPTY));
#else
  printf("{\"fact\":\"constant\",\"of\":\"ENOTEMPTY\",\"value\":\"no macro of this name\"}\n");
#endif
#ifdef ENOTRECOVERABLE
  printf("{\"fact\":\"constant\",\"of\":\"ENOTRECOVERABLE\",\"value\":%lld}\n", (long long)(ENOTRECOVERABLE));
#else
  printf("{\"fact\":\"constant\",\"of\":\"ENOTRECOVERABLE\",\"value\":\"no macro of this name\"}\n");
#endif
#ifdef ENOTSOCK
  printf("{\"fact\":\"constant\",\"of\":\"ENOTSOCK\",\"value\":%lld}\n", (long long)(ENOTSOCK));
#else
  printf("{\"fact\":\"constant\",\"of\":\"ENOTSOCK\",\"value\":\"no macro of this name\"}\n");
#endif
#ifdef ENOTSUP
  printf("{\"fact\":\"constant\",\"of\":\"ENOTSUP\",\"value\":%lld}\n", (long long)(ENOTSUP));
#else
  printf("{\"fact\":\"constant\",\"of\":\"ENOTSUP\",\"value\":\"no macro of this name\"}\n");
#endif
#ifdef ENOTTY
  printf("{\"fact\":\"constant\",\"of\":\"ENOTTY\",\"value\":%lld}\n", (long long)(ENOTTY));
#else
  printf("{\"fact\":\"constant\",\"of\":\"ENOTTY\",\"value\":\"no macro of this name\"}\n");
#endif
#ifdef ENXIO
  printf("{\"fact\":\"constant\",\"of\":\"ENXIO\",\"value\":%lld}\n", (long long)(ENXIO));
#else
  printf("{\"fact\":\"constant\",\"of\":\"ENXIO\",\"value\":\"no macro of this name\"}\n");
#endif
#ifdef EOPNOTSUPP
  printf("{\"fact\":\"constant\",\"of\":\"EOPNOTSUPP\",\"value\":%lld}\n", (long long)(EOPNOTSUPP));
#else
  printf("{\"fact\":\"constant\",\"of\":\"EOPNOTSUPP\",\"value\":\"no macro of this name\"}\n");
#endif
#ifdef EOVERFLOW
  printf("{\"fact\":\"constant\",\"of\":\"EOVERFLOW\",\"value\":%lld}\n", (long long)(EOVERFLOW));
#else
  printf("{\"fact\":\"constant\",\"of\":\"EOVERFLOW\",\"value\":\"no macro of this name\"}\n");
#endif
#ifdef EOWNERDEAD
  printf("{\"fact\":\"constant\",\"of\":\"EOWNERDEAD\",\"value\":%lld}\n", (long long)(EOWNERDEAD));
#else
  printf("{\"fact\":\"constant\",\"of\":\"EOWNERDEAD\",\"value\":\"no macro of this name\"}\n");
#endif
#ifdef EPERM
  printf("{\"fact\":\"constant\",\"of\":\"EPERM\",\"value\":%lld}\n", (long long)(EPERM));
#else
  printf("{\"fact\":\"constant\",\"of\":\"EPERM\",\"value\":\"no macro of this name\"}\n");
#endif
#ifdef EPFNOSUPPORT
  printf("{\"fact\":\"constant\",\"of\":\"EPFNOSUPPORT\",\"value\":%lld}\n", (long long)(EPFNOSUPPORT));
#else
  printf("{\"fact\":\"constant\",\"of\":\"EPFNOSUPPORT\",\"value\":\"no macro of this name\"}\n");
#endif
#ifdef EPIPE
  printf("{\"fact\":\"constant\",\"of\":\"EPIPE\",\"value\":%lld}\n", (long long)(EPIPE));
#else
  printf("{\"fact\":\"constant\",\"of\":\"EPIPE\",\"value\":\"no macro of this name\"}\n");
#endif
#ifdef EPROCLIM
  printf("{\"fact\":\"constant\",\"of\":\"EPROCLIM\",\"value\":%lld}\n", (long long)(EPROCLIM));
#else
  printf("{\"fact\":\"constant\",\"of\":\"EPROCLIM\",\"value\":\"no macro of this name\"}\n");
#endif
#ifdef EPROCUNAVAIL
  printf("{\"fact\":\"constant\",\"of\":\"EPROCUNAVAIL\",\"value\":%lld}\n", (long long)(EPROCUNAVAIL));
#else
  printf("{\"fact\":\"constant\",\"of\":\"EPROCUNAVAIL\",\"value\":\"no macro of this name\"}\n");
#endif
#ifdef EPROGMISMATCH
  printf("{\"fact\":\"constant\",\"of\":\"EPROGMISMATCH\",\"value\":%lld}\n", (long long)(EPROGMISMATCH));
#else
  printf("{\"fact\":\"constant\",\"of\":\"EPROGMISMATCH\",\"value\":\"no macro of this name\"}\n");
#endif
#ifdef EPROGUNAVAIL
  printf("{\"fact\":\"constant\",\"of\":\"EPROGUNAVAIL\",\"value\":%lld}\n", (long long)(EPROGUNAVAIL));
#else
  printf("{\"fact\":\"constant\",\"of\":\"EPROGUNAVAIL\",\"value\":\"no macro of this name\"}\n");
#endif
#ifdef EPROTO
  printf("{\"fact\":\"constant\",\"of\":\"EPROTO\",\"value\":%lld}\n", (long long)(EPROTO));
#else
  printf("{\"fact\":\"constant\",\"of\":\"EPROTO\",\"value\":\"no macro of this name\"}\n");
#endif
#ifdef EPROTONOSUPPORT
  printf("{\"fact\":\"constant\",\"of\":\"EPROTONOSUPPORT\",\"value\":%lld}\n", (long long)(EPROTONOSUPPORT));
#else
  printf("{\"fact\":\"constant\",\"of\":\"EPROTONOSUPPORT\",\"value\":\"no macro of this name\"}\n");
#endif
#ifdef EPROTOTYPE
  printf("{\"fact\":\"constant\",\"of\":\"EPROTOTYPE\",\"value\":%lld}\n", (long long)(EPROTOTYPE));
#else
  printf("{\"fact\":\"constant\",\"of\":\"EPROTOTYPE\",\"value\":\"no macro of this name\"}\n");
#endif
#ifdef EPWROFF
  printf("{\"fact\":\"constant\",\"of\":\"EPWROFF\",\"value\":%lld}\n", (long long)(EPWROFF));
#else
  printf("{\"fact\":\"constant\",\"of\":\"EPWROFF\",\"value\":\"no macro of this name\"}\n");
#endif
#ifdef EQFULL
  printf("{\"fact\":\"constant\",\"of\":\"EQFULL\",\"value\":%lld}\n", (long long)(EQFULL));
#else
  printf("{\"fact\":\"constant\",\"of\":\"EQFULL\",\"value\":\"no macro of this name\"}\n");
#endif
#ifdef ERANGE
  printf("{\"fact\":\"constant\",\"of\":\"ERANGE\",\"value\":%lld}\n", (long long)(ERANGE));
#else
  printf("{\"fact\":\"constant\",\"of\":\"ERANGE\",\"value\":\"no macro of this name\"}\n");
#endif
#ifdef EREMOTE
  printf("{\"fact\":\"constant\",\"of\":\"EREMOTE\",\"value\":%lld}\n", (long long)(EREMOTE));
#else
  printf("{\"fact\":\"constant\",\"of\":\"EREMOTE\",\"value\":\"no macro of this name\"}\n");
#endif
#ifdef EROFS
  printf("{\"fact\":\"constant\",\"of\":\"EROFS\",\"value\":%lld}\n", (long long)(EROFS));
#else
  printf("{\"fact\":\"constant\",\"of\":\"EROFS\",\"value\":\"no macro of this name\"}\n");
#endif
#ifdef ERPCMISMATCH
  printf("{\"fact\":\"constant\",\"of\":\"ERPCMISMATCH\",\"value\":%lld}\n", (long long)(ERPCMISMATCH));
#else
  printf("{\"fact\":\"constant\",\"of\":\"ERPCMISMATCH\",\"value\":\"no macro of this name\"}\n");
#endif
#ifdef ESHLIBVERS
  printf("{\"fact\":\"constant\",\"of\":\"ESHLIBVERS\",\"value\":%lld}\n", (long long)(ESHLIBVERS));
#else
  printf("{\"fact\":\"constant\",\"of\":\"ESHLIBVERS\",\"value\":\"no macro of this name\"}\n");
#endif
#ifdef ESHUTDOWN
  printf("{\"fact\":\"constant\",\"of\":\"ESHUTDOWN\",\"value\":%lld}\n", (long long)(ESHUTDOWN));
#else
  printf("{\"fact\":\"constant\",\"of\":\"ESHUTDOWN\",\"value\":\"no macro of this name\"}\n");
#endif
#ifdef ESOCKTNOSUPPORT
  printf("{\"fact\":\"constant\",\"of\":\"ESOCKTNOSUPPORT\",\"value\":%lld}\n", (long long)(ESOCKTNOSUPPORT));
#else
  printf("{\"fact\":\"constant\",\"of\":\"ESOCKTNOSUPPORT\",\"value\":\"no macro of this name\"}\n");
#endif
#ifdef ESPIPE
  printf("{\"fact\":\"constant\",\"of\":\"ESPIPE\",\"value\":%lld}\n", (long long)(ESPIPE));
#else
  printf("{\"fact\":\"constant\",\"of\":\"ESPIPE\",\"value\":\"no macro of this name\"}\n");
#endif
#ifdef ESRCH
  printf("{\"fact\":\"constant\",\"of\":\"ESRCH\",\"value\":%lld}\n", (long long)(ESRCH));
#else
  printf("{\"fact\":\"constant\",\"of\":\"ESRCH\",\"value\":\"no macro of this name\"}\n");
#endif
#ifdef ESTALE
  printf("{\"fact\":\"constant\",\"of\":\"ESTALE\",\"value\":%lld}\n", (long long)(ESTALE));
#else
  printf("{\"fact\":\"constant\",\"of\":\"ESTALE\",\"value\":\"no macro of this name\"}\n");
#endif
#ifdef ETIME
  printf("{\"fact\":\"constant\",\"of\":\"ETIME\",\"value\":%lld}\n", (long long)(ETIME));
#else
  printf("{\"fact\":\"constant\",\"of\":\"ETIME\",\"value\":\"no macro of this name\"}\n");
#endif
#ifdef ETIMEDOUT
  printf("{\"fact\":\"constant\",\"of\":\"ETIMEDOUT\",\"value\":%lld}\n", (long long)(ETIMEDOUT));
#else
  printf("{\"fact\":\"constant\",\"of\":\"ETIMEDOUT\",\"value\":\"no macro of this name\"}\n");
#endif
#ifdef ETOOMANYREFS
  printf("{\"fact\":\"constant\",\"of\":\"ETOOMANYREFS\",\"value\":%lld}\n", (long long)(ETOOMANYREFS));
#else
  printf("{\"fact\":\"constant\",\"of\":\"ETOOMANYREFS\",\"value\":\"no macro of this name\"}\n");
#endif
#ifdef ETXTBSY
  printf("{\"fact\":\"constant\",\"of\":\"ETXTBSY\",\"value\":%lld}\n", (long long)(ETXTBSY));
#else
  printf("{\"fact\":\"constant\",\"of\":\"ETXTBSY\",\"value\":\"no macro of this name\"}\n");
#endif
#ifdef EUSERS
  printf("{\"fact\":\"constant\",\"of\":\"EUSERS\",\"value\":%lld}\n", (long long)(EUSERS));
#else
  printf("{\"fact\":\"constant\",\"of\":\"EUSERS\",\"value\":\"no macro of this name\"}\n");
#endif
#ifdef EV_ADD
  printf("{\"fact\":\"constant\",\"of\":\"EV_ADD\",\"value\":%lld}\n", (long long)(EV_ADD));
#else
  printf("{\"fact\":\"constant\",\"of\":\"EV_ADD\",\"value\":\"no macro of this name\"}\n");
#endif
#ifdef EV_CLEAR
  printf("{\"fact\":\"constant\",\"of\":\"EV_CLEAR\",\"value\":%lld}\n", (long long)(EV_CLEAR));
#else
  printf("{\"fact\":\"constant\",\"of\":\"EV_CLEAR\",\"value\":\"no macro of this name\"}\n");
#endif
#ifdef EV_DELETE
  printf("{\"fact\":\"constant\",\"of\":\"EV_DELETE\",\"value\":%lld}\n", (long long)(EV_DELETE));
#else
  printf("{\"fact\":\"constant\",\"of\":\"EV_DELETE\",\"value\":\"no macro of this name\"}\n");
#endif
#ifdef EV_DISABLE
  printf("{\"fact\":\"constant\",\"of\":\"EV_DISABLE\",\"value\":%lld}\n", (long long)(EV_DISABLE));
#else
  printf("{\"fact\":\"constant\",\"of\":\"EV_DISABLE\",\"value\":\"no macro of this name\"}\n");
#endif
#ifdef EV_DISPATCH
  printf("{\"fact\":\"constant\",\"of\":\"EV_DISPATCH\",\"value\":%lld}\n", (long long)(EV_DISPATCH));
#else
  printf("{\"fact\":\"constant\",\"of\":\"EV_DISPATCH\",\"value\":\"no macro of this name\"}\n");
#endif
#ifdef EV_ENABLE
  printf("{\"fact\":\"constant\",\"of\":\"EV_ENABLE\",\"value\":%lld}\n", (long long)(EV_ENABLE));
#else
  printf("{\"fact\":\"constant\",\"of\":\"EV_ENABLE\",\"value\":\"no macro of this name\"}\n");
#endif
#ifdef EV_EOF
  printf("{\"fact\":\"constant\",\"of\":\"EV_EOF\",\"value\":%lld}\n", (long long)(EV_EOF));
#else
  printf("{\"fact\":\"constant\",\"of\":\"EV_EOF\",\"value\":\"no macro of this name\"}\n");
#endif
#ifdef EV_ERROR
  printf("{\"fact\":\"constant\",\"of\":\"EV_ERROR\",\"value\":%lld}\n", (long long)(EV_ERROR));
#else
  printf("{\"fact\":\"constant\",\"of\":\"EV_ERROR\",\"value\":\"no macro of this name\"}\n");
#endif
#ifdef EV_ONESHOT
  printf("{\"fact\":\"constant\",\"of\":\"EV_ONESHOT\",\"value\":%lld}\n", (long long)(EV_ONESHOT));
#else
  printf("{\"fact\":\"constant\",\"of\":\"EV_ONESHOT\",\"value\":\"no macro of this name\"}\n");
#endif
#ifdef EV_RECEIPT
  printf("{\"fact\":\"constant\",\"of\":\"EV_RECEIPT\",\"value\":%lld}\n", (long long)(EV_RECEIPT));
#else
  printf("{\"fact\":\"constant\",\"of\":\"EV_RECEIPT\",\"value\":\"no macro of this name\"}\n");
#endif
#ifdef EVFILT_MACHPORT
  printf("{\"fact\":\"constant\",\"of\":\"EVFILT_MACHPORT\",\"value\":%lld}\n", (long long)(EVFILT_MACHPORT));
#else
  printf("{\"fact\":\"constant\",\"of\":\"EVFILT_MACHPORT\",\"value\":\"no macro of this name\"}\n");
#endif
#ifdef EVFILT_PROC
  printf("{\"fact\":\"constant\",\"of\":\"EVFILT_PROC\",\"value\":%lld}\n", (long long)(EVFILT_PROC));
#else
  printf("{\"fact\":\"constant\",\"of\":\"EVFILT_PROC\",\"value\":\"no macro of this name\"}\n");
#endif
#ifdef EVFILT_READ
  printf("{\"fact\":\"constant\",\"of\":\"EVFILT_READ\",\"value\":%lld}\n", (long long)(EVFILT_READ));
#else
  printf("{\"fact\":\"constant\",\"of\":\"EVFILT_READ\",\"value\":\"no macro of this name\"}\n");
#endif
#ifdef EVFILT_SIGNAL
  printf("{\"fact\":\"constant\",\"of\":\"EVFILT_SIGNAL\",\"value\":%lld}\n", (long long)(EVFILT_SIGNAL));
#else
  printf("{\"fact\":\"constant\",\"of\":\"EVFILT_SIGNAL\",\"value\":\"no macro of this name\"}\n");
#endif
#ifdef EVFILT_TIMER
  printf("{\"fact\":\"constant\",\"of\":\"EVFILT_TIMER\",\"value\":%lld}\n", (long long)(EVFILT_TIMER));
#else
  printf("{\"fact\":\"constant\",\"of\":\"EVFILT_TIMER\",\"value\":\"no macro of this name\"}\n");
#endif
#ifdef EVFILT_USER
  printf("{\"fact\":\"constant\",\"of\":\"EVFILT_USER\",\"value\":%lld}\n", (long long)(EVFILT_USER));
#else
  printf("{\"fact\":\"constant\",\"of\":\"EVFILT_USER\",\"value\":\"no macro of this name\"}\n");
#endif
#ifdef EVFILT_VNODE
  printf("{\"fact\":\"constant\",\"of\":\"EVFILT_VNODE\",\"value\":%lld}\n", (long long)(EVFILT_VNODE));
#else
  printf("{\"fact\":\"constant\",\"of\":\"EVFILT_VNODE\",\"value\":\"no macro of this name\"}\n");
#endif
#ifdef EVFILT_WRITE
  printf("{\"fact\":\"constant\",\"of\":\"EVFILT_WRITE\",\"value\":%lld}\n", (long long)(EVFILT_WRITE));
#else
  printf("{\"fact\":\"constant\",\"of\":\"EVFILT_WRITE\",\"value\":\"no macro of this name\"}\n");
#endif
#ifdef EWOULDBLOCK
  printf("{\"fact\":\"constant\",\"of\":\"EWOULDBLOCK\",\"value\":%lld}\n", (long long)(EWOULDBLOCK));
#else
  printf("{\"fact\":\"constant\",\"of\":\"EWOULDBLOCK\",\"value\":\"no macro of this name\"}\n");
#endif
#ifdef EXDEV
  printf("{\"fact\":\"constant\",\"of\":\"EXDEV\",\"value\":%lld}\n", (long long)(EXDEV));
#else
  printf("{\"fact\":\"constant\",\"of\":\"EXDEV\",\"value\":\"no macro of this name\"}\n");
#endif
#ifdef F_ALLOCATEALL
  printf("{\"fact\":\"constant\",\"of\":\"F_ALLOCATEALL\",\"value\":%lld}\n", (long long)(F_ALLOCATEALL));
#else
  printf("{\"fact\":\"constant\",\"of\":\"F_ALLOCATEALL\",\"value\":\"no macro of this name\"}\n");
#endif
#ifdef F_ALLOCATECONTIG
  printf("{\"fact\":\"constant\",\"of\":\"F_ALLOCATECONTIG\",\"value\":%lld}\n", (long long)(F_ALLOCATECONTIG));
#else
  printf("{\"fact\":\"constant\",\"of\":\"F_ALLOCATECONTIG\",\"value\":\"no macro of this name\"}\n");
#endif
#ifdef F_BARRIERFSYNC
  printf("{\"fact\":\"constant\",\"of\":\"F_BARRIERFSYNC\",\"value\":%lld}\n", (long long)(F_BARRIERFSYNC));
#else
  printf("{\"fact\":\"constant\",\"of\":\"F_BARRIERFSYNC\",\"value\":\"no macro of this name\"}\n");
#endif
#ifdef F_DUPFD
  printf("{\"fact\":\"constant\",\"of\":\"F_DUPFD\",\"value\":%lld}\n", (long long)(F_DUPFD));
#else
  printf("{\"fact\":\"constant\",\"of\":\"F_DUPFD\",\"value\":\"no macro of this name\"}\n");
#endif
#ifdef F_DUPFD_CLOEXEC
  printf("{\"fact\":\"constant\",\"of\":\"F_DUPFD_CLOEXEC\",\"value\":%lld}\n", (long long)(F_DUPFD_CLOEXEC));
#else
  printf("{\"fact\":\"constant\",\"of\":\"F_DUPFD_CLOEXEC\",\"value\":\"no macro of this name\"}\n");
#endif
#ifdef F_FULLFSYNC
  printf("{\"fact\":\"constant\",\"of\":\"F_FULLFSYNC\",\"value\":%lld}\n", (long long)(F_FULLFSYNC));
#else
  printf("{\"fact\":\"constant\",\"of\":\"F_FULLFSYNC\",\"value\":\"no macro of this name\"}\n");
#endif
#ifdef F_GETFD
  printf("{\"fact\":\"constant\",\"of\":\"F_GETFD\",\"value\":%lld}\n", (long long)(F_GETFD));
#else
  printf("{\"fact\":\"constant\",\"of\":\"F_GETFD\",\"value\":\"no macro of this name\"}\n");
#endif
#ifdef F_GETFL
  printf("{\"fact\":\"constant\",\"of\":\"F_GETFL\",\"value\":%lld}\n", (long long)(F_GETFL));
#else
  printf("{\"fact\":\"constant\",\"of\":\"F_GETFL\",\"value\":\"no macro of this name\"}\n");
#endif
#ifdef F_GETLK
  printf("{\"fact\":\"constant\",\"of\":\"F_GETLK\",\"value\":%lld}\n", (long long)(F_GETLK));
#else
  printf("{\"fact\":\"constant\",\"of\":\"F_GETLK\",\"value\":\"no macro of this name\"}\n");
#endif
#ifdef F_GETPATH
  printf("{\"fact\":\"constant\",\"of\":\"F_GETPATH\",\"value\":%lld}\n", (long long)(F_GETPATH));
#else
  printf("{\"fact\":\"constant\",\"of\":\"F_GETPATH\",\"value\":\"no macro of this name\"}\n");
#endif
#ifdef F_GETPATH_NOFIRMLINK
  printf("{\"fact\":\"constant\",\"of\":\"F_GETPATH_NOFIRMLINK\",\"value\":%lld}\n", (long long)(F_GETPATH_NOFIRMLINK));
#else
  printf("{\"fact\":\"constant\",\"of\":\"F_GETPATH_NOFIRMLINK\",\"value\":\"no macro of this name\"}\n");
#endif
#ifdef F_NOCACHE
  printf("{\"fact\":\"constant\",\"of\":\"F_NOCACHE\",\"value\":%lld}\n", (long long)(F_NOCACHE));
#else
  printf("{\"fact\":\"constant\",\"of\":\"F_NOCACHE\",\"value\":\"no macro of this name\"}\n");
#endif
#ifdef F_OK
  printf("{\"fact\":\"constant\",\"of\":\"F_OK\",\"value\":%lld}\n", (long long)(F_OK));
#else
  printf("{\"fact\":\"constant\",\"of\":\"F_OK\",\"value\":\"no macro of this name\"}\n");
#endif
#ifdef F_PEOFPOSMODE
  printf("{\"fact\":\"constant\",\"of\":\"F_PEOFPOSMODE\",\"value\":%lld}\n", (long long)(F_PEOFPOSMODE));
#else
  printf("{\"fact\":\"constant\",\"of\":\"F_PEOFPOSMODE\",\"value\":\"no macro of this name\"}\n");
#endif
#ifdef F_PREALLOCATE
  printf("{\"fact\":\"constant\",\"of\":\"F_PREALLOCATE\",\"value\":%lld}\n", (long long)(F_PREALLOCATE));
#else
  printf("{\"fact\":\"constant\",\"of\":\"F_PREALLOCATE\",\"value\":\"no macro of this name\"}\n");
#endif
#ifdef F_RDADVISE
  printf("{\"fact\":\"constant\",\"of\":\"F_RDADVISE\",\"value\":%lld}\n", (long long)(F_RDADVISE));
#else
  printf("{\"fact\":\"constant\",\"of\":\"F_RDADVISE\",\"value\":\"no macro of this name\"}\n");
#endif
#ifdef F_RDAHEAD
  printf("{\"fact\":\"constant\",\"of\":\"F_RDAHEAD\",\"value\":%lld}\n", (long long)(F_RDAHEAD));
#else
  printf("{\"fact\":\"constant\",\"of\":\"F_RDAHEAD\",\"value\":\"no macro of this name\"}\n");
#endif
#ifdef F_RDLCK
  printf("{\"fact\":\"constant\",\"of\":\"F_RDLCK\",\"value\":%lld}\n", (long long)(F_RDLCK));
#else
  printf("{\"fact\":\"constant\",\"of\":\"F_RDLCK\",\"value\":\"no macro of this name\"}\n");
#endif
#ifdef F_SETFD
  printf("{\"fact\":\"constant\",\"of\":\"F_SETFD\",\"value\":%lld}\n", (long long)(F_SETFD));
#else
  printf("{\"fact\":\"constant\",\"of\":\"F_SETFD\",\"value\":\"no macro of this name\"}\n");
#endif
#ifdef F_SETFL
  printf("{\"fact\":\"constant\",\"of\":\"F_SETFL\",\"value\":%lld}\n", (long long)(F_SETFL));
#else
  printf("{\"fact\":\"constant\",\"of\":\"F_SETFL\",\"value\":\"no macro of this name\"}\n");
#endif
#ifdef F_SETLK
  printf("{\"fact\":\"constant\",\"of\":\"F_SETLK\",\"value\":%lld}\n", (long long)(F_SETLK));
#else
  printf("{\"fact\":\"constant\",\"of\":\"F_SETLK\",\"value\":\"no macro of this name\"}\n");
#endif
#ifdef F_SETLKW
  printf("{\"fact\":\"constant\",\"of\":\"F_SETLKW\",\"value\":%lld}\n", (long long)(F_SETLKW));
#else
  printf("{\"fact\":\"constant\",\"of\":\"F_SETLKW\",\"value\":\"no macro of this name\"}\n");
#endif
#ifdef F_UNLCK
  printf("{\"fact\":\"constant\",\"of\":\"F_UNLCK\",\"value\":%lld}\n", (long long)(F_UNLCK));
#else
  printf("{\"fact\":\"constant\",\"of\":\"F_UNLCK\",\"value\":\"no macro of this name\"}\n");
#endif
#ifdef F_VOLPOSMODE
  printf("{\"fact\":\"constant\",\"of\":\"F_VOLPOSMODE\",\"value\":%lld}\n", (long long)(F_VOLPOSMODE));
#else
  printf("{\"fact\":\"constant\",\"of\":\"F_VOLPOSMODE\",\"value\":\"no macro of this name\"}\n");
#endif
#ifdef F_WRLCK
  printf("{\"fact\":\"constant\",\"of\":\"F_WRLCK\",\"value\":%lld}\n", (long long)(F_WRLCK));
#else
  printf("{\"fact\":\"constant\",\"of\":\"F_WRLCK\",\"value\":\"no macro of this name\"}\n");
#endif
#ifdef FD_CLOEXEC
  printf("{\"fact\":\"constant\",\"of\":\"FD_CLOEXEC\",\"value\":%lld}\n", (long long)(FD_CLOEXEC));
#else
  printf("{\"fact\":\"constant\",\"of\":\"FD_CLOEXEC\",\"value\":\"no macro of this name\"}\n");
#endif
#ifdef HOST_VM_INFO64
  printf("{\"fact\":\"constant\",\"of\":\"HOST_VM_INFO64\",\"value\":%lld}\n", (long long)(HOST_VM_INFO64));
#else
  printf("{\"fact\":\"constant\",\"of\":\"HOST_VM_INFO64\",\"value\":\"no macro of this name\"}\n");
#endif
#ifdef HOST_VM_INFO64_COUNT
  printf("{\"fact\":\"constant\",\"of\":\"HOST_VM_INFO64_COUNT\",\"value\":%lld}\n", (long long)(HOST_VM_INFO64_COUNT));
#else
  printf("{\"fact\":\"constant\",\"of\":\"HOST_VM_INFO64_COUNT\",\"value\":\"no macro of this name\"}\n");
#endif
#ifdef MAXPATHLEN
  printf("{\"fact\":\"constant\",\"of\":\"MAXPATHLEN\",\"value\":%lld}\n", (long long)(MAXPATHLEN));
#else
  printf("{\"fact\":\"constant\",\"of\":\"MAXPATHLEN\",\"value\":\"no macro of this name\"}\n");
#endif
#ifdef MSG_CTRUNC
  printf("{\"fact\":\"constant\",\"of\":\"MSG_CTRUNC\",\"value\":%lld}\n", (long long)(MSG_CTRUNC));
#else
  printf("{\"fact\":\"constant\",\"of\":\"MSG_CTRUNC\",\"value\":\"no macro of this name\"}\n");
#endif
#ifdef MSG_DONTROUTE
  printf("{\"fact\":\"constant\",\"of\":\"MSG_DONTROUTE\",\"value\":%lld}\n", (long long)(MSG_DONTROUTE));
#else
  printf("{\"fact\":\"constant\",\"of\":\"MSG_DONTROUTE\",\"value\":\"no macro of this name\"}\n");
#endif
#ifdef MSG_DONTWAIT
  printf("{\"fact\":\"constant\",\"of\":\"MSG_DONTWAIT\",\"value\":%lld}\n", (long long)(MSG_DONTWAIT));
#else
  printf("{\"fact\":\"constant\",\"of\":\"MSG_DONTWAIT\",\"value\":\"no macro of this name\"}\n");
#endif
#ifdef MSG_EOF
  printf("{\"fact\":\"constant\",\"of\":\"MSG_EOF\",\"value\":%lld}\n", (long long)(MSG_EOF));
#else
  printf("{\"fact\":\"constant\",\"of\":\"MSG_EOF\",\"value\":\"no macro of this name\"}\n");
#endif
#ifdef MSG_EOR
  printf("{\"fact\":\"constant\",\"of\":\"MSG_EOR\",\"value\":%lld}\n", (long long)(MSG_EOR));
#else
  printf("{\"fact\":\"constant\",\"of\":\"MSG_EOR\",\"value\":\"no macro of this name\"}\n");
#endif
#ifdef MSG_FLUSH
  printf("{\"fact\":\"constant\",\"of\":\"MSG_FLUSH\",\"value\":%lld}\n", (long long)(MSG_FLUSH));
#else
  printf("{\"fact\":\"constant\",\"of\":\"MSG_FLUSH\",\"value\":\"no macro of this name\"}\n");
#endif
#ifdef MSG_HAVEMORE
  printf("{\"fact\":\"constant\",\"of\":\"MSG_HAVEMORE\",\"value\":%lld}\n", (long long)(MSG_HAVEMORE));
#else
  printf("{\"fact\":\"constant\",\"of\":\"MSG_HAVEMORE\",\"value\":\"no macro of this name\"}\n");
#endif
#ifdef MSG_HOLD
  printf("{\"fact\":\"constant\",\"of\":\"MSG_HOLD\",\"value\":%lld}\n", (long long)(MSG_HOLD));
#else
  printf("{\"fact\":\"constant\",\"of\":\"MSG_HOLD\",\"value\":\"no macro of this name\"}\n");
#endif
#ifdef MSG_NEEDSA
  printf("{\"fact\":\"constant\",\"of\":\"MSG_NEEDSA\",\"value\":%lld}\n", (long long)(MSG_NEEDSA));
#else
  printf("{\"fact\":\"constant\",\"of\":\"MSG_NEEDSA\",\"value\":\"no macro of this name\"}\n");
#endif
#ifdef MSG_NOSIGNAL
  printf("{\"fact\":\"constant\",\"of\":\"MSG_NOSIGNAL\",\"value\":%lld}\n", (long long)(MSG_NOSIGNAL));
#else
  printf("{\"fact\":\"constant\",\"of\":\"MSG_NOSIGNAL\",\"value\":\"no macro of this name\"}\n");
#endif
#ifdef MSG_OOB
  printf("{\"fact\":\"constant\",\"of\":\"MSG_OOB\",\"value\":%lld}\n", (long long)(MSG_OOB));
#else
  printf("{\"fact\":\"constant\",\"of\":\"MSG_OOB\",\"value\":\"no macro of this name\"}\n");
#endif
#ifdef MSG_PEEK
  printf("{\"fact\":\"constant\",\"of\":\"MSG_PEEK\",\"value\":%lld}\n", (long long)(MSG_PEEK));
#else
  printf("{\"fact\":\"constant\",\"of\":\"MSG_PEEK\",\"value\":\"no macro of this name\"}\n");
#endif
#ifdef MSG_RCVMORE
  printf("{\"fact\":\"constant\",\"of\":\"MSG_RCVMORE\",\"value\":%lld}\n", (long long)(MSG_RCVMORE));
#else
  printf("{\"fact\":\"constant\",\"of\":\"MSG_RCVMORE\",\"value\":\"no macro of this name\"}\n");
#endif
#ifdef MSG_SEND
  printf("{\"fact\":\"constant\",\"of\":\"MSG_SEND\",\"value\":%lld}\n", (long long)(MSG_SEND));
#else
  printf("{\"fact\":\"constant\",\"of\":\"MSG_SEND\",\"value\":\"no macro of this name\"}\n");
#endif
#ifdef MSG_TRUNC
  printf("{\"fact\":\"constant\",\"of\":\"MSG_TRUNC\",\"value\":%lld}\n", (long long)(MSG_TRUNC));
#else
  printf("{\"fact\":\"constant\",\"of\":\"MSG_TRUNC\",\"value\":\"no macro of this name\"}\n");
#endif
#ifdef MSG_WAITALL
  printf("{\"fact\":\"constant\",\"of\":\"MSG_WAITALL\",\"value\":%lld}\n", (long long)(MSG_WAITALL));
#else
  printf("{\"fact\":\"constant\",\"of\":\"MSG_WAITALL\",\"value\":\"no macro of this name\"}\n");
#endif
#ifdef NOTE_ATTRIB
  printf("{\"fact\":\"constant\",\"of\":\"NOTE_ATTRIB\",\"value\":%lld}\n", (long long)(NOTE_ATTRIB));
#else
  printf("{\"fact\":\"constant\",\"of\":\"NOTE_ATTRIB\",\"value\":\"no macro of this name\"}\n");
#endif
#ifdef NOTE_DELETE
  printf("{\"fact\":\"constant\",\"of\":\"NOTE_DELETE\",\"value\":%lld}\n", (long long)(NOTE_DELETE));
#else
  printf("{\"fact\":\"constant\",\"of\":\"NOTE_DELETE\",\"value\":\"no macro of this name\"}\n");
#endif
#ifdef NOTE_EXEC
  printf("{\"fact\":\"constant\",\"of\":\"NOTE_EXEC\",\"value\":%lld}\n", (long long)(NOTE_EXEC));
#else
  printf("{\"fact\":\"constant\",\"of\":\"NOTE_EXEC\",\"value\":\"no macro of this name\"}\n");
#endif
#ifdef NOTE_EXIT
  printf("{\"fact\":\"constant\",\"of\":\"NOTE_EXIT\",\"value\":%lld}\n", (long long)(NOTE_EXIT));
#else
  printf("{\"fact\":\"constant\",\"of\":\"NOTE_EXIT\",\"value\":\"no macro of this name\"}\n");
#endif
#ifdef NOTE_EXITSTATUS
  printf("{\"fact\":\"constant\",\"of\":\"NOTE_EXITSTATUS\",\"value\":%lld}\n", (long long)(NOTE_EXITSTATUS));
#else
  printf("{\"fact\":\"constant\",\"of\":\"NOTE_EXITSTATUS\",\"value\":\"no macro of this name\"}\n");
#endif
#ifdef NOTE_EXTEND
  printf("{\"fact\":\"constant\",\"of\":\"NOTE_EXTEND\",\"value\":%lld}\n", (long long)(NOTE_EXTEND));
#else
  printf("{\"fact\":\"constant\",\"of\":\"NOTE_EXTEND\",\"value\":\"no macro of this name\"}\n");
#endif
#ifdef NOTE_FORK
  printf("{\"fact\":\"constant\",\"of\":\"NOTE_FORK\",\"value\":%lld}\n", (long long)(NOTE_FORK));
#else
  printf("{\"fact\":\"constant\",\"of\":\"NOTE_FORK\",\"value\":\"no macro of this name\"}\n");
#endif
#ifdef NOTE_LINK
  printf("{\"fact\":\"constant\",\"of\":\"NOTE_LINK\",\"value\":%lld}\n", (long long)(NOTE_LINK));
#else
  printf("{\"fact\":\"constant\",\"of\":\"NOTE_LINK\",\"value\":\"no macro of this name\"}\n");
#endif
#ifdef NOTE_RENAME
  printf("{\"fact\":\"constant\",\"of\":\"NOTE_RENAME\",\"value\":%lld}\n", (long long)(NOTE_RENAME));
#else
  printf("{\"fact\":\"constant\",\"of\":\"NOTE_RENAME\",\"value\":\"no macro of this name\"}\n");
#endif
#ifdef NOTE_REVOKE
  printf("{\"fact\":\"constant\",\"of\":\"NOTE_REVOKE\",\"value\":%lld}\n", (long long)(NOTE_REVOKE));
#else
  printf("{\"fact\":\"constant\",\"of\":\"NOTE_REVOKE\",\"value\":\"no macro of this name\"}\n");
#endif
#ifdef NOTE_SIGNAL
  printf("{\"fact\":\"constant\",\"of\":\"NOTE_SIGNAL\",\"value\":%lld}\n", (long long)(NOTE_SIGNAL));
#else
  printf("{\"fact\":\"constant\",\"of\":\"NOTE_SIGNAL\",\"value\":\"no macro of this name\"}\n");
#endif
#ifdef NOTE_TRIGGER
  printf("{\"fact\":\"constant\",\"of\":\"NOTE_TRIGGER\",\"value\":%lld}\n", (long long)(NOTE_TRIGGER));
#else
  printf("{\"fact\":\"constant\",\"of\":\"NOTE_TRIGGER\",\"value\":\"no macro of this name\"}\n");
#endif
#ifdef NOTE_WRITE
  printf("{\"fact\":\"constant\",\"of\":\"NOTE_WRITE\",\"value\":%lld}\n", (long long)(NOTE_WRITE));
#else
  printf("{\"fact\":\"constant\",\"of\":\"NOTE_WRITE\",\"value\":\"no macro of this name\"}\n");
#endif
#ifdef O_ACCMODE
  printf("{\"fact\":\"constant\",\"of\":\"O_ACCMODE\",\"value\":%lld}\n", (long long)(O_ACCMODE));
#else
  printf("{\"fact\":\"constant\",\"of\":\"O_ACCMODE\",\"value\":\"no macro of this name\"}\n");
#endif
#ifdef O_APPEND
  printf("{\"fact\":\"constant\",\"of\":\"O_APPEND\",\"value\":%lld}\n", (long long)(O_APPEND));
#else
  printf("{\"fact\":\"constant\",\"of\":\"O_APPEND\",\"value\":\"no macro of this name\"}\n");
#endif
#ifdef O_ASYNC
  printf("{\"fact\":\"constant\",\"of\":\"O_ASYNC\",\"value\":%lld}\n", (long long)(O_ASYNC));
#else
  printf("{\"fact\":\"constant\",\"of\":\"O_ASYNC\",\"value\":\"no macro of this name\"}\n");
#endif
#ifdef O_CLOEXEC
  printf("{\"fact\":\"constant\",\"of\":\"O_CLOEXEC\",\"value\":%lld}\n", (long long)(O_CLOEXEC));
#else
  printf("{\"fact\":\"constant\",\"of\":\"O_CLOEXEC\",\"value\":\"no macro of this name\"}\n");
#endif
#ifdef O_CREAT
  printf("{\"fact\":\"constant\",\"of\":\"O_CREAT\",\"value\":%lld}\n", (long long)(O_CREAT));
#else
  printf("{\"fact\":\"constant\",\"of\":\"O_CREAT\",\"value\":\"no macro of this name\"}\n");
#endif
#ifdef O_DIRECTORY
  printf("{\"fact\":\"constant\",\"of\":\"O_DIRECTORY\",\"value\":%lld}\n", (long long)(O_DIRECTORY));
#else
  printf("{\"fact\":\"constant\",\"of\":\"O_DIRECTORY\",\"value\":\"no macro of this name\"}\n");
#endif
#ifdef O_DSYNC
  printf("{\"fact\":\"constant\",\"of\":\"O_DSYNC\",\"value\":%lld}\n", (long long)(O_DSYNC));
#else
  printf("{\"fact\":\"constant\",\"of\":\"O_DSYNC\",\"value\":\"no macro of this name\"}\n");
#endif
#ifdef O_EVTONLY
  printf("{\"fact\":\"constant\",\"of\":\"O_EVTONLY\",\"value\":%lld}\n", (long long)(O_EVTONLY));
#else
  printf("{\"fact\":\"constant\",\"of\":\"O_EVTONLY\",\"value\":\"no macro of this name\"}\n");
#endif
#ifdef O_EXCL
  printf("{\"fact\":\"constant\",\"of\":\"O_EXCL\",\"value\":%lld}\n", (long long)(O_EXCL));
#else
  printf("{\"fact\":\"constant\",\"of\":\"O_EXCL\",\"value\":\"no macro of this name\"}\n");
#endif
#ifdef O_EXEC
  printf("{\"fact\":\"constant\",\"of\":\"O_EXEC\",\"value\":%lld}\n", (long long)(O_EXEC));
#else
  printf("{\"fact\":\"constant\",\"of\":\"O_EXEC\",\"value\":\"no macro of this name\"}\n");
#endif
#ifdef O_EXLOCK
  printf("{\"fact\":\"constant\",\"of\":\"O_EXLOCK\",\"value\":%lld}\n", (long long)(O_EXLOCK));
#else
  printf("{\"fact\":\"constant\",\"of\":\"O_EXLOCK\",\"value\":\"no macro of this name\"}\n");
#endif
#ifdef O_FSYNC
  printf("{\"fact\":\"constant\",\"of\":\"O_FSYNC\",\"value\":%lld}\n", (long long)(O_FSYNC));
#else
  printf("{\"fact\":\"constant\",\"of\":\"O_FSYNC\",\"value\":\"no macro of this name\"}\n");
#endif
#ifdef O_NDELAY
  printf("{\"fact\":\"constant\",\"of\":\"O_NDELAY\",\"value\":%lld}\n", (long long)(O_NDELAY));
#else
  printf("{\"fact\":\"constant\",\"of\":\"O_NDELAY\",\"value\":\"no macro of this name\"}\n");
#endif
#ifdef O_NOCTTY
  printf("{\"fact\":\"constant\",\"of\":\"O_NOCTTY\",\"value\":%lld}\n", (long long)(O_NOCTTY));
#else
  printf("{\"fact\":\"constant\",\"of\":\"O_NOCTTY\",\"value\":\"no macro of this name\"}\n");
#endif
#ifdef O_NOFOLLOW
  printf("{\"fact\":\"constant\",\"of\":\"O_NOFOLLOW\",\"value\":%lld}\n", (long long)(O_NOFOLLOW));
#else
  printf("{\"fact\":\"constant\",\"of\":\"O_NOFOLLOW\",\"value\":\"no macro of this name\"}\n");
#endif
#ifdef O_NOFOLLOW_ANY
  printf("{\"fact\":\"constant\",\"of\":\"O_NOFOLLOW_ANY\",\"value\":%lld}\n", (long long)(O_NOFOLLOW_ANY));
#else
  printf("{\"fact\":\"constant\",\"of\":\"O_NOFOLLOW_ANY\",\"value\":\"no macro of this name\"}\n");
#endif
#ifdef O_NONBLOCK
  printf("{\"fact\":\"constant\",\"of\":\"O_NONBLOCK\",\"value\":%lld}\n", (long long)(O_NONBLOCK));
#else
  printf("{\"fact\":\"constant\",\"of\":\"O_NONBLOCK\",\"value\":\"no macro of this name\"}\n");
#endif
#ifdef O_RDONLY
  printf("{\"fact\":\"constant\",\"of\":\"O_RDONLY\",\"value\":%lld}\n", (long long)(O_RDONLY));
#else
  printf("{\"fact\":\"constant\",\"of\":\"O_RDONLY\",\"value\":\"no macro of this name\"}\n");
#endif
#ifdef O_RDWR
  printf("{\"fact\":\"constant\",\"of\":\"O_RDWR\",\"value\":%lld}\n", (long long)(O_RDWR));
#else
  printf("{\"fact\":\"constant\",\"of\":\"O_RDWR\",\"value\":\"no macro of this name\"}\n");
#endif
#ifdef O_SEARCH
  printf("{\"fact\":\"constant\",\"of\":\"O_SEARCH\",\"value\":%lld}\n", (long long)(O_SEARCH));
#else
  printf("{\"fact\":\"constant\",\"of\":\"O_SEARCH\",\"value\":\"no macro of this name\"}\n");
#endif
#ifdef O_SHLOCK
  printf("{\"fact\":\"constant\",\"of\":\"O_SHLOCK\",\"value\":%lld}\n", (long long)(O_SHLOCK));
#else
  printf("{\"fact\":\"constant\",\"of\":\"O_SHLOCK\",\"value\":\"no macro of this name\"}\n");
#endif
#ifdef O_SYMLINK
  printf("{\"fact\":\"constant\",\"of\":\"O_SYMLINK\",\"value\":%lld}\n", (long long)(O_SYMLINK));
#else
  printf("{\"fact\":\"constant\",\"of\":\"O_SYMLINK\",\"value\":\"no macro of this name\"}\n");
#endif
#ifdef O_SYNC
  printf("{\"fact\":\"constant\",\"of\":\"O_SYNC\",\"value\":%lld}\n", (long long)(O_SYNC));
#else
  printf("{\"fact\":\"constant\",\"of\":\"O_SYNC\",\"value\":\"no macro of this name\"}\n");
#endif
#ifdef O_TRUNC
  printf("{\"fact\":\"constant\",\"of\":\"O_TRUNC\",\"value\":%lld}\n", (long long)(O_TRUNC));
#else
  printf("{\"fact\":\"constant\",\"of\":\"O_TRUNC\",\"value\":\"no macro of this name\"}\n");
#endif
#ifdef O_WRONLY
  printf("{\"fact\":\"constant\",\"of\":\"O_WRONLY\",\"value\":%lld}\n", (long long)(O_WRONLY));
#else
  printf("{\"fact\":\"constant\",\"of\":\"O_WRONLY\",\"value\":\"no macro of this name\"}\n");
#endif
#ifdef PATH_MAX
  printf("{\"fact\":\"constant\",\"of\":\"PATH_MAX\",\"value\":%lld}\n", (long long)(PATH_MAX));
#else
  printf("{\"fact\":\"constant\",\"of\":\"PATH_MAX\",\"value\":\"no macro of this name\"}\n");
#endif
#ifdef POLLERR
  printf("{\"fact\":\"constant\",\"of\":\"POLLERR\",\"value\":%lld}\n", (long long)(POLLERR));
#else
  printf("{\"fact\":\"constant\",\"of\":\"POLLERR\",\"value\":\"no macro of this name\"}\n");
#endif
#ifdef POLLHUP
  printf("{\"fact\":\"constant\",\"of\":\"POLLHUP\",\"value\":%lld}\n", (long long)(POLLHUP));
#else
  printf("{\"fact\":\"constant\",\"of\":\"POLLHUP\",\"value\":\"no macro of this name\"}\n");
#endif
#ifdef POLLIN
  printf("{\"fact\":\"constant\",\"of\":\"POLLIN\",\"value\":%lld}\n", (long long)(POLLIN));
#else
  printf("{\"fact\":\"constant\",\"of\":\"POLLIN\",\"value\":\"no macro of this name\"}\n");
#endif
#ifdef POLLNVAL
  printf("{\"fact\":\"constant\",\"of\":\"POLLNVAL\",\"value\":%lld}\n", (long long)(POLLNVAL));
#else
  printf("{\"fact\":\"constant\",\"of\":\"POLLNVAL\",\"value\":\"no macro of this name\"}\n");
#endif
#ifdef POLLOUT
  printf("{\"fact\":\"constant\",\"of\":\"POLLOUT\",\"value\":%lld}\n", (long long)(POLLOUT));
#else
  printf("{\"fact\":\"constant\",\"of\":\"POLLOUT\",\"value\":\"no macro of this name\"}\n");
#endif
#ifdef POLLPRI
  printf("{\"fact\":\"constant\",\"of\":\"POLLPRI\",\"value\":%lld}\n", (long long)(POLLPRI));
#else
  printf("{\"fact\":\"constant\",\"of\":\"POLLPRI\",\"value\":\"no macro of this name\"}\n");
#endif
#ifdef POLLRDBAND
  printf("{\"fact\":\"constant\",\"of\":\"POLLRDBAND\",\"value\":%lld}\n", (long long)(POLLRDBAND));
#else
  printf("{\"fact\":\"constant\",\"of\":\"POLLRDBAND\",\"value\":\"no macro of this name\"}\n");
#endif
#ifdef POLLRDNORM
  printf("{\"fact\":\"constant\",\"of\":\"POLLRDNORM\",\"value\":%lld}\n", (long long)(POLLRDNORM));
#else
  printf("{\"fact\":\"constant\",\"of\":\"POLLRDNORM\",\"value\":\"no macro of this name\"}\n");
#endif
#ifdef POLLWRBAND
  printf("{\"fact\":\"constant\",\"of\":\"POLLWRBAND\",\"value\":%lld}\n", (long long)(POLLWRBAND));
#else
  printf("{\"fact\":\"constant\",\"of\":\"POLLWRBAND\",\"value\":\"no macro of this name\"}\n");
#endif
#ifdef POLLWRNORM
  printf("{\"fact\":\"constant\",\"of\":\"POLLWRNORM\",\"value\":%lld}\n", (long long)(POLLWRNORM));
#else
  printf("{\"fact\":\"constant\",\"of\":\"POLLWRNORM\",\"value\":\"no macro of this name\"}\n");
#endif
#ifdef PROCESSOR_CPU_LOAD_INFO
  printf("{\"fact\":\"constant\",\"of\":\"PROCESSOR_CPU_LOAD_INFO\",\"value\":%lld}\n", (long long)(PROCESSOR_CPU_LOAD_INFO));
#else
  printf("{\"fact\":\"constant\",\"of\":\"PROCESSOR_CPU_LOAD_INFO\",\"value\":\"no macro of this name\"}\n");
#endif
#ifdef R_OK
  printf("{\"fact\":\"constant\",\"of\":\"R_OK\",\"value\":%lld}\n", (long long)(R_OK));
#else
  printf("{\"fact\":\"constant\",\"of\":\"R_OK\",\"value\":\"no macro of this name\"}\n");
#endif
#ifdef RENAME_EXCL
  printf("{\"fact\":\"constant\",\"of\":\"RENAME_EXCL\",\"value\":%lld}\n", (long long)(RENAME_EXCL));
#else
  printf("{\"fact\":\"constant\",\"of\":\"RENAME_EXCL\",\"value\":\"no macro of this name\"}\n");
#endif
#ifdef RENAME_SWAP
  printf("{\"fact\":\"constant\",\"of\":\"RENAME_SWAP\",\"value\":%lld}\n", (long long)(RENAME_SWAP));
#else
  printf("{\"fact\":\"constant\",\"of\":\"RENAME_SWAP\",\"value\":\"no macro of this name\"}\n");
#endif
#ifdef S_IEXEC
  printf("{\"fact\":\"constant\",\"of\":\"S_IEXEC\",\"value\":%lld}\n", (long long)(S_IEXEC));
#else
  printf("{\"fact\":\"constant\",\"of\":\"S_IEXEC\",\"value\":\"no macro of this name\"}\n");
#endif
#ifdef S_IFBLK
  printf("{\"fact\":\"constant\",\"of\":\"S_IFBLK\",\"value\":%lld}\n", (long long)(S_IFBLK));
#else
  printf("{\"fact\":\"constant\",\"of\":\"S_IFBLK\",\"value\":\"no macro of this name\"}\n");
#endif
#ifdef S_IFCHR
  printf("{\"fact\":\"constant\",\"of\":\"S_IFCHR\",\"value\":%lld}\n", (long long)(S_IFCHR));
#else
  printf("{\"fact\":\"constant\",\"of\":\"S_IFCHR\",\"value\":\"no macro of this name\"}\n");
#endif
#ifdef S_IFDIR
  printf("{\"fact\":\"constant\",\"of\":\"S_IFDIR\",\"value\":%lld}\n", (long long)(S_IFDIR));
#else
  printf("{\"fact\":\"constant\",\"of\":\"S_IFDIR\",\"value\":\"no macro of this name\"}\n");
#endif
#ifdef S_IFIFO
  printf("{\"fact\":\"constant\",\"of\":\"S_IFIFO\",\"value\":%lld}\n", (long long)(S_IFIFO));
#else
  printf("{\"fact\":\"constant\",\"of\":\"S_IFIFO\",\"value\":\"no macro of this name\"}\n");
#endif
#ifdef S_IFLNK
  printf("{\"fact\":\"constant\",\"of\":\"S_IFLNK\",\"value\":%lld}\n", (long long)(S_IFLNK));
#else
  printf("{\"fact\":\"constant\",\"of\":\"S_IFLNK\",\"value\":\"no macro of this name\"}\n");
#endif
#ifdef S_IFMT
  printf("{\"fact\":\"constant\",\"of\":\"S_IFMT\",\"value\":%lld}\n", (long long)(S_IFMT));
#else
  printf("{\"fact\":\"constant\",\"of\":\"S_IFMT\",\"value\":\"no macro of this name\"}\n");
#endif
#ifdef S_IFREG
  printf("{\"fact\":\"constant\",\"of\":\"S_IFREG\",\"value\":%lld}\n", (long long)(S_IFREG));
#else
  printf("{\"fact\":\"constant\",\"of\":\"S_IFREG\",\"value\":\"no macro of this name\"}\n");
#endif
#ifdef S_IFSOCK
  printf("{\"fact\":\"constant\",\"of\":\"S_IFSOCK\",\"value\":%lld}\n", (long long)(S_IFSOCK));
#else
  printf("{\"fact\":\"constant\",\"of\":\"S_IFSOCK\",\"value\":\"no macro of this name\"}\n");
#endif
#ifdef S_IREAD
  printf("{\"fact\":\"constant\",\"of\":\"S_IREAD\",\"value\":%lld}\n", (long long)(S_IREAD));
#else
  printf("{\"fact\":\"constant\",\"of\":\"S_IREAD\",\"value\":\"no macro of this name\"}\n");
#endif
#ifdef S_IRGRP
  printf("{\"fact\":\"constant\",\"of\":\"S_IRGRP\",\"value\":%lld}\n", (long long)(S_IRGRP));
#else
  printf("{\"fact\":\"constant\",\"of\":\"S_IRGRP\",\"value\":\"no macro of this name\"}\n");
#endif
#ifdef S_IROTH
  printf("{\"fact\":\"constant\",\"of\":\"S_IROTH\",\"value\":%lld}\n", (long long)(S_IROTH));
#else
  printf("{\"fact\":\"constant\",\"of\":\"S_IROTH\",\"value\":\"no macro of this name\"}\n");
#endif
#ifdef S_IRUSR
  printf("{\"fact\":\"constant\",\"of\":\"S_IRUSR\",\"value\":%lld}\n", (long long)(S_IRUSR));
#else
  printf("{\"fact\":\"constant\",\"of\":\"S_IRUSR\",\"value\":\"no macro of this name\"}\n");
#endif
#ifdef S_IRWXG
  printf("{\"fact\":\"constant\",\"of\":\"S_IRWXG\",\"value\":%lld}\n", (long long)(S_IRWXG));
#else
  printf("{\"fact\":\"constant\",\"of\":\"S_IRWXG\",\"value\":\"no macro of this name\"}\n");
#endif
#ifdef S_IRWXO
  printf("{\"fact\":\"constant\",\"of\":\"S_IRWXO\",\"value\":%lld}\n", (long long)(S_IRWXO));
#else
  printf("{\"fact\":\"constant\",\"of\":\"S_IRWXO\",\"value\":\"no macro of this name\"}\n");
#endif
#ifdef S_IRWXU
  printf("{\"fact\":\"constant\",\"of\":\"S_IRWXU\",\"value\":%lld}\n", (long long)(S_IRWXU));
#else
  printf("{\"fact\":\"constant\",\"of\":\"S_IRWXU\",\"value\":\"no macro of this name\"}\n");
#endif
#ifdef S_ISGID
  printf("{\"fact\":\"constant\",\"of\":\"S_ISGID\",\"value\":%lld}\n", (long long)(S_ISGID));
#else
  printf("{\"fact\":\"constant\",\"of\":\"S_ISGID\",\"value\":\"no macro of this name\"}\n");
#endif
#ifdef S_ISUID
  printf("{\"fact\":\"constant\",\"of\":\"S_ISUID\",\"value\":%lld}\n", (long long)(S_ISUID));
#else
  printf("{\"fact\":\"constant\",\"of\":\"S_ISUID\",\"value\":\"no macro of this name\"}\n");
#endif
#ifdef S_ISVTX
  printf("{\"fact\":\"constant\",\"of\":\"S_ISVTX\",\"value\":%lld}\n", (long long)(S_ISVTX));
#else
  printf("{\"fact\":\"constant\",\"of\":\"S_ISVTX\",\"value\":\"no macro of this name\"}\n");
#endif
#ifdef S_IWGRP
  printf("{\"fact\":\"constant\",\"of\":\"S_IWGRP\",\"value\":%lld}\n", (long long)(S_IWGRP));
#else
  printf("{\"fact\":\"constant\",\"of\":\"S_IWGRP\",\"value\":\"no macro of this name\"}\n");
#endif
#ifdef S_IWOTH
  printf("{\"fact\":\"constant\",\"of\":\"S_IWOTH\",\"value\":%lld}\n", (long long)(S_IWOTH));
#else
  printf("{\"fact\":\"constant\",\"of\":\"S_IWOTH\",\"value\":\"no macro of this name\"}\n");
#endif
#ifdef S_IWRITE
  printf("{\"fact\":\"constant\",\"of\":\"S_IWRITE\",\"value\":%lld}\n", (long long)(S_IWRITE));
#else
  printf("{\"fact\":\"constant\",\"of\":\"S_IWRITE\",\"value\":\"no macro of this name\"}\n");
#endif
#ifdef S_IWUSR
  printf("{\"fact\":\"constant\",\"of\":\"S_IWUSR\",\"value\":%lld}\n", (long long)(S_IWUSR));
#else
  printf("{\"fact\":\"constant\",\"of\":\"S_IWUSR\",\"value\":\"no macro of this name\"}\n");
#endif
#ifdef S_IXGRP
  printf("{\"fact\":\"constant\",\"of\":\"S_IXGRP\",\"value\":%lld}\n", (long long)(S_IXGRP));
#else
  printf("{\"fact\":\"constant\",\"of\":\"S_IXGRP\",\"value\":\"no macro of this name\"}\n");
#endif
#ifdef S_IXOTH
  printf("{\"fact\":\"constant\",\"of\":\"S_IXOTH\",\"value\":%lld}\n", (long long)(S_IXOTH));
#else
  printf("{\"fact\":\"constant\",\"of\":\"S_IXOTH\",\"value\":\"no macro of this name\"}\n");
#endif
#ifdef S_IXUSR
  printf("{\"fact\":\"constant\",\"of\":\"S_IXUSR\",\"value\":%lld}\n", (long long)(S_IXUSR));
#else
  printf("{\"fact\":\"constant\",\"of\":\"S_IXUSR\",\"value\":\"no macro of this name\"}\n");
#endif
#ifdef SEEK_CUR
  printf("{\"fact\":\"constant\",\"of\":\"SEEK_CUR\",\"value\":%lld}\n", (long long)(SEEK_CUR));
#else
  printf("{\"fact\":\"constant\",\"of\":\"SEEK_CUR\",\"value\":\"no macro of this name\"}\n");
#endif
#ifdef SEEK_DATA
  printf("{\"fact\":\"constant\",\"of\":\"SEEK_DATA\",\"value\":%lld}\n", (long long)(SEEK_DATA));
#else
  printf("{\"fact\":\"constant\",\"of\":\"SEEK_DATA\",\"value\":\"no macro of this name\"}\n");
#endif
#ifdef SEEK_END
  printf("{\"fact\":\"constant\",\"of\":\"SEEK_END\",\"value\":%lld}\n", (long long)(SEEK_END));
#else
  printf("{\"fact\":\"constant\",\"of\":\"SEEK_END\",\"value\":\"no macro of this name\"}\n");
#endif
#ifdef SEEK_HOLE
  printf("{\"fact\":\"constant\",\"of\":\"SEEK_HOLE\",\"value\":%lld}\n", (long long)(SEEK_HOLE));
#else
  printf("{\"fact\":\"constant\",\"of\":\"SEEK_HOLE\",\"value\":\"no macro of this name\"}\n");
#endif
#ifdef SEEK_SET
  printf("{\"fact\":\"constant\",\"of\":\"SEEK_SET\",\"value\":%lld}\n", (long long)(SEEK_SET));
#else
  printf("{\"fact\":\"constant\",\"of\":\"SEEK_SET\",\"value\":\"no macro of this name\"}\n");
#endif
#ifdef SIGABRT
  printf("{\"fact\":\"constant\",\"of\":\"SIGABRT\",\"value\":%lld}\n", (long long)(SIGABRT));
#else
  printf("{\"fact\":\"constant\",\"of\":\"SIGABRT\",\"value\":\"no macro of this name\"}\n");
#endif
#ifdef SIGALRM
  printf("{\"fact\":\"constant\",\"of\":\"SIGALRM\",\"value\":%lld}\n", (long long)(SIGALRM));
#else
  printf("{\"fact\":\"constant\",\"of\":\"SIGALRM\",\"value\":\"no macro of this name\"}\n");
#endif
#ifdef SIGBUS
  printf("{\"fact\":\"constant\",\"of\":\"SIGBUS\",\"value\":%lld}\n", (long long)(SIGBUS));
#else
  printf("{\"fact\":\"constant\",\"of\":\"SIGBUS\",\"value\":\"no macro of this name\"}\n");
#endif
#ifdef SIGCHLD
  printf("{\"fact\":\"constant\",\"of\":\"SIGCHLD\",\"value\":%lld}\n", (long long)(SIGCHLD));
#else
  printf("{\"fact\":\"constant\",\"of\":\"SIGCHLD\",\"value\":\"no macro of this name\"}\n");
#endif
#ifdef SIGCONT
  printf("{\"fact\":\"constant\",\"of\":\"SIGCONT\",\"value\":%lld}\n", (long long)(SIGCONT));
#else
  printf("{\"fact\":\"constant\",\"of\":\"SIGCONT\",\"value\":\"no macro of this name\"}\n");
#endif
#ifdef SIGEMT
  printf("{\"fact\":\"constant\",\"of\":\"SIGEMT\",\"value\":%lld}\n", (long long)(SIGEMT));
#else
  printf("{\"fact\":\"constant\",\"of\":\"SIGEMT\",\"value\":\"no macro of this name\"}\n");
#endif
#ifdef SIGFPE
  printf("{\"fact\":\"constant\",\"of\":\"SIGFPE\",\"value\":%lld}\n", (long long)(SIGFPE));
#else
  printf("{\"fact\":\"constant\",\"of\":\"SIGFPE\",\"value\":\"no macro of this name\"}\n");
#endif
#ifdef SIGHUP
  printf("{\"fact\":\"constant\",\"of\":\"SIGHUP\",\"value\":%lld}\n", (long long)(SIGHUP));
#else
  printf("{\"fact\":\"constant\",\"of\":\"SIGHUP\",\"value\":\"no macro of this name\"}\n");
#endif
#ifdef SIGILL
  printf("{\"fact\":\"constant\",\"of\":\"SIGILL\",\"value\":%lld}\n", (long long)(SIGILL));
#else
  printf("{\"fact\":\"constant\",\"of\":\"SIGILL\",\"value\":\"no macro of this name\"}\n");
#endif
#ifdef SIGINFO
  printf("{\"fact\":\"constant\",\"of\":\"SIGINFO\",\"value\":%lld}\n", (long long)(SIGINFO));
#else
  printf("{\"fact\":\"constant\",\"of\":\"SIGINFO\",\"value\":\"no macro of this name\"}\n");
#endif
#ifdef SIGINT
  printf("{\"fact\":\"constant\",\"of\":\"SIGINT\",\"value\":%lld}\n", (long long)(SIGINT));
#else
  printf("{\"fact\":\"constant\",\"of\":\"SIGINT\",\"value\":\"no macro of this name\"}\n");
#endif
#ifdef SIGIO
  printf("{\"fact\":\"constant\",\"of\":\"SIGIO\",\"value\":%lld}\n", (long long)(SIGIO));
#else
  printf("{\"fact\":\"constant\",\"of\":\"SIGIO\",\"value\":\"no macro of this name\"}\n");
#endif
#ifdef SIGIOT
  printf("{\"fact\":\"constant\",\"of\":\"SIGIOT\",\"value\":%lld}\n", (long long)(SIGIOT));
#else
  printf("{\"fact\":\"constant\",\"of\":\"SIGIOT\",\"value\":\"no macro of this name\"}\n");
#endif
#ifdef SIGKILL
  printf("{\"fact\":\"constant\",\"of\":\"SIGKILL\",\"value\":%lld}\n", (long long)(SIGKILL));
#else
  printf("{\"fact\":\"constant\",\"of\":\"SIGKILL\",\"value\":\"no macro of this name\"}\n");
#endif
#ifdef SIGPIPE
  printf("{\"fact\":\"constant\",\"of\":\"SIGPIPE\",\"value\":%lld}\n", (long long)(SIGPIPE));
#else
  printf("{\"fact\":\"constant\",\"of\":\"SIGPIPE\",\"value\":\"no macro of this name\"}\n");
#endif
#ifdef SIGPROF
  printf("{\"fact\":\"constant\",\"of\":\"SIGPROF\",\"value\":%lld}\n", (long long)(SIGPROF));
#else
  printf("{\"fact\":\"constant\",\"of\":\"SIGPROF\",\"value\":\"no macro of this name\"}\n");
#endif
#ifdef SIGQUIT
  printf("{\"fact\":\"constant\",\"of\":\"SIGQUIT\",\"value\":%lld}\n", (long long)(SIGQUIT));
#else
  printf("{\"fact\":\"constant\",\"of\":\"SIGQUIT\",\"value\":\"no macro of this name\"}\n");
#endif
#ifdef SIGSEGV
  printf("{\"fact\":\"constant\",\"of\":\"SIGSEGV\",\"value\":%lld}\n", (long long)(SIGSEGV));
#else
  printf("{\"fact\":\"constant\",\"of\":\"SIGSEGV\",\"value\":\"no macro of this name\"}\n");
#endif
#ifdef SIGSTOP
  printf("{\"fact\":\"constant\",\"of\":\"SIGSTOP\",\"value\":%lld}\n", (long long)(SIGSTOP));
#else
  printf("{\"fact\":\"constant\",\"of\":\"SIGSTOP\",\"value\":\"no macro of this name\"}\n");
#endif
#ifdef SIGSYS
  printf("{\"fact\":\"constant\",\"of\":\"SIGSYS\",\"value\":%lld}\n", (long long)(SIGSYS));
#else
  printf("{\"fact\":\"constant\",\"of\":\"SIGSYS\",\"value\":\"no macro of this name\"}\n");
#endif
#ifdef SIGTERM
  printf("{\"fact\":\"constant\",\"of\":\"SIGTERM\",\"value\":%lld}\n", (long long)(SIGTERM));
#else
  printf("{\"fact\":\"constant\",\"of\":\"SIGTERM\",\"value\":\"no macro of this name\"}\n");
#endif
#ifdef SIGTRAP
  printf("{\"fact\":\"constant\",\"of\":\"SIGTRAP\",\"value\":%lld}\n", (long long)(SIGTRAP));
#else
  printf("{\"fact\":\"constant\",\"of\":\"SIGTRAP\",\"value\":\"no macro of this name\"}\n");
#endif
#ifdef SIGTSTP
  printf("{\"fact\":\"constant\",\"of\":\"SIGTSTP\",\"value\":%lld}\n", (long long)(SIGTSTP));
#else
  printf("{\"fact\":\"constant\",\"of\":\"SIGTSTP\",\"value\":\"no macro of this name\"}\n");
#endif
#ifdef SIGTTIN
  printf("{\"fact\":\"constant\",\"of\":\"SIGTTIN\",\"value\":%lld}\n", (long long)(SIGTTIN));
#else
  printf("{\"fact\":\"constant\",\"of\":\"SIGTTIN\",\"value\":\"no macro of this name\"}\n");
#endif
#ifdef SIGTTOU
  printf("{\"fact\":\"constant\",\"of\":\"SIGTTOU\",\"value\":%lld}\n", (long long)(SIGTTOU));
#else
  printf("{\"fact\":\"constant\",\"of\":\"SIGTTOU\",\"value\":\"no macro of this name\"}\n");
#endif
#ifdef SIGURG
  printf("{\"fact\":\"constant\",\"of\":\"SIGURG\",\"value\":%lld}\n", (long long)(SIGURG));
#else
  printf("{\"fact\":\"constant\",\"of\":\"SIGURG\",\"value\":\"no macro of this name\"}\n");
#endif
#ifdef SIGUSR1
  printf("{\"fact\":\"constant\",\"of\":\"SIGUSR1\",\"value\":%lld}\n", (long long)(SIGUSR1));
#else
  printf("{\"fact\":\"constant\",\"of\":\"SIGUSR1\",\"value\":\"no macro of this name\"}\n");
#endif
#ifdef SIGUSR2
  printf("{\"fact\":\"constant\",\"of\":\"SIGUSR2\",\"value\":%lld}\n", (long long)(SIGUSR2));
#else
  printf("{\"fact\":\"constant\",\"of\":\"SIGUSR2\",\"value\":\"no macro of this name\"}\n");
#endif
#ifdef SIGVTALRM
  printf("{\"fact\":\"constant\",\"of\":\"SIGVTALRM\",\"value\":%lld}\n", (long long)(SIGVTALRM));
#else
  printf("{\"fact\":\"constant\",\"of\":\"SIGVTALRM\",\"value\":\"no macro of this name\"}\n");
#endif
#ifdef SIGWINCH
  printf("{\"fact\":\"constant\",\"of\":\"SIGWINCH\",\"value\":%lld}\n", (long long)(SIGWINCH));
#else
  printf("{\"fact\":\"constant\",\"of\":\"SIGWINCH\",\"value\":\"no macro of this name\"}\n");
#endif
#ifdef SIGXCPU
  printf("{\"fact\":\"constant\",\"of\":\"SIGXCPU\",\"value\":%lld}\n", (long long)(SIGXCPU));
#else
  printf("{\"fact\":\"constant\",\"of\":\"SIGXCPU\",\"value\":\"no macro of this name\"}\n");
#endif
#ifdef SIGXFSZ
  printf("{\"fact\":\"constant\",\"of\":\"SIGXFSZ\",\"value\":%lld}\n", (long long)(SIGXFSZ));
#else
  printf("{\"fact\":\"constant\",\"of\":\"SIGXFSZ\",\"value\":\"no macro of this name\"}\n");
#endif
#ifdef SO_NOSIGPIPE
  printf("{\"fact\":\"constant\",\"of\":\"SO_NOSIGPIPE\",\"value\":%lld}\n", (long long)(SO_NOSIGPIPE));
#else
  printf("{\"fact\":\"constant\",\"of\":\"SO_NOSIGPIPE\",\"value\":\"no macro of this name\"}\n");
#endif
#ifdef SO_RCVBUF
  printf("{\"fact\":\"constant\",\"of\":\"SO_RCVBUF\",\"value\":%lld}\n", (long long)(SO_RCVBUF));
#else
  printf("{\"fact\":\"constant\",\"of\":\"SO_RCVBUF\",\"value\":\"no macro of this name\"}\n");
#endif
#ifdef SO_SNDBUF
  printf("{\"fact\":\"constant\",\"of\":\"SO_SNDBUF\",\"value\":%lld}\n", (long long)(SO_SNDBUF));
#else
  printf("{\"fact\":\"constant\",\"of\":\"SO_SNDBUF\",\"value\":\"no macro of this name\"}\n");
#endif
#ifdef SOL_SOCKET
  printf("{\"fact\":\"constant\",\"of\":\"SOL_SOCKET\",\"value\":%lld}\n", (long long)(SOL_SOCKET));
#else
  printf("{\"fact\":\"constant\",\"of\":\"SOL_SOCKET\",\"value\":\"no macro of this name\"}\n");
#endif
#ifdef W_OK
  printf("{\"fact\":\"constant\",\"of\":\"W_OK\",\"value\":%lld}\n", (long long)(W_OK));
#else
  printf("{\"fact\":\"constant\",\"of\":\"W_OK\",\"value\":\"no macro of this name\"}\n");
#endif
#ifdef WNOHANG
  printf("{\"fact\":\"constant\",\"of\":\"WNOHANG\",\"value\":%lld}\n", (long long)(WNOHANG));
#else
  printf("{\"fact\":\"constant\",\"of\":\"WNOHANG\",\"value\":\"no macro of this name\"}\n");
#endif
#ifdef WUNTRACED
  printf("{\"fact\":\"constant\",\"of\":\"WUNTRACED\",\"value\":%lld}\n", (long long)(WUNTRACED));
#else
  printf("{\"fact\":\"constant\",\"of\":\"WUNTRACED\",\"value\":\"no macro of this name\"}\n");
#endif
#ifdef X_OK
  printf("{\"fact\":\"constant\",\"of\":\"X_OK\",\"value\":%lld}\n", (long long)(X_OK));
#else
  printf("{\"fact\":\"constant\",\"of\":\"X_OK\",\"value\":\"no macro of this name\"}\n");
#endif
#endif
  return 0;
}
