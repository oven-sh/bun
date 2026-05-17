use core::ptr;

#[derive(Copy, Clone)]
struct RawSlice<T>(*const [T]);

impl<T> RawSlice<T> {
    pub const fn new(s: &[T]) -> Self {
        RawSlice(ptr::from_ref(s))
    }

    pub fn slice(&self) -> &[T] {
        unsafe { &*self.0 }
    }
}

unsafe impl<T: Sync> Send for RawSlice<T> {}
unsafe impl<T: Sync> Sync for RawSlice<T> {}

struct IteratorResultWName {
    data: RawSlice<u16>,
}

impl IteratorResultWName {
    pub fn slice(&self) -> &[u16] {
        self.data.slice()
    }
}

struct IteratorResultW {
    name: IteratorResultWName,
}

struct FakeWindowsIterator {
    name_data: [u16; 257],
}

impl FakeWindowsIterator {
    fn next(&mut self) -> Option<IteratorResultW> {
        let dir_info_name = [b'A' as u16, b'B' as u16];
        let len = dir_info_name.len();
        self.name_data[..len].copy_from_slice(&dir_info_name);
        self.name_data[len] = 0;
        Some(IteratorResultW {
            name: IteratorResultWName {
                data: RawSlice::new(&self.name_data[..len]),
            },
        })
    }
}

fn assert_send_sync<T: Send + Sync>() {}

fn main() {
    assert_send_sync::<IteratorResultW>();

    let leaked_result = {
        let mut iter = FakeWindowsIterator {
            name_data: [0; 257],
        };
        iter.next().unwrap()
    };

    let first = leaked_result.name.slice()[0];
    println!("{first}");
}
