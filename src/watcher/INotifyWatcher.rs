//! Bun's filesystem watcher implementation for linux using inotify
//! https://man7.org/linux/man-pages/man7/inotify.7.html

use core::ffi::c_int;

use bun_core::{ZStr, env_var, output as Output};
use bun_paths::MAX_PATH_BYTES;
use bun_sys::{self, CloseOnDrop, Fd};

use crate::watcher_impl::{
    MAX_COUNT as max_count, Op, WatchEvent, WatchItemColumns, WatchItemIndex, Watcher,
    WatcherThread,
};
use bun_collections::index_sort;

bun_core::declare_scope!(watcher, visible);

// inotify events are variable-sized, so a byte buffer is used (also needed
// since communication is done via the `read` syscall). what is notable about
// this is that while a max_count is defined, more events than max_count can be
// read if the paths are short. the buffer is sized not to the maximum possible,
// but an arbitrary but reasonable size. when reading, the strategy is to read
// as much as possible, then process the buffer in `max_count` chunks, since
// `bun.Watcher` has the same hardcoded `max_count`.
const EVENTLIST_BYTES_SIZE: usize = (Event::LARGEST_SIZE / 2) * max_count;

pub(crate) type Platform = INotifyWatcher;

pub struct INotifyWatcher {
    pub(crate) fd: CloseOnDrop,
    /// Readable from [`Watcher::wake`] on.
    eventfd: CloseOnDrop,
    /// nanoseconds
    pub(crate) coalesce_interval: isize,
}

pub(crate) type EventListIndex = c_int;

/// An `inotify_event`.
pub struct Event<'a> {
    pub watch_descriptor: EventListIndex,
    pub mask: u32,
    padded_name: &'a [u8],
}

impl<'a> Event<'a> {
    const HEADER_SIZE: usize = size_of::<libc::inotify_event>();
    const LARGEST_SIZE: usize = Self::HEADER_SIZE + MAX_PATH_BYTES;

    /// Only an event for a file inside a watched directory has one.
    pub fn name(&self) -> Option<&'a [u8]> {
        (!self.padded_name.is_empty()).then(|| bun_core::slice_to_nul(self.padded_name))
    }
}

/// The events in the bytes read from an inotify descriptor.
pub struct EventIterator<'a>(pub &'a [u8]);

impl<'a> Iterator for EventIterator<'a> {
    type Item = Event<'a>;

    fn next(&mut self) -> Option<Event<'a>> {
        let bytes = core::mem::take(&mut self.0);
        let [wd, mask, _cookie, name_len]: [u32; 4] = bun_core::read_prefix(bytes)?;
        let (padded_name, rest) =
            bytes[Event::HEADER_SIZE..].split_at_checked(name_len as usize)?;
        self.0 = rest;
        Some(Event {
            watch_descriptor: wd as EventListIndex,
            mask,
            padded_name,
        })
    }
}

impl INotifyWatcher {
    pub(crate) fn watch_path(&self, pathname: &ZStr) -> bun_sys::Result<EventListIndex> {
        use bun_sys::linux::IN;
        let watch_file_mask =
            IN::EXCL_UNLINK | IN::MOVE_SELF | IN::DELETE_SELF | IN::MOVED_TO | IN::MODIFY;
        let rc =
            bun_sys::linux::inotify_add_watch(self.fd.fd().native(), pathname, watch_file_mask);
        bun_core::scoped_log!(watcher, "inotify_add_watch({}) = {}", self.fd.fd(), rc);
        if rc < 0 {
            Err(
                bun_sys::Error::from_code_int(bun_sys::last_errno(), bun_sys::Tag::watch)
                    .with_path(pathname.as_bytes()),
            )
        } else {
            Ok(rc)
        }
    }

    pub(crate) fn watch_dir(&self, pathname: &ZStr) -> bun_sys::Result<EventListIndex> {
        use bun_sys::linux::IN;
        let watch_dir_mask = IN::EXCL_UNLINK
            | IN::DELETE
            | IN::DELETE_SELF
            | IN::CREATE
            | IN::MOVE_SELF
            | IN::ONLYDIR
            | IN::MOVED_TO
            | IN::MODIFY;
        let rc = bun_sys::linux::inotify_add_watch(self.fd.fd().native(), pathname, watch_dir_mask);
        bun_core::scoped_log!(watcher, "inotify_add_watch({}) = {}", self.fd.fd(), rc);
        if rc < 0 {
            Err(
                bun_sys::Error::from_code_int(bun_sys::last_errno(), bun_sys::Tag::watch)
                    .with_path(pathname.as_bytes()),
            )
        } else {
            Ok(rc)
        }
    }

    pub(crate) fn new(_root: &[u8]) -> crate::Result<Self> {
        use bun_sys::linux::IN;

        let raw = bun_sys::linux::inotify_init1(IN::CLOEXEC);
        let errno = bun_sys::get_errno(raw);
        if errno != bun_sys::E::SUCCESS {
            // Surface the errno name (e.g. EMFILE) instead of a generic
            // init-failed tag.
            return Err(crate::Error::Sys(errno));
        }
        let fd = CloseOnDrop::new(Fd::from_native(raw));
        bun_core::scoped_log!(watcher, "{} init", fd.fd());
        Ok(Self {
            fd,
            eventfd: CloseOnDrop::new(bun_sys::eventfd(0, libc::EFD_CLOEXEC)?),
            coalesce_interval: env_var::BUN_INOTIFY_COALESCE_INTERVAL
                .get()
                .and_then(|v| isize::try_from(v).ok())
                .unwrap_or(100_000),
        })
    }

