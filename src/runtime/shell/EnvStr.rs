//! Environment strings need to be copied a lot
//! So we make them reference counted
//!
//! But sometimes we use strings that are statically allocated, or are allocated
//! with a predetermined lifetime (e.g. strings in the AST). In that case we
//! don't want to incur the cost of heap allocating them and refcounting them
//!
//! So environment strings can be ref counted or borrowed slices

use bun_ptr::RefPtr;

use super::ref_counted_str::RefCountedStr;

#[derive(Clone)]
pub(crate) enum EnvStr<'a> {
    Slice(&'a [u8]),
    Refcounted(RefPtr<RefCountedStr>),
}

const _: () = assert!(size_of::<EnvStr<'_>>() == 2 * size_of::<usize>());

impl<'a> EnvStr<'a> {
    #[inline]
    pub(crate) fn init_slice(str: &'a [u8]) -> EnvStr<'a> {
        EnvStr::Slice(str)
    }

    pub(crate) fn init_ref_counted(str: Box<[u8]>) -> EnvStr<'a> {
        if str.is_empty() {
            return EnvStr::init_slice(b"");
        }
        EnvStr::Refcounted(RefCountedStr::init(str))
    }

    pub(crate) fn slice(&self) -> &[u8] {
        match self {
            EnvStr::Slice(s) => s,
            EnvStr::Refcounted(s) => s.byte_slice(),
        }
    }

    pub(crate) fn memory_cost(&self) -> usize {
        match self {
            EnvStr::Slice(s) => s.len(),
            // Shared between envs, so no one env accounts for it.
            EnvStr::Refcounted(_) => 0,
        }
    }
}
