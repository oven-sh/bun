//! WHILE A BUILD RUNS, WHAT THE PROCESS TAKES FROM THE SYSTEM FOR THE FIRST TIME COMES IN PAGES OF 2 MB, AS LONG AS THE
//! SYSTEM HAS BLOCKS OF THAT SIZE FREE. A build touches gigabytes for the first time and reads tables all over them: in
//! pages of 4 KB that is a fault for each, two million and more, and the processor remembers where too few of them lie.
//! On 16 cores the build of a large application takes an eighth less time, and a seventh more memory.
//!
//! A fault in a range that has asked for huge pages takes a free block at once. WHERE NONE IS FREE IT STOPS TO MOVE MEMORY
//! ABOUT UNTIL ONE IS, on every thread that faults: a build of 22 seconds then took 53, 232 of them in the system. The
//! system has no word for "only if one is free", but it says how many are. So nothing is asked for unless there are
//! plenty, and from then on a thread looks every two milliseconds and takes the request back while they are few.
//!
//! Linux only, and only where the system gives huge pages to whoever asks: where it gives them to everybody there is
//! nothing to ask for, and where it gives them to nobody there is nobody to ask.
//!
//! `testaot`, which links no Rust, has the same in C++: `takeHugePagesWhileSystemHasThemFree()` in WebKit's
//! Source/JavaScriptCore/aot/tests/testaot.cpp. Whoever changes one changes the other.

use crate::futex;
use core::sync::atomic::{AtomicU32, Ordering};
use std::sync::Arc;
use std::thread::JoinHandle;

const NANOSECONDS_BETWEEN_LOOKS: u64 = 2_000_000;

/// A fault fills the block with zeros, and no thread writes 2 MB in under an eighth of a millisecond: 16 between two
/// looks. On a busy machine the thread that looks may come three looks late.
#[cfg(not(test))]
const BLOCKS_A_THREAD_TAKES_BETWEEN_LOOKS: usize = 16 * 4;

/// A block of 2 MB is 2^9 pages of 4 KB.
const ORDER_OF_BLOCK: usize = 9;

/// How many blocks of 2 MB are free on the node that has the fewest: a fault asks the node of its thread first, and moves
/// memory about there before it asks another. None where the text cannot be understood.
///
/// `text`: `/proc/buddyinfo`. A line for each zone of each node: how many blocks of 4 KB, of 8 KB and so on are free.
fn free_blocks_of_scarcest_node(text: &[u8]) -> usize {
    let mut fewest = usize::MAX;
    let mut node: &[u8] = b"";
    let mut blocks_of_node = 0usize;
    for line in text.split(|&byte| byte == b'\n') {
        // Node 0, zone   Normal  16068 434773 367939 ..
        let mut words = line
            .split(|byte| byte.is_ascii_whitespace())
            .filter(|word| !word.is_empty());
        let (Some(b"Node"), Some(name), Some(b"zone"), Some(_)) =
            (words.next(), words.next(), words.next(), words.next())
        else {
            continue;
        };
        if name != node {
            if !node.is_empty() {
                fewest = fewest.min(blocks_of_node);
            }
            node = name;
            blocks_of_node = 0;
        }
        for (order, count) in words.enumerate().skip(ORDER_OF_BLOCK) {
            let Some(count) = core::str::from_utf8(count)
                .ok()
                .and_then(|count| count.parse::<usize>().ok())
            else {
                return 0;
            };
            blocks_of_node += count << (order - ORDER_OF_BLOCK);
        }
    }
    if node.is_empty() {
        return 0;
    }
    fewest.min(blocks_of_node)
}

/// `fewest_blocks`: with fewer free, the threads could take the last one before anybody looks again.
/// Twice as many to begin as to go on, or it would go back and forth.
fn has_enough(free_blocks: usize, fewest_blocks: usize, takes_huge_pages: bool) -> bool {
    free_blocks >= if takes_huge_pages { fewest_blocks } else { 2 * fewest_blocks }
}

/// Until `end`, huge pages are asked for while enough blocks are free.
pub(crate) struct Watch {
    /// 1: the build has ended.
    has_ended: Arc<AtomicU32>,
    thread: JoinHandle<()>,
}

