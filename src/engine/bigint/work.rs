use core::mem::MaybeUninit;

use crate::Error;

/// Called now and then by an operation that takes long. `true` ends it with [`Error::Interrupted`].
pub type Poll<'a> = &'a mut dyn FnMut() -> bool;

/// Counts what an operation has done since it last polled, in about the time of one digit multiplication.
pub(crate) struct Work<'a> {
    poll: Poll<'a>,
    until_poll: usize,
}

impl<'a> Work<'a> {
    const POLL_INTERVAL: usize = 1 << 21;

    #[inline(always)]
    pub(crate) fn new(poll: Poll<'a>) -> Work<'a> {
        Work {
            poll,
            until_poll: Self::POLL_INTERVAL,
        }
    }

    #[inline(always)]
    pub(crate) fn spend(&mut self, amount: usize) -> Result<(), Error> {
        match self.until_poll.checked_sub(amount) {
            Some(left) => {
                self.until_poll = left;
                Ok(())
            }
            None => self.poll(),
        }
    }

    /// Touching fresh memory takes time too.
    pub(crate) fn try_filled<T: Copy>(&mut self, value: T, length: usize) -> Result<Vec<T>, Error> {
        const STEP: usize = 1 << 20;
        let mut vector = try_with_capacity(length)?;
        while vector.len() < length {
            self.spend(STEP.min(length))?;
            vector.resize(length.min(vector.len() + STEP), value);
        }
        Ok(vector)
    }

    #[cold]
    fn poll(&mut self) -> Result<(), Error> {
        self.until_poll = Self::POLL_INTERVAL;
        if (self.poll)() {
            return Err(Error::Interrupted);
        }
        Ok(())
    }
}

pub(crate) fn try_with_capacity<T>(capacity: usize) -> Result<Vec<T>, Error> {
    let mut vector = Vec::new();
    vector
        .try_reserve_exact(capacity)
        .map_err(|_| Error::OutOfMemory)?;
    Ok(vector)
}

/// Temporary storage, on the stack if `N` elements are enough.
pub(crate) struct Scratch<T, const N: usize> {
    stack: [MaybeUninit<T>; N],
    heap: Vec<T>,
}

impl<T: Copy, const N: usize> Scratch<T, N> {
    #[inline(always)]
    pub(crate) fn new() -> Scratch<T, N> {
        Scratch {
            stack: [MaybeUninit::uninit(); N],
            heap: Vec::new(),
        }
    }

    #[inline(always)]
    pub(crate) fn filled(
        &mut self,
        value: T,
        length: usize,
        work: &mut Work<'_>,
    ) -> Result<&mut [T], Error> {
        if let Some(stack) = self.stack.get_mut(..length) {
            return Ok(stack.write_filled(value));
        }
        self.heap = work.try_filled(value, length)?;
        Ok(&mut self.heap)
    }
}
