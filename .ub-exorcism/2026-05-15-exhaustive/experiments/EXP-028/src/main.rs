#![deny(unsafe_op_in_unsafe_fn)]

#[repr(C)]
struct DevServer {
    directory_watchers: DirectoryWatchStore,
    graph_safety_lock: Lock,
    other: u32,
}

#[repr(C)]
struct DirectoryWatchStore {
    tracked: u32,
}

#[repr(C)]
struct Lock {
    state: u32,
}

impl Lock {
    fn lock(&self) {
        core::hint::black_box(self.state);
    }
}

impl DirectoryWatchStore {
    fn owner(&mut self) -> &mut DevServer {
        // Mirrors `DirectoryWatchStore::owner`: recover the containing parent
        // from a mutable borrow of one field, then return `&mut Parent`.
        let field_ptr = core::ptr::from_mut::<Self>(self);
        let parent_ptr = field_ptr.cast::<DevServer>();

        unsafe { &mut *parent_ptr }
    }
}

fn track_resolution_failure_like(store: &mut DirectoryWatchStore) {
    let dev = store.owner();
    dev.graph_safety_lock.lock();
    dev.other = 3;

    // Mirrors the current source after its final parent-field use: no
    // reference/guard into `dev` remains live in Rust's type system.
    store.tracked += 1;
}

fn main() {
    let mut dev = DevServer {
        directory_watchers: DirectoryWatchStore { tracked: 1 },
        graph_safety_lock: Lock { state: 0 },
        other: 2,
    };

    track_resolution_failure_like(&mut dev.directory_watchers);
}