    /// For an event, or for [`Watcher::wake`].
    fn wait(&self) {
        use bun_sys::linux::{pollfd, ppoll};
        let mut fds = [&self.fd, &self.eventfd].map(|file| pollfd {
            fd: file.fd().native(),
            events: libc::POLLIN,
            revents: 0,
        });
        while bun_sys::get_errno(ppoll(&mut fds, None, None)) == bun_sys::E::EINTR {}
    }

    /// Returns how many bytes it read.
    fn read(&self, bytes: &mut [u8]) -> bun_sys::Result<usize> {
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
        loop {
            let rc = system::read(self.fd.fd().native(), bytes);
            let errno = get_errno(rc);
            match errno {
                E::SUCCESS => {
                    let read_len = usize::try_from(rc).expect("int cast");
                    bun_core::scoped_log!(watcher, "{} read {} bytes", self.fd.fd(), read_len);
                    if read_len == 0 {
                        return Ok(0);
                    }

                    // IN_MODIFY is very noisy
                    // we do a 0.1ms sleep to try to coalesce events better
                    const DOUBLE_READ_THRESHOLD: usize = Event::LARGEST_SIZE * (max_count / 2);
                    if read_len < DOUBLE_READ_THRESHOLD {
                        let mut fds = [system::pollfd {
                            fd: self.fd.fd().native(),
                            events: (libc::POLLIN | libc::POLLERR) as _,
                            revents: 0,
                        }];
                        let timespec = libc::timespec {
                            tv_sec: 0,
                            tv_nsec: self.coalesce_interval as _,
                        };
                        let poll_n = system::ppoll(&mut fds, Some(&timespec), None);
                        if poll_n > 0 {
                            'inner: loop {
                                let rest = &mut bytes[read_len..];
                                debug_assert!(!rest.is_empty());
                                let new_rc = system::read(self.fd.fd().native(), rest);
                                let e = get_errno(new_rc);
                                match e {
                                    E::SUCCESS => {
                                        return Ok(
                                            read_len + usize::try_from(new_rc).expect("int cast")
                                        );
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

                    return Ok(read_len);
                }
                E::EAGAIN | E::EINTR => continue,
                E::EINVAL => {
                    if cfg!(debug_assertions) {
                        Output::err(
                            "EINVAL",
                            "inotify read({}, {})",
                            (self.fd.fd(), bytes.len()),
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
    }
}

impl Watcher {
    pub(crate) fn wake(&self) {
        let _ = self.platform.eventfd.write_all(&1u64.to_ne_bytes());
    }
}

pub(crate) fn watch_loop(this: &Watcher, thread: &mut WatcherThread) -> bun_sys::Result<()> {
    this.platform.wait();
    let mut bytes = vec![0u8; EVENTLIST_BYTES_SIZE].into_boxed_slice();
    let mut eventlist_index_scratch = Vec::new();
    while this.running.load() {
        let len = this.platform.read(&mut bytes)?;
        let mut events = EventIterator(&bytes[..len]);
        // More than one batch only under load, see `watch-many-dirs.test.ts`.
        while !events.0.is_empty() && this.running.load() {
            process_inotify_event_batch(this, thread, &mut events, &mut eventlist_index_scratch);
        }
        this.platform.wait();
    }
    Ok(())
}

fn process_inotify_event_batch(
    this: &Watcher,
    thread: &mut WatcherThread,
    events: &mut EventIterator<'_>,
    eventlist_index_scratch: &mut Vec<EventListIndex>,
) {
    let _flush = Output::flush_guard();

    eventlist_index_scratch.clear();
    eventlist_index_scratch.extend_from_slice(this.state.lock().watchlist.items_eventlist_index());

    let mut event_count: usize = 0;
    let mut temp_name_list: [&[u8]; max_count] = [b""; max_count];
    let mut temp_name_off: u8 = 0;

    for event in events.take(max_count) {
        let Some(idx) = eventlist_index_scratch
            .iter()
            .position(|&x| x == event.watch_descriptor)
        else {
            continue;
        };
        let watch_event = &mut thread.watch_events[event_count];
        *watch_event =
            watch_event_from_inotify_event(&event, WatchItemIndex::try_from(idx).unwrap());
        watch_event.name_off = temp_name_off;
        if let Some(name) = event.name() {
            temp_name_list[temp_name_off as usize] = name;
            watch_event.name_len = 1;
            temp_name_off += 1;
        }
        event_count += 1;
    }
    if event_count == 0 {
        return;
    }

    let mut changed_filepaths: [&[u8]; max_count] = [b""; max_count];
    let mut name_off: u8 = 0;
    let watch_events = &mut thread.watch_events[..event_count];
    index_sort::sort_slice_unstable_by(watch_events, |a, b| WatchEvent::sort_by_index(*a, *b));

    let mut last_event_index: usize = 0;
    let mut last_event_id: WatchItemIndex = WatchItemIndex::MAX;

    for i in 0..watch_events.len() {
        if watch_events[i].name_len > 0 {
            changed_filepaths[name_off as usize] =
                temp_name_list[watch_events[i].name_off as usize];
            watch_events[i].name_off = name_off;
            name_off += 1;
        }

        if watch_events[i].index == last_event_id {
            // reshaped for borrowck — split_at_mut to get two disjoint &mut.
            let (head, tail) = watch_events.split_at_mut(i);
            head[last_event_index].merge(tail[0]);
            continue;
        }
        last_event_index = i;
        last_event_id = watch_events[i].index;
    }

    this.dispatch_file_updates(
        thread,
        last_event_index + 1,
        &changed_filepaths[..name_off as usize],
    );
}

fn watch_event_from_inotify_event(event: &Event<'_>, index: WatchItemIndex) -> WatchEvent {
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
