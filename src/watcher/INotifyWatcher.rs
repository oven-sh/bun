//! Bun's filesystem watcher implementation for linux using inotify
//! https://man7.org/linux/man-pages/man7/inotify.7.html

use core::ffi::c_int;
use core::mem::{align_of, size_of};
use core::sync::atomic::{AtomicU32, Ordering};

use bun_core::{ZStr, env_var, output as Output};
use bun_paths::MAX_PATH_BYTES;
use bun_sys::{self, Fd};
use bun_threading::Futex;

use crate::watcher_impl::{
    ChangedFilePath, MAX_COUNT as max_count, Op, WatchEvent, WatchItemIndex, Watcher,
};

bun_core::declare_scope!(watcher, visible);

// inotify events are variable-sized, so a byte buffer is used (also needed
// since communication is done via the `read` syscall). what is notable about
// this is that while a max_count is defined, more events than max_count can be
// read if the paths are short. the buffer is sized not to the maximum possible,
// but an arbitrary but reasonable size. when reading, the strategy is to read
// as much as possible, then process the buffer in `max_count` chunks, since
// `bun.Watcher` has the same hardcoded `max_count`.
const EVENTLIST_BYTES_SIZE: usize = (Event::LARGEST_SIZE / 2) * max_count;

/// Aligned to `align_of::<Event>()` so casts from the buffer base are sound.
#[repr(C, align(4))]
pub struct EventListBytes(pub [u8; EVENTLIST_BYTES_SIZE]);
const _: () = assert!(align_of::<Event>() == 4);

#[derive(Clone, Copy)]
struct ReadPtr {
    i: u32,
    len: u32,
}

pub type Platform = INotifyWatcher;

pub struct INotifyWatcher {
    pub fd: Fd,
    pub loaded: bool,

    // Avoid statically allocating because it increases the binary size.
    // TODO(port): lifetime — owned heap allocation; Box matches `default_allocator.alignedAlloc` in init()
    pub eventlist_bytes: Box<EventListBytes>,
    /// pointers into the next chunk of events
    // BACKREF: raw pointers into `eventlist_bytes`; self-referential, never freed individually.
    pub eventlist_ptrs: [*const Event; max_count],
    /// if defined, it means `read` should continue from this offset before asking
    /// for more bytes. this is only hit under high watching load.
    /// see `test-fs-watch-recursive-linux-parallel-remove.js`
    read_ptr: Option<ReadPtr>,

    pub watch_count: AtomicU32,
    /// nanoseconds
    pub coalesce_interval: isize,
}

impl Default for INotifyWatcher {
    fn default() -> Self {
        Self {
            fd: Fd::INVALID,
            loaded: false,
            // PERF(port): Zig left these `undefined` until init(); Box::default() zero-allocates eagerly.
            // TODO(port): consider MaybeUninit<Box<EventListBytes>> to defer allocation to init().
            eventlist_bytes: Box::new(EventListBytes([0; EVENTLIST_BYTES_SIZE])),
            eventlist_ptrs: [core::ptr::null(); max_count],
            read_ptr: None,
            watch_count: AtomicU32::new(0),
            coalesce_interval: 100_000,
        }
    }
}

pub type EventListIndex = c_int;

#[repr(C)]
pub struct Event {
    pub watch_descriptor: EventListIndex,
    pub mask: u32,
    pub cookie: u32,
    /// The name field is present only when an event is returned for a
    /// file inside a watched directory; it identifies the filename
    /// within the watched directory.  This filename is null-terminated,
    /// and may include further null bytes ('\0') to align subsequent
    /// reads to a suitable address boundary.
    ///
    /// The len field counts all of the bytes in name, including the null
    /// bytes; the length of each inotify_event structure is thus
    /// sizeof(struct inotify_event)+len.
    pub name_len: u32,
}

impl Event {
    const LARGEST_SIZE: usize = {
        let n = size_of::<Event>() + MAX_PATH_BYTES;
        let a = align_of::<Event>();
        // std.mem.alignForward
        (n + a - 1) & !(a - 1)
    };

    // TODO(port): Zig uses *align(1) Event everywhere. The kernel pads names so
    // subsequent events are 4-byte aligned, but Zig is defensive. If unaligned
    // reads are observed, switch these to take `*const Event` + read_unaligned.

