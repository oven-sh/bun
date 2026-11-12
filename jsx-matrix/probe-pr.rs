
#[cfg(test)]
mod alloc_probe {
    use super::*;
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
        let cases: [(&str, Option<&[u8]>, Option<&[u8]>); 4] = [
            ("defaults", None, None),
            ("importSource", Some(b"preact"), None),
            ("factory", None, Some(b"h")),
            ("importSource+factory", Some(b"preact"), Some(b"h")),
        ];
        for (name, import_source, factory) in cases {
            let user = Stated {
                import_source: import_source.map(ImportSource::new),
                factory: factory.map(|text| MemberList::from_text_or(text, defaults::FACTORY)),
                ..Default::default()
            };
            let tsconfig = Stated {
                runtime: Some(Runtime::Automatic),
                development: Some(false),
                ..Default::default()
            };
            let pragma = Pragma::resolve(&[&user, &tsconfig]);
            eprintln!(
                "PROBE {name}: allocations per Pragma clone = {}, per resolve of two layers = {}",
                count(|| pragma.clone()),
                count(|| Pragma::resolve(&[&user, &tsconfig])),
            );
        }
    }
}
