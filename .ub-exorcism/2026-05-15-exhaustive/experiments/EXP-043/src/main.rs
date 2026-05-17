//! EXP-043 — Mirror of `runtime::cli::test::Scanner::resolve_dir_for_test`
//!
//! Production shape (src/runtime/cli/test/Scanner.rs:255-265, also :365):
//!
//!     // self: &mut Scanner
//!     //  → &self.fs            (shared reborrow over &'a FileSystem)
//!     //  → &self.fs.fs         (shared reborrow over &RealFS)
//!     let real_fs = core::ptr::from_ref(&self.fs.fs).cast_mut();
//!     #[allow(invalid_reference_casting)]
//!     unsafe { &mut *real_fs }.read_directory_with_iterator(...);
//!
//! Compared with EXP-042 (top-level reference cast), this experiment
//! exercises the field-projection-from-`&self` shape: two shared reborrows
//! followed by `from_ref().cast_mut()` and a `&mut *` reforge.
//!
//! `entries_mutex` defends against races (bucket 7) only; it does not heal
//! the aliasing/validity tag installed by the shared reborrow chain.

struct RealFS {
    counter: u32,
}

impl RealFS {
    fn read_directory_with_iterator(&mut self) {
        self.counter = self.counter.wrapping_add(1);
    }
}

struct FileSystem {
    fs: RealFS,
}

struct Scanner<'a> {
    fs: &'a FileSystem,
}

impl<'a> Scanner<'a> {
    fn resolve_dir_for_test(&mut self) {
        // Mirror the borrow chain: &mut self → &self.fs (shared reborrow over
        // &'a FileSystem) → &self.fs.fs (shared reborrow over &RealFS).
        let real_fs = core::ptr::from_ref(&self.fs.fs).cast_mut();
        #[allow(invalid_reference_casting)]
        let m = unsafe { &mut *real_fs };
        m.read_directory_with_iterator();
    }
}

fn main() {
    let fs = FileSystem {
        fs: RealFS { counter: 0 },
    };
    let mut scanner = Scanner { fs: &fs };
    scanner.resolve_dir_for_test();
    core::hint::black_box(fs.fs.counter);
}
