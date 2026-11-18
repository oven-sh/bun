//! How the functions that multiply rows of digits take their operands.

/// Does not tell the compiler that nothing else refers to the digits. It has to assume that a store to the result
/// changes the operands, and reads them from memory as it multiplies. If it knew better it would load them all up
/// front and spill them.
#[cfg(target_arch = "x86_64")]
pub(crate) type Argument<T> = core::mem::ManuallyDrop<T>;

/// There are registers enough to hold the operands.
#[cfg(not(target_arch = "x86_64"))]
pub(crate) type Argument<T> = core::pin::Pin<T>;
