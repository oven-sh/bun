use crate::{Rusage, Status};

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Hash)]
pub struct ProcessId(u64);

impl ProcessId {
    #[inline]
    pub const fn new(id: u64) -> Self {
        Self(id)
    }

    #[inline]
    pub const fn get(self) -> u64 {
        self.0
    }
}

#[derive(Debug)]
pub struct ProcessExitState {
    id: ProcessId,
    status: Status,
    ref_drops: u32,
    killed_with: Option<u8>,
}

impl ProcessExitState {
    #[inline]
    pub fn new(id: ProcessId) -> Self {
        Self {
            id,
            status: Status::Running,
            ref_drops: 0,
            killed_with: None,
        }
    }

    #[inline]
    pub const fn id(&self) -> ProcessId {
        self.id
    }

    #[inline]
    pub const fn status(&self) -> &Status {
        &self.status
    }

    #[inline]
    pub fn set_status(&mut self, status: Status) {
        self.status = status;
    }

    #[inline]
    pub const fn ref_drops(&self) -> u32 {
        self.ref_drops
    }

    #[inline]
    pub fn drop_process_ref(&mut self) {
        self.ref_drops += 1;
    }

    #[inline]
    pub const fn killed_with(&self) -> Option<u8> {
        self.killed_with
    }

    #[inline]
    pub fn kill(&mut self, signal: u8) {
        self.killed_with = Some(signal);
    }
}

pub struct ProcessExitContext<'a> {
    pub process: &'a mut ProcessExitState,
    pub status: Status,
    pub rusage: &'a Rusage,
}

impl<'a> ProcessExitContext<'a> {
    #[inline]
    pub fn new(process: &'a mut ProcessExitState, status: Status, rusage: &'a Rusage) -> Self {
        Self {
            process,
            status,
            rusage,
        }
    }

    #[inline]
    pub fn process_id(&self) -> ProcessId {
        self.process.id()
    }
}