    pub fn name(&self) -> &ZStr {
        #[cfg(debug_assertions)]
        debug_assert!(
            self.name_len > 0,
            "INotifyWatcher.Event.name() called with name_len == 0, you should check it before calling this function."
        );
        // SAFETY: kernel writes a NUL-terminated name immediately after the
        // fixed-size header when name_len > 0; the bytes live in eventlist_bytes
        // which outlives the returned borrow.
        unsafe {
            let name_first_char_ptr = (&raw const self.name_len)
                .cast::<u8>()
                .add(size_of::<u32>());
            let len = libc::strlen(name_first_char_ptr.cast());
            ZStr::from_raw(name_first_char_ptr, len)
        }
    }

    pub fn size(&self) -> u32 {
        u32::try_from(size_of::<Event>()).expect("int cast") + self.name_len
    }
}

impl INotifyWatcher {
    pub fn watch_path(&mut self, pathname: &ZStr) -> bun_sys::Result<EventListIndex> {
        use bun_sys::linux::IN;
        debug_assert!(self.loaded);
        let old_count = self.watch_count.fetch_add(1, Ordering::Release);
        let watch_file_mask =
            IN::EXCL_UNLINK | IN::MOVE_SELF | IN::DELETE_SELF | IN::MOVED_TO | IN::MODIFY;
        // SAFETY: fd is a valid inotify fd (loaded == true), pathname is NUL-terminated.
        let rc = unsafe {
            bun_sys::linux::inotify_add_watch(self.fd.native(), pathname.as_ptr(), watch_file_mask)
        };
        bun_core::scoped_log!(watcher, "inotify_add_watch({}) = {}", self.fd, rc);
        let result = if rc < 0 {
            Err(
                bun_sys::Error::from_code_int(bun_sys::last_errno(), bun_sys::Tag::watch)
                    .with_path(pathname.as_bytes()),
            )
        } else {
            Ok(rc)
        };
        if old_count == 0 {
            Futex::wake(&self.watch_count, 10);
        }
        result
    }

    pub fn watch_dir(&mut self, pathname: &ZStr) -> bun_sys::Result<EventListIndex> {
        use bun_sys::linux::IN;
        debug_assert!(self.loaded);
        let old_count = self.watch_count.fetch_add(1, Ordering::Release);
        let watch_dir_mask = IN::EXCL_UNLINK
            | IN::DELETE
            | IN::DELETE_SELF
            | IN::CREATE
            | IN::MOVE_SELF
            | IN::ONLYDIR
            | IN::MOVED_TO
            | IN::MODIFY;
        // SAFETY: fd is a valid inotify fd (loaded == true), pathname is NUL-terminated.
        let rc = unsafe {
            bun_sys::linux::inotify_add_watch(self.fd.native(), pathname.as_ptr(), watch_dir_mask)
        };
        bun_core::scoped_log!(watcher, "inotify_add_watch({}) = {}", self.fd, rc);
        let result = if rc < 0 {
            Err(
                bun_sys::Error::from_code_int(bun_sys::last_errno(), bun_sys::Tag::watch)
                    .with_path(pathname.as_bytes()),
            )
        } else {
            Ok(rc)
        };
        if old_count == 0 {
            Futex::wake(&self.watch_count, 10);
        }
        result
    }

    pub fn unwatch(&mut self, wd: EventListIndex) {
        debug_assert!(self.loaded);
        let _ = self.watch_count.fetch_sub(1, Ordering::Release);
        // SAFETY: fd is a valid inotify fd (loaded == true).
        let _ = unsafe { bun_sys::linux::inotify_rm_watch(self.fd.native(), wd) };
    }

    // PORT NOTE: kept as in-place &mut self init (not `-> Result<Self, _>`) because
    // INotifyWatcher is embedded as `Watcher.platform` with field defaults already set.
    pub fn init(&mut self, _root: &[u8]) -> Result<(), bun_core::Error> {
        use bun_sys::linux::IN;
        debug_assert!(!self.loaded);
        self.loaded = true;

        self.coalesce_interval = env_var::BUN_INOTIFY_COALESCE_INTERVAL
            .get()
            .and_then(|v| isize::try_from(v).ok())
            .unwrap_or(100_000);

        // TODO: convert to bun.sys.Error
        // SAFETY: IN::CLOEXEC is a valid flag combination for inotify_init1.
        let raw = unsafe { bun_sys::linux::inotify_init1(IN::CLOEXEC) };
        if raw < 0 {
            // TODO(port): narrow error set — Zig propagated the std.posix error union here.
            return Err(bun_core::err!("InotifyInitFailed"));
        }
        self.fd = Fd::from_native(raw);
        // PERF(port): Zig used alignedAlloc here; eager Box in Default already allocated.
        bun_core::scoped_log!(watcher, "{} init", self.fd);
        Ok(())
    }