impl Watch {
    /// None, and nothing is asked for, where the system has no thread left: nobody would take the request back.
    fn begin(
        count_free_blocks: impl Fn() -> usize + Send + 'static,
        take_huge_pages: impl Fn(bool) + Send + Sync + 'static,
        fewest_blocks: usize,
    ) -> Option<Watch> {
        let has_ended = Arc::new(AtomicU32::new(0));
        let take_huge_pages = Arc::new(take_huge_pages);
        take_huge_pages(true);
        let thread = std::thread::Builder::new().name("AOT huge pages".into()).spawn({
            let has_ended = Arc::clone(&has_ended);
            let take_huge_pages = Arc::clone(&take_huge_pages);
            move || {
                let mut takes_huge_pages = true;
                while has_ended.load(Ordering::Acquire) == 0 {
                    let enough = has_enough(count_free_blocks(), fewest_blocks, takes_huge_pages);
                    if enough != takes_huge_pages {
                        takes_huge_pages = enough;
                        take_huge_pages(enough);
                    }
                    let _ = futex::wait(&has_ended, 0, Some(NANOSECONDS_BETWEEN_LOOKS));
                }
            }
        });
        match thread {
            Ok(thread) => Some(Watch { has_ended, thread }),
            Err(_) => {
                take_huge_pages(false);
                None
            }
        }
    }

    /// `take_huge_pages`: as `begin` got it. What runs in the process from now on takes small pages.
    fn end_with(self, take_huge_pages: impl Fn(bool)) {
        self.has_ended.store(1, Ordering::Release);
        futex::wake(&self.has_ended, 1);
        let _ = self.thread.join();
        take_huge_pages(false);
    }
}

/// A file in which the system says something about itself. Its size is not known in front of the read.
#[cfg(not(test))]
struct FileOfSystem(std::os::fd::OwnedFd);

#[cfg(not(test))]
impl FileOfSystem {
    fn open(path: &core::ffi::CStr) -> Option<FileOfSystem> {
        use std::os::fd::{FromRawFd, OwnedFd};
        // SAFETY: `path` ends in a zero.
        let file = unsafe { libc::open(path.as_ptr(), libc::O_RDONLY | libc::O_CLOEXEC) };
        // SAFETY: the descriptor is open, and nobody else has it.
        (file >= 0).then(|| FileOfSystem(unsafe { OwnedFd::from_raw_fd(file) }))
    }

    /// All that it holds now. None where it cannot be read or does not fit.
    fn read<'text>(&self, text: &'text mut [u8]) -> Option<&'text [u8]> {
        use std::os::fd::AsRawFd;
        let mut length = 0;
        loop {
            let rest = &mut text[length..];
            if rest.is_empty() {
                return None;
            }
            // SAFETY: `rest` is valid for writes of its length.
            let read = unsafe {
                libc::pread(self.0.as_raw_fd(), rest.as_mut_ptr().cast(), rest.len(), length as libc::off_t)
            };
            match usize::try_from(read) {
                Ok(0) => return Some(&text[..length]),
                Ok(read) => length += read,
                Err(_) => return None,
            }
        }
    }
}

/// In front of what a build allocates. None: nothing at all is different from a build without this.
#[cfg(not(test))]
pub(crate) fn begin() -> Option<Watch> {
    // A huge page holds as many small ones as one table of the processor lists: 2 MB of 4 KB, but 512 MB of 64 KB.
    // SAFETY: `sysconf` has no preconditions.
    if unsafe { libc::sysconf(libc::_SC_PAGESIZE) } != 4096 {
        return None;
    }
    let mut who_gets_huge_pages = [0u8; 256];
    if !FileOfSystem::open(c"/sys/kernel/mm/transparent_hugepage/enabled")?
        .read(&mut who_gets_huge_pages)?
        .split(|byte| byte.is_ascii_whitespace())
        .any(|word| word == b"[madvise]")
    {
        return None;
    }
    let blocks_by_size = FileOfSystem::open(c"/proc/buddyinfo")?;
    let count_free_blocks = move || {
        let mut text = [0u8; 16 << 10];
        blocks_by_size.read(&mut text).map_or(0, free_blocks_of_scarcest_node)
    };
    let fewest_blocks =
        std::thread::available_parallelism().ok()?.get() * BLOCKS_A_THREAD_TAKES_BETWEEN_LOOKS;
    if !has_enough(count_free_blocks(), fewest_blocks, false) {
        return None;
    }
    let arena = bun_alloc::ArenaOfBuilds::get()?;
    Watch::begin(count_free_blocks, |takes| arena.take_huge_pages(takes), fewest_blocks)
}

