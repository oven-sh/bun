//! Environment strings need to be copied a lot
//! So we make them reference counted
//!
//! But sometimes we use strings that are statically allocated, or are allocated
//! with a predetermined lifetime (e.g. strings in the AST). In that case we
//! don't want to incur the cost of heap allocating them and refcounting them
//!
//! So environment strings can be ref counted or borrowed slices

use std::rc::Rc;

#[derive(Clone, Default)]
pub enum EnvStr {
    /// no value
    #[default]
    Empty,

    /// Dealloced by reference counting
    Refcounted(Rc<[u8]>),

    /// Memory is managed elsewhere: a literal, text of the parsed script, or
    /// the mini event loop's dotenv loader — each outlives every env map of
    /// the interpreter holding it (the [`bun_ptr::BackRef`] invariant).
    Slice(bun_ptr::BackRef<[u8]>),
}

impl EnvStr {
    /// `str` must outlive every env map this value is inserted into; see
    /// [`EnvStr::Slice`]. Use [`Self::dupe_ref_counted`] for anything shorter
    /// lived (argv, cwd buffers, JS strings).
    #[inline]
    pub(crate) fn init_slice(str: &[u8]) -> EnvStr {
        if str.is_empty() {
            return EnvStr::Empty;
        }
        EnvStr::Slice(bun_ptr::BackRef::new(str))
    }

    /// Same thing as `init_ref_counted` except it duplicates the passed string
    pub(crate) fn dupe_ref_counted(old_str: &[u8]) -> EnvStr {
        if old_str.is_empty() {
            return EnvStr::Empty;
        }
        EnvStr::Refcounted(Rc::from(old_str))
    }

    /// Takes ownership of the bytes. Use [`Self::dupe_ref_counted`] to copy a
    /// borrowed slice instead.
    pub(crate) fn init_ref_counted(str: Vec<u8>) -> EnvStr {
        if str.is_empty() {
            return EnvStr::Empty;
        }
        EnvStr::Refcounted(Rc::from(str))
    }

    pub(crate) fn slice(&self) -> &[u8] {
        match self {
            EnvStr::Empty => b"",
            EnvStr::Slice(s) => s.get(),
            EnvStr::Refcounted(r) => r,
        }
    }

    pub(crate) fn memory_cost(&self) -> usize {
        match self {
            EnvStr::Empty => 0,
            EnvStr::Slice(s) => s.len(),
            EnvStr::Refcounted(r) => r.len() / Rc::strong_count(r),
        }
    }
}