    pub fn read(&mut self) -> bun_sys::Result<&[*const Event]> {
        debug_assert!(self.loaded);
        // This is what replit does as of Jaunary 2023.
        // 1) CREATE .http.ts.3491171321~
        // 2) OPEN .http.ts.3491171321~
        // 3) ATTRIB .http.ts.3491171321~
        // 4) MODIFY .http.ts.3491171321~
        // 5) CLOSE_WRITE,CLOSE .http.ts.3491171321~
        // 6) MOVED_FROM .http.ts.3491171321~
        // 7) MOVED_TO http.ts
        // We still don't correctly handle MOVED_FROM && MOVED_TO it seems.
        use bun_sys::linux as system;
        use bun_sys::{E, get_errno};
        let mut i: u32 = 0;
        // PORT NOTE: reshaped for borrowck — track length instead of borrowing a sub-slice
        // of self.eventlist_bytes across the whole function.
        let read_len: usize = if let Some(ptr) = self.read_ptr {
            Futex::wait_forever(&self.watch_count, 0);
            i = ptr.i;
            ptr.len as usize
        } else {
            'outer: loop {
                Futex::wait_forever(&self.watch_count, 0);

                // SAFETY: fd is a valid inotify fd; buffer is valid for eventlist_bytes.len() bytes.
                let rc = unsafe {
                    system::read(
                        self.fd.native(),
                        self.eventlist_bytes.0.as_mut_ptr(),
                        self.eventlist_bytes.0.len(),
                    )
                };
                let errno = get_errno(rc);
                match errno {
                    E::SUCCESS => {
                        let mut read_len = usize::try_from(rc).expect("int cast");
                        bun_core::scoped_log!(watcher, "{} read {} bytes", self.fd, read_len);
                        if read_len == 0 {
                            return Ok(&[]);
                        }

                        // IN_MODIFY is very noisy
                        // we do a 0.1ms sleep to try to coalesce events better
                        const DOUBLE_READ_THRESHOLD: usize = Event::LARGEST_SIZE * (max_count / 2);
                        if read_len < DOUBLE_READ_THRESHOLD {
                            let mut fds = [system::pollfd {
                                fd: self.fd.native(),
                                // `std.posix.POLL.IN | std.posix.POLL.ERR`
                                events: (libc::POLLIN | libc::POLLERR) as _,
                                revents: 0,
                            }];
                            let timespec = libc::timespec {
                                tv_sec: 0,
                                tv_nsec: self.coalesce_interval as _,
                            };
                            // SAFETY: fds and timespec are valid stack locals; sigmask is null.
                            // Zig: `(std.posix.ppoll(&fds, &timespec, null) catch 0) > 0`.
                            let poll_n = unsafe {
                                system::ppoll(
                                    fds.as_mut_ptr(),
                                    fds.len(),
                                    &raw const timespec,
                                    core::ptr::null(),
                                )
                            };
                            if poll_n > 0 {
                                'inner: loop {
                                    let rest = &mut self.eventlist_bytes.0[read_len..];
                                    debug_assert!(!rest.is_empty());
                                    // SAFETY: fd valid; rest is a valid mutable buffer.
                                    let new_rc = unsafe {
                                        system::read(
                                            self.fd.native(),
                                            rest.as_mut_ptr(),
                                            rest.len(),
                                        )
                                    };
                                    let e = get_errno(new_rc);
                                    match e {
                                        E::SUCCESS => {
                                            read_len += usize::try_from(new_rc).expect("int cast");
                                            break 'outer read_len;
                                        }
                                        E::EAGAIN | E::EINTR => {
                                            continue 'inner;
                                        }
                                        _ => {
                                            return Err(bun_sys::Error {
                                                errno: e as u32 as _,
                                                syscall: bun_sys::Tag::read,
                                                ..Default::default()
                                            });
                                        }
                                    }
                                }
                            }
                        }

                        break 'outer read_len;
                    }
                    E::EAGAIN | E::EINTR => continue 'outer,
                    E::EINVAL => {
                        if cfg!(debug_assertions) {
                            Output::err(
                                "EINVAL",
                                "inotify read({}, {})",
                                (self.fd, self.eventlist_bytes.0.len()),
                            );
                        }
                        return Err(bun_sys::Error {
                            errno: errno as u32 as _,
                            syscall: bun_sys::Tag::read,
                            ..Default::default()
                        });
                    }
                    _ => {
                        return Err(bun_sys::Error {
                            errno: errno as u32 as _,
                            syscall: bun_sys::Tag::read,
                            ..Default::default()
                        });
                    }
                }
            }
        };

        let read_eventlist_bytes = &self.eventlist_bytes.0[..read_len];

        let mut count: u32 = 0;
        while (i as usize) < read_eventlist_bytes.len() {
            // It is NOT aligned naturally. It is align 1!!!
            // SAFETY: i is within bounds; the bytes at this offset form a valid
            // inotify_event header written by the kernel. See TODO on Event re: alignment.
            let event: *const Event = unsafe {
                read_eventlist_bytes
                    .as_ptr()
                    .add(i as usize)
                    .cast::<Event>()
            };
            self.eventlist_ptrs[count as usize] = event;
            // SAFETY: event points to a valid header; size() reads name_len which the kernel set.
            i += unsafe { (*event).size() };
            count += 1;

            // when under high load with short file paths, it is very easy to
            // overrun the watcher's event buffer.
            if count as usize == max_count {
                self.read_ptr = Some(ReadPtr {
                    i,
                    len: u32::try_from(read_eventlist_bytes.len()).expect("int cast"),
                });
                bun_core::scoped_log!(watcher, "{} read buffer filled up", self.fd);
                return Ok(&self.eventlist_ptrs[..]);
            }
        }

        self.read_ptr = None;
        Ok(&self.eventlist_ptrs[..count as usize])
    }

    pub fn stop(&mut self) {
        bun_core::scoped_log!(watcher, "{} stop", self.fd);
        if self.fd != Fd::INVALID {
            let _ = bun_sys::close(self.fd);
            self.fd = Fd::INVALID;
        }
    }
}

