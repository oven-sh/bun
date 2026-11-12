
#[cfg(test)]
mod alloc_probe {
    use super::*;
    use crate::schema::api;
    use std::alloc::{GlobalAlloc, Layout, System};
    use std::cell::Cell;
    thread_local! { static ALLOCS: Cell<usize> = const { Cell::new(0) }; }
    struct Counting;
    unsafe impl GlobalAlloc for Counting {
        unsafe fn alloc(&self, l: Layout) -> *mut u8 {
            ALLOCS.with(|c| c.set(c.get() + 1));
            unsafe { System.alloc(l) }
        }
        unsafe fn dealloc(&self, p: *mut u8, l: Layout) {
            unsafe { System.dealloc(p, l) }
        }
    }
    #[global_allocator]
    static A: Counting = Counting;
    fn count<T>(f: impl FnOnce() -> T) -> usize {
        let before = ALLOCS.with(|c| c.get());
        let v = f();
        let n = ALLOCS.with(|c| c.get()) - before;
        drop(v);
        n
    }
    #[test]
    fn probe() {
        let cases: [(&str, &[u8], &[u8]); 4] = [
            ("defaults", b"", b""),
            ("importSource", b"preact", b""),
            ("factory", b"", b"h"),
            ("importSource+factory", b"preact", b"h"),
        ];
        for (name, import_source, factory) in cases {
            let pragma = Pragma::from_api(api::Jsx {
                import_source: import_source.into(),
                factory: factory.into(),
                runtime: api::JsxRuntime::Automatic,
                ..Default::default()
            });
            eprintln!("PROBE {name}: allocations per Pragma clone = {}", count(|| pragma.clone()));
        }
    }
}
