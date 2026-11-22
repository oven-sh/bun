//! Where results go.

use crate::{Error, Result, copy_prefix};

/// How much at most the decoder has zeroed at once, so that the zeros are still in the cache, and how far ahead it prefetches.
pub(crate) const MAX_STEP: usize = 8 * 1024;
/// Above this, glibc's `memset` takes `rep stosb`, which is slower.
const FILL_LEN: usize = 2 * 1024;
/// No system has smaller pages.
const PAGE_LEN: usize = 4 * 1024;

pub enum Output<'a> {
    /// What follows the result may be overwritten too.
    Slice(&'a mut [u8]),
    /// Appends at most `limit` bytes, and none on failure. It only reallocates if they do not fit.
    Vec { vec: &'a mut Vec<u8>, limit: usize },
}

pub(crate) struct Sink<'a> {
    output: Output<'a>,
    /// Where the result starts in a `Vec`.
    start: usize,
    step: usize,
}

impl<'a> Sink<'a> {
    /// [`Self::extend`] adds `first_step` bytes if there is capacity, then twice as many each time.
    pub(crate) fn new(output: Output<'a>, first_step: usize) -> Self {
        let start = match &output {
            Output::Slice(_) => 0,
            Output::Vec { vec, .. } => vec.len(),
        };
        Self {
            output,
            start,
            step: first_step.min(MAX_STEP),
        }
    }

    pub(crate) fn bytes(&mut self) -> &mut [u8] {
        match &mut self.output {
            Output::Slice(slice) => slice,
            Output::Vec { vec, .. } => vec.get_mut(self.start..).unwrap_or_default(),
        }
    }

    /// Whether [`Self::bytes`] only gets longer by allocating, if at all.
    pub(crate) fn is_at_capacity(&self) -> bool {
        match &self.output {
            Output::Slice(_) => true,
            Output::Vec { vec, limit } => {
                vec.len() == vec.capacity() || vec.len() - self.start == *limit
            }
        }
    }

    fn make_room(&mut self, len: usize) -> Result<()> {
        match &mut self.output {
            Output::Slice(slice) if len <= slice.len() => {}
            Output::Vec { vec, limit } if len <= *limit => {
                let (needed, most) = (self.start + len, self.start.saturating_add(*limit));
                if needed > vec.capacity() {
                    let capacity = vec.capacity().saturating_mul(2).min(most).max(needed);
                    vec.try_reserve_exact(capacity - vec.len())?;
                }
            }
            _ => return Err(Error::InsufficientSpace),
        }
        Ok(())
    }

    /// Makes [`Self::bytes`] at least `len` long, and a step longer if there is capacity.
    pub(crate) fn extend(&mut self, len: usize) -> Result<()> {
        self.make_room(len)?;
        if let Output::Vec { vec, limit } = &mut self.output {
            let most = vec.capacity().min(self.start.saturating_add(*limit));
            let end = (vec.len() + self.step).max(self.start + len).min(most);
            // Some CPUs are slow to get new pages within `memset`, others to prefetch from pages that are not there yet.
            let ahead = usize::from(self.step == MAX_STEP) * (PAGE_LEN + 1);
            let touched = end - vec.len() + ahead;
            let touched = vec.spare_capacity_mut().iter_mut().take(touched);
            touched.step_by(PAGE_LEN).for_each(|byte| _ = byte.write(0));
            while vec.len() < end {
                vec.resize(end.min(vec.len() + FILL_LEN), 0);
            }
            self.step = (2 * self.step).min(MAX_STEP);
        }
        Ok(())
    }

    pub(crate) fn bytes_up_to(&mut self, len: usize) -> Result<&mut [u8]> {
        self.extend(len)?;
        self.bytes().get_mut(..len).ok_or(Error::InsufficientSpace)
    }

    pub(crate) fn write(&mut self, at: usize, bytes: &[u8]) -> Result<()> {
        debug_assert!(at <= self.bytes().len());
        self.make_room(at + bytes.len())?;
        let copied = copy_prefix(self.bytes().get_mut(at..).unwrap_or_default(), bytes);
        if let Output::Vec { vec, .. } = &mut self.output {
            vec.extend_from_slice(bytes.split_at(copied).1);
        }
        Ok(())
    }

    pub(crate) fn finish(self, written: usize) {
        if let Output::Vec { vec, .. } = self.output {
            vec.truncate(self.start + written);
        }
    }
}