/// Repeatedly called by the main watcher until the watcher is terminated.
pub fn watch_loop_cycle(this: &mut Watcher) -> bun_sys::Result<()> {
    use crate::watcher_impl::WatchItemColumns;
    let _flush = Output::flush_guard();

    let events = this.platform.read()?;
    if events.is_empty() {
        return Ok(());
    }

    // PORT NOTE: reshaped for borrowck — copy raw event pointers to a local buffer so
    // `this.platform` borrow ends before we mutably borrow other `this` fields below.
    // PERF(port): Zig used the platform's eventlist_ptrs slice directly.
    let events_len = events.len();
    let mut events_buf: [*const Event; max_count] = [core::ptr::null(); max_count];
    events_buf[..events_len].copy_from_slice(events);
    let events = &events_buf[..events_len];

    // Zig: `this.watchlist.items(.eventlist_index)`.
    // PORT NOTE: reshaped for borrowck — copy the (small) column to a local Vec
    // so the borrow of `this.watchlist` ends before we mutably borrow other
    // `this` fields inside the batching loop below.
    // PERF(port): Zig used the column slice directly.
    //
    // PORT NOTE: locked — diverges from Zig spec (which reads this column
    // unlocked). `on_file_update` may evict watchlist entries via
    // `remove_at_index` + `flush_evictions` (the dir-event path appends *and*
    // evicts the matched file watch). The enqueued reload then re-imports the
    // module on the JS thread, whose `add_file` re-appends the entry under
    // `this.mutex`, potentially reallocating the MultiArrayList backing while
    // this thread is mid-`items_eventlist_index()` on the next cycle. Under
    // load (`watch-many-dirs.test.ts` writes 129 files concurrently, > the
    // 128 `max_count` batch size, so the dir-event-only batch is common) the
    // unlocked read raced the realloc and the process occasionally died with
    // a non-zero exit code. Snapshot under the same mutex `add_file` takes.
    let eventlist_index: Vec<EventListIndex> = {
        let _guard = this.mutex.lock_guard();
        this.watchlist.items_eventlist_index().to_vec()
    };

    let mut event_id: usize = 0;
    let mut events_processed: usize = 0;

    while events_processed < events.len() {
        let mut name_off: u8 = 0;
        // PERF(port): Zig left this `undefined`; we zero-init for safety.
        let mut temp_name_list: [Option<&ZStr>; 128] = [None; 128];
        let mut temp_name_off: u8 = 0;
        let _ = name_off; // matches Zig: declared but only reset, never read here

        // Process events one by one, batching when we hit limits
        while events_processed < events.len() {
            // SAFETY: events[i] is a pointer into platform.eventlist_bytes which lives for
            // the duration of this call (platform is a field of `this`).
            let event = unsafe { &*events[events_processed] };

            // Check if we're about to exceed the watch_events array capacity
            if event_id >= this.watch_events.len() {
                process_inotify_event_batch(
                    this,
                    event_id,
                    &temp_name_list[..temp_name_off as usize],
                )?;
                event_id = 0;
                name_off = 0;
                temp_name_off = 0;
            }

            // Check if we can fit this event's name in temp_name_list
            let will_have_name = event.name_len > 0;
            if will_have_name && (temp_name_off as usize) >= temp_name_list.len() {
                if event_id > 0 {
                    process_inotify_event_batch(
                        this,
                        event_id,
                        &temp_name_list[..temp_name_off as usize],
                    )?;
                    event_id = 0;
                    name_off = 0;
                    temp_name_off = 0;
                }
            }

            let idx = match eventlist_index
                .iter()
                .position(|&x| x == event.watch_descriptor)
            {
                Some(idx) => WatchItemIndex::try_from(idx).unwrap(),
                None => {
                    events_processed += 1;
                    continue;
                }
            };
            this.watch_events[event_id] = watch_event_from_inotify_event(event, idx);

            // Safely handle event names with bounds checking
            if event.name_len > 0 && (temp_name_off as usize) < temp_name_list.len() {
                temp_name_list[temp_name_off as usize] = Some(event.name());
                this.watch_events[event_id].name_off = temp_name_off;
                this.watch_events[event_id].name_len = 1;
                temp_name_off += 1;
            } else {
                this.watch_events[event_id].name_off = temp_name_off;
                this.watch_events[event_id].name_len = 0;
            }

            event_id += 1;
            events_processed += 1;
        }

        // Process any remaining events in the final batch
        if event_id > 0 {
            process_inotify_event_batch(this, event_id, &temp_name_list[..temp_name_off as usize])?;
        }
        let _ = name_off;
        break;
    }

    Ok(())
}

