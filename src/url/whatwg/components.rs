use crate::Scheme;

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
#[repr(u8)]
pub(crate) enum State {
    /// Every other field is zero.
    Invalid = 0,
    /// The path is a list of segments.
    Hierarchical = 1,
    OpaquePath = 2,
}

/// Where the parts of a serialized URL are. See [`crate::Url`] for what native code may read.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
#[repr(C)]
pub(crate) struct Components {
    pub(crate) scheme_end: u32,
    pub(crate) username_end: u32,
    pub(crate) host_start: u32,
    pub(crate) host_end: u32,
    pub(crate) path_start: u32,
    pub(crate) path_end: u32,
    pub(crate) query_end: u32,
    pub(crate) port: u16,
    pub(crate) scheme: Scheme,
    pub(crate) state: State,
}

impl Components {
    pub(crate) const INVALID: Components = Components {
        scheme_end: 0,
        username_end: 0,
        host_start: 0,
        host_end: 0,
        path_start: 0,
        path_end: 0,
        query_end: 0,
        port: 0,
        scheme: Scheme::Other,
        state: State::Invalid,
    };

    #[inline]
    pub(crate) fn has_host(&self) -> bool {
        self.host_start > self.scheme_end + 1
    }

    #[inline]
    pub(crate) fn has_credentials(&self) -> bool {
        self.host_start > self.scheme_end + 3
    }

    #[inline]
    pub(crate) fn port(&self) -> Option<u16> {
        (self.has_host() && self.path_start > self.host_end).then_some(self.port)
    }

    /// Where the port ends, which is where the path starts unless there is a `/.` in place of an authority.
    #[inline]
    pub(crate) fn authority_end(&self) -> u32 {
        if self.has_host() {
            self.path_start
        } else {
            self.host_end
        }
    }

    /// An authority with nothing in it, or none.
    #[inline]
    pub(crate) fn set_empty_authority(&mut self, at: u32) {
        self.username_end = at;
        self.host_start = at;
        self.host_end = at;
        self.path_start = at;
        self.port = 0;
    }
}
