#![forbid(unsafe_code)]
//! Managed `ArrayList` wrappers.

use bun_alloc::AllocError;

/// Managed `ArrayList` using the default allocator. No overhead compared to an unmanaged
/// `ArrayList`.
pub type ArrayListDefault<T> = ArrayListAlignedIn<T>;

/// Managed `ArrayList` wrapper around `Vec<T>`.
///
/// NOTE: dropping this type runs `Drop` on each of the items.
#[derive(Default)]
pub struct ArrayListAlignedIn<T> {
    unmanaged: Unmanaged<T>,
}

pub(crate) type Unmanaged<T> = Vec<T>;

impl<T> ArrayListAlignedIn<T> {
    pub fn init() -> Self {
        Self {
            unmanaged: Vec::new(),
        }
    }

    pub fn init_capacity(num: usize) -> Result<Self, AllocError> {
        // Vec::with_capacity aborts on OOM rather than returning Err. Could swap to
        // `Vec::try_with_capacity` (nightly) or a fallible wrapper if OOM recovery matters.
        Ok(Self {
            unmanaged: Vec::with_capacity(num),
        })
    }

    /// The contents of `unmanaged` must have been allocated by the global allocator.
    /// This function takes ownership of `unmanaged`.
    pub fn from_unmanaged(unmanaged: Unmanaged<T>) -> Self {
        Self { unmanaged }
    }

    pub fn append_assume_capacity(&mut self, item: T) {
        self.unmanaged.push(item);
    }
}