/// The tests of this crate link no allocator.
#[cfg(test)]
pub(crate) fn begin() -> Option<Watch> {
    None
}

impl Watch {
    /// Behind the build.
    pub(crate) fn end(self) {
        #[cfg(not(test))]
        self.end_with(|takes| {
            if let Some(arena) = bun_alloc::ArenaOfBuilds::get() {
                arena.take_huge_pages(takes);
            }
        });
        #[cfg(test)]
        self.end_with(|_| ());
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::Guarded;
    use core::sync::atomic::AtomicUsize;
    use std::time::{Duration, Instant};

    #[test]
    fn the_node_with_the_fewest_free_blocks_counts() {
        // 1 + 2 x 2, 3, and 10 + 2 x 1.
        let text = b"\
Node 0, zone      DMA      1      1      1      1      1      1      1      1      1      1      2 \n\
Node 0, zone   Normal  16068 434773 367939 242059 141679  49363   7718    380      1      3      0 \n\
Node 1, zone   Normal 241537 1289776 554171 309973 163121  60132  11046    758     16     10      1 \n";
        assert_eq!(free_blocks_of_scarcest_node(text), 8);
    }

    #[test]
    fn a_machine_with_one_node_counts_all_its_zones() {
        let text = b"\
Node 0, zone    DMA32      0      0      0      0      0      0      0      0      0      4      0 \n\
Node 0, zone   Normal      0      0      0      0      0      0      0      0      9      0      5 \n";
        assert_eq!(free_blocks_of_scarcest_node(text), 14);
    }

    #[test]
    fn no_block_is_free_where_the_text_cannot_be_understood() {
        assert_eq!(free_blocks_of_scarcest_node(b""), 0);
        assert_eq!(free_blocks_of_scarcest_node(b"something else\n"), 0);
        assert_eq!(
            free_blocks_of_scarcest_node(b"Node 0, zone Normal 1 1 1 1 1 1 1 1 1 many 1\n"),
            0
        );
        // No block of 2 MB is listed.
        assert_eq!(free_blocks_of_scarcest_node(b"Node 0, zone Normal 7 7 7 7 7 7 7 7 7\n"), 0);
    }

    #[test]
    fn it_takes_twice_as_many_blocks_to_begin_as_to_go_on() {
        assert!(!has_enough(199, 100, false));
        assert!(has_enough(200, 100, false));
        assert!(has_enough(100, 100, true));
        assert!(!has_enough(99, 100, true));
    }

    fn wait_until(what: &str, is_so: impl Fn() -> bool) {
        let began = Instant::now();
        while !is_so() {
            assert!(began.elapsed() < Duration::from_secs(30), "never: {what}");
            std::thread::sleep(Duration::from_millis(1));
        }
    }

    #[test]
    fn the_request_is_taken_back_while_blocks_are_few() {
        let free_blocks = Arc::new(AtomicUsize::new(1000));
        let said = Arc::new(Guarded::new(Vec::<bool>::new()));
        let has_said = |all: &[bool]| said.lock().as_slice() == all;
        let say = {
            let said = Arc::clone(&said);
            move |takes: bool| said.lock().push(takes)
        };
        let watch = Watch::begin(
            {
                let free_blocks = Arc::clone(&free_blocks);
                move || free_blocks.load(Ordering::SeqCst)
            },
            say.clone(),
            100,
        )
        .unwrap();
        assert!(has_said(&[true]));

        free_blocks.store(99, Ordering::SeqCst);
        wait_until("taken back", || has_said(&[true, false]));

        // Enough to go on, not to begin again.
        free_blocks.store(199, Ordering::SeqCst);
        std::thread::sleep(Duration::from_millis(20));
        assert!(has_said(&[true, false]));

        free_blocks.store(200, Ordering::SeqCst);
        wait_until("asked again", || has_said(&[true, false, true]));

        watch.end_with(say);
        assert!(has_said(&[true, false, true, false]));
    }
}
