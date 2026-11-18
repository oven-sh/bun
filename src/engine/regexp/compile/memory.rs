//! Memory whose size the pattern decides.

use crate::Error;

const MAX_ELEMENTS: usize = 1 << 24;

#[inline]
pub(crate) fn reserve<T>(elements: &mut Vec<T>, additional: usize) -> Result<(), Error> {
    if additional > elements.capacity() - elements.len() {
        grow(elements, additional)?;
    }
    Ok(())
}

#[cold]
fn grow<T>(elements: &mut Vec<T>, additional: usize) -> Result<(), Error> {
    if additional > MAX_ELEMENTS.saturating_sub(elements.len()) {
        return Err(Error::PatternTooLarge);
    }
    elements
        .try_reserve(additional)
        .map_err(|_| Error::OutOfMemory)
}

#[inline]
pub(crate) fn push<T>(elements: &mut Vec<T>, element: T) -> Result<(), Error> {
    reserve(elements, 1)?;
    elements.push(element);
    Ok(())
}

/// In the place of what is there.
#[inline]
pub(crate) fn fill<T: Clone>(elements: &mut Vec<T>, length: usize, value: T) -> Result<(), Error> {
    elements.clear();
    reserve(elements, length)?;
    elements.resize(length, value);
    Ok(())
}

/// The lowest address that the native stack may reach.
#[derive(Clone, Copy)]
pub(crate) struct StackLimit(pub(crate) usize);

impl StackLimit {
    #[inline]
    pub(crate) fn check(self) -> Result<(), Error> {
        let local = 0u8;
        match (&raw const local).addr() < self.0 {
            true => Err(Error::TooDeeplyNested),
            false => Ok(()),
        }
    }
}