fn process_inotify_event_batch(
    this: &mut Watcher,
    event_count: usize,
    temp_name_list: &[Option<&'static ZStr>],
) -> bun_sys::Result<()> {
    if event_count == 0 {
        return Ok(());
    }

    let mut name_off: u8 = 0;
    let watch_events = &mut this.watch_events[..event_count];
    // std.sort.pdq → slice::sort_unstable_by (pdqsort under the hood)
    watch_events.sort_unstable_by(WatchEvent::sort_by_index);

    let mut last_event_index: usize = 0;
    let mut last_event_id: WatchItemIndex = WatchItemIndex::MAX;

    for i in 0..watch_events.len() {
        if watch_events[i].name_len > 0 {
            // Check bounds before accessing arrays
            if (name_off as usize) < this.changed_filepaths.len()
                && (watch_events[i].name_off as usize) < temp_name_list.len()
            {
                this.changed_filepaths[name_off as usize] =
                    temp_name_list[watch_events[i].name_off as usize];
                watch_events[i].name_off = name_off;
                name_off += 1;
            }
        }

        if watch_events[i].index == last_event_id {
            // PORT NOTE: reshaped for borrowck — split_at_mut to get two disjoint &mut.
            let (head, tail) = watch_events.split_at_mut(i);
            head[last_event_index].merge(tail[0]);
            continue;
        }
        last_event_index = i;
        last_event_id = watch_events[i].index;
    }
    if watch_events.is_empty() {
        return Ok(());
    }
    // End the &mut borrow of `this` via `watch_events` before re-borrowing other
    // fields below; we re-slice `this.watch_events` directly after the lock.
    let _ = watch_events;

    let _guard = this.mutex.lock_guard();
    if this.running.load() {
        // watch_events.len == 0 is checked above, so last_event_index + 1 is safe.
        // PORT NOTE: reshaped for borrowck — split disjoint field borrows so we can
        // pass `&mut watch_events[..]` in place (matching Zig's `all_events[0..]`)
        // without a gratuitous `.to_vec()`/`.clone()`.
        let deduped = &mut this.watch_events[..last_event_index + 1];
        let changed = &this.changed_filepaths[..name_off as usize];
        crate::watcher_trace::write_events(&this.watchlist, deduped, changed);
        (this.on_file_update)(this.ctx, deduped, changed, &this.watchlist);
    }

    Ok(())
}

pub fn watch_event_from_inotify_event(event: &Event, index: WatchItemIndex) -> WatchEvent {
    use bun_sys::linux::IN;
    let mut op = Op::empty();
    if (event.mask & IN::DELETE_SELF) > 0 || (event.mask & IN::DELETE) > 0 {
        op |= Op::DELETE;
    }
    if (event.mask & IN::MOVE_SELF) > 0 {
        op |= Op::RENAME;
    }
    if (event.mask & IN::MOVED_TO) > 0 {
        op |= Op::MOVE_TO;
    }
    if (event.mask & IN::MODIFY) > 0 {
        op |= Op::WRITE;
    }
    if (event.mask & IN::CREATE) > 0 {
        op |= Op::CREATE;
    }
    WatchEvent {
        op,
        index,
        ..Default::default()
    }
}

// ported from: src/watcher/INotifyWatcher.zig
