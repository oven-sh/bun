use crate::{Rusage, Status};

#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub struct ProcessIdentity(usize);

impl ProcessIdentity {
    #[inline]
    pub const fn from_usize(identity: usize) -> Option<Self> {
        if identity == 0 {
            None
        } else {
            Some(Self(identity))
        }
    }

    #[inline]
    pub fn from_ptr<T>(ptr: *mut T) -> Option<Self> {
        Self::from_usize(ptr.cast::<()>() as usize)
    }

    #[inline]
    pub fn from_ref<T>(value: &T) -> Self {
        Self(core::ptr::from_ref(value).cast::<()>() as usize)
    }

    #[inline]
    pub const fn get(self) -> usize {
        self.0
    }
}

#[derive(Clone, Debug)]
pub struct ProcessExitContext<'a> {
    pub process: ProcessIdentity,
    pub status: Status,
    pub rusage: &'a Rusage,
}

impl<'a> ProcessExitContext<'a> {
    #[inline]
    pub const fn new(process: ProcessIdentity, status: Status, rusage: &'a Rusage) -> Self {
        Self {
            process,
            status,
            rusage,
        }
    }

    #[inline]
    pub fn process_identity(&self) -> ProcessIdentity {
        self.process
    }
}
