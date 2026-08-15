#![forbid(unsafe_code)]
//! Managed `ArrayList` wrappers.

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

    pub fn init_capacity(num: usize) -> Self {
        Self {
            unmanaged: Vec::with_capacity(num),
        }
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
