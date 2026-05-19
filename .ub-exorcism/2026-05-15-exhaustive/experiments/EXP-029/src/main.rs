use core::ffi::c_void;

#[repr(u16)]
#[derive(Copy, Clone, Eq, PartialEq)]
enum Tag {
    Empty = 0,
    Refcounted = 1,
    Slice = 2,
}

const PTR_MASK: u128 = (1u128 << 48) - 1;
const TAG_SHIFT: u32 = 48;
const LEN_SHIFT: u32 = 64;

#[repr(transparent)]
#[derive(Copy, Clone)]
struct EnvStr(u128);

impl EnvStr {
    const fn pack(ptr: u64, tag: Tag, len: usize) -> EnvStr {
        EnvStr(
            (ptr as u128 & PTR_MASK)
                | ((tag as u16 as u128) << TAG_SHIFT)
                | ((len as u64 as u128) << LEN_SHIFT),
        )
    }

    fn ptr(self) -> u64 {
        (self.0 & PTR_MASK) as u64
    }

    fn len(self) -> usize {
        (self.0 >> LEN_SHIFT) as u64 as usize
    }

    fn init_slice(s: &[u8]) -> EnvStr {
        if s.is_empty() {
            return Self::pack(0, Tag::Empty, 0);
        }
        Self::pack(to_ptr(s.as_ptr().cast::<c_void>()), Tag::Slice, s.len())
    }

    fn cast_slice(&self) -> &[u8] {
        // Mirrors src/runtime/shell/EnvStr.rs:188-194.
        unsafe { core::slice::from_raw_parts(self.ptr() as usize as *const u8, self.len()) }
    }
}

fn to_ptr(ptr_val: *const c_void) -> u64 {
    (ptr_val as usize as u64) & ((1u64 << 48) - 1)
}

fn main() {
    let backing = b"PATH";
    let env = EnvStr::init_slice(backing);
    let slice = env.cast_slice();
    assert_eq!(slice, backing);
}
