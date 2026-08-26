//! The threads scripts run on, and how each is reached from the others.
//!
//! A block, or an instance of a script-defined class, can end up on any
//! thread a framework likes. The script function behind it only runs on the
//! thread whose JavaScript heap holds it (its [`Owner`]), and the values it
//! holds are only let go there. So every thread that runs scripts registers
//! how it is reached ([`install`]); what turns up on another thread is
//! handed over (a value released there is queued and freed on the owner's
//! next turn; a call there that wants nothing back is queued with its
//! arguments and made on the owner's next turn) or refused (a call that
//! wants a result returns zero there and the owner is told).
//! Once an owner has [retired](Owner::retire) its thread is going away:
//! nothing is queued for it any more, its values are left where they are,
//! and a call meant for it is noted once on stderr instead.

use core::cell::Cell;
use core::ptr::null_mut;
use core::sync::atomic::{AtomicBool, AtomicPtr, AtomicU64, Ordering};
use std::io::Write;
use std::sync::OnceLock;

/// What an owner thread is asked to do.
pub enum Post {
    /// Call [`free_deferred`].
    FreeDeferred,
    /// Report that `what` (`block i@?@`, `-[Class selector]`) was called on
    /// another thread and could not be handed over because `why` (it
    /// returns a value, it takes a pointer), so its caller was given zero.
    WrongThread { what: String, why: &'static str },
    /// Make this call, handed over from another thread with everything it
    /// needs retained; dropping it unmade lets go of that.
    Run(Box<dyn FnOnce() + Send>),
}

/// How a thread that runs scripts is reached from any other: whoever embeds
/// the crate queues the [`Post`] on that thread's event loop and answers
/// there ([`free_deferred`], or an error report).
pub trait Home: Send + Sync {
    /// `false` when the thread no longer takes work.
    fn post(&self, post: Post) -> bool;
}

/// One thread that runs scripts: where its values are freed and its calls
/// reported. Leaked, so anything may keep a `&'static` to it.
pub struct Owner {
    number: u64,
    /// The process main thread, whose scripts end with the process; any
    /// other is a `Worker`'s.
    main: bool,
    /// Empty until [`install`]: nothing reaches the thread from outside.
    home: OnceLock<Box<dyn Home>>,
    /// Values other threads let go of, waiting for [`free_deferred`].
    deferred: AtomicPtr<Deferred>,
    retired: AtomicBool,
    /// A call after retirement has been noted on stderr.
    told: AtomicBool,
}

static THREADS: AtomicU64 = AtomicU64::new(0);

thread_local! {
    static OWNER: Cell<Option<&'static Owner>> = const { Cell::new(None) };
}

/// The calling thread's owner, made now if nothing on the thread asked
/// before; it is reached from outside only once [`install`] has run.
pub fn current() -> &'static Owner {
    OWNER.get().unwrap_or_else(|| {
        let owner: &'static Owner = Box::leak(Box::new(Owner {
            number: THREADS.fetch_add(1, Ordering::Relaxed) + 1,
            main: super::is_main_thread(),
            home: OnceLock::new(),
            deferred: AtomicPtr::new(null_mut()),
            retired: AtomicBool::new(false),
            told: AtomicBool::new(false),
        }));
        OWNER.set(Some(owner));
        owner
    })
}

/// Makes the calling thread's owner reachable through `home`. `true` the
/// first time on a thread; a later call keeps the first home.
pub fn install(home: Box<dyn Home>) -> bool {
    let mut first = false;
    current().home.get_or_init(|| {
        first = true;
        home
    });
    first
}

/// The calling thread's owner, if [`current`] or [`install`] ever ran here.
pub fn this_thread() -> Option<&'static Owner> {
    OWNER.get()
}

impl Owner {
    /// Whether the calling thread is this one.
    #[inline]
    pub fn is_current(&self) -> bool {
        OWNER.get().is_some_and(|o| core::ptr::eq(o, self))
    }

    /// Threads are numbered from 1 in the order they became owners.
    pub fn number(&self) -> u64 {
        self.number
    }

