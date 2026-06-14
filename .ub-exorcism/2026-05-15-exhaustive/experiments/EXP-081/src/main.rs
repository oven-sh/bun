use std::ptr::NonNull;

pub struct IteratorResult {
    pub name: Name,
}

#[derive(Copy, Clone)]
pub struct Name {
    ptr: NonNull<u8>,
    len: usize,
}

unsafe impl Send for Name {}
unsafe impl Sync for Name {}

impl Name {
    fn borrow(s: &[u8]) -> Name {
        Name {
            ptr: NonNull::from(s).cast(),
            len: s.len(),
        }
    }

    pub fn slice_u8(&self) -> &[u8] {
        unsafe { std::slice::from_raw_parts(self.ptr.as_ptr(), self.len) }
    }
}

struct FakePosixIterator {
    buf: Box<[u8]>,
}

impl FakePosixIterator {
    fn new() -> Self {
        Self {
            buf: b"entry-name\0".to_vec().into_boxed_slice(),
        }
    }

    pub fn next(&mut self) -> Option<IteratorResult> {
        let name = &self.buf[..10];
        Some(IteratorResult {
            name: Name::borrow(name),
        })
    }
}

fn main() {
    let entry = {
        let mut iter = FakePosixIterator::new();
        iter.next().unwrap()
    };

    let first = entry.name.slice_u8()[0];
    std::hint::black_box(first);
}