    /// The thread is shutting down: from now on nothing is queued for it and
    /// its script functions are never entered. Call [`free_deferred`] first
    /// to let go of what is already queued.
    pub fn retire(&self) {
        self.retired.store(true, Ordering::Release);
    }

    pub fn retired(&self) -> bool {
        self.retired.load(Ordering::Acquire)
    }

    fn post(&self, post: Post) {
        if !self.retired()
            && let Some(home) = self.home.get()
        {
            home.post(post);
        }
    }

    /// A script function of this owner's was called as `what` on the calling
    /// thread, which is not the owner's, and cannot be handed over because
    /// `why`: tell the owner, or stderr once if it has retired.
    pub(super) fn wrong_thread(&self, what: String, why: &'static str) {
        if self.retired() {
            self.unreachable(&what);
        } else {
            self.post(Post::WrongThread { what, why });
        }
    }

    /// A script function of this owner's was called as `what` on the calling
    /// thread, which is not the owner's, wanting nothing back: `call` makes
    /// the call on the owner's thread when it gets there (or is dropped, if
    /// the owner is going away; stderr is told once when it has gone).
    pub(super) fn hand_over(&self, what: &str, call: Box<dyn FnOnce() + Send>) {
        if self.retired() {
            self.unreachable(what);
        } else {
            self.post(Post::Run(call));
        }
    }

    /// `what` was called after the owner retired; said once per owner, since
    /// nothing on the JavaScript side is left to hear it. Written straight
    /// to stderr: the calling thread can be any (a dispatch queue's, an
    /// `NSThread`), where the process's own output machinery is not set up.
    fn unreachable(&self, what: &str) {
        if !self.told.swap(true, Ordering::Relaxed) {
            let gone = if self.main {
                "the script that created it finished"
            } else {
                "the Worker that created it exited"
            };
            let line = format!(
                "warn: objc: {what} was called after {gone}; this and later such calls do nothing and return 0 / NO / nil\n"
            );
            let _ = std::io::stderr().write_all(line.as_bytes());
        }
    }
}

/// One value waiting to be dropped on its owner's thread.
struct Deferred {
    next: *mut Deferred,
    value: *mut (),
    free: unsafe fn(*mut ()),
}

/// Frees `value` on `owner`'s thread: right away if this is it, otherwise
/// once that thread answers the [`Post::FreeDeferred`] this sends. A retired
/// owner's values are not freed at all: only its thread could, and it is gone.
///
/// # Safety
/// `value` came from `bun_core::heap::into_raw` and nothing else frees it.
pub(super) unsafe fn free_on_owner<T>(owner: &'static Owner, value: *mut T) {
    /// # Safety
    /// As the enclosing function, for a `T`.
    unsafe fn free<T>(value: *mut ()) {
        // SAFETY: per contract.
        drop(unsafe { bun_core::heap::take(value.cast::<T>()) });
    }
    if owner.is_current() {
        // SAFETY: per contract.
        return unsafe { free::<T>(value.cast()) };
    }
    if owner.retired() {
        return;
    }
    let node = bun_core::heap::into_raw(Box::new(Deferred {
        next: null_mut(),
        value: value.cast(),
        free: free::<T>,
    }));
    let mut head = owner.deferred.load(Ordering::Relaxed);
    loop {
        // SAFETY: just allocated; only this thread sees it until the exchange.
        unsafe { (*node).next = head };
        match owner
            .deferred
            .compare_exchange_weak(head, node, Ordering::Release, Ordering::Relaxed)
        {
            Ok(_) => break,
            Err(current) => head = current,
        }
    }
    owner.post(Post::FreeDeferred);
}

/// Frees what other threads have handed the calling thread's owner.
pub fn free_deferred() {
    let Some(owner) = OWNER.get() else {
        return;
    };
    let mut node = owner.deferred.swap(null_mut(), Ordering::Acquire);
    while !node.is_null() {
        // SAFETY: a node `free_on_owner` published for this owner, off the
        // list now so nothing else reaches it; its `free` matches its `value`.
        unsafe {
            let deferred = bun_core::heap::take(node);
            (deferred.free)(deferred.value);
            node = deferred.next;
        }
    }
}
