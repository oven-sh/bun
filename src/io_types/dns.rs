use core::num::NonZeroUsize;

#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub struct DnsResolverHandle(NonZeroUsize);

impl DnsResolverHandle {
    #[inline]
    pub const fn from_usize(handle: usize) -> Option<Self> {
        match NonZeroUsize::new(handle) {
            Some(handle) => Some(Self(handle)),
            None => None,
        }
    }

    #[inline]
    pub fn from_ptr<T>(ptr: *mut T) -> Option<Self> {
        Self::from_usize(ptr.cast::<()>() as usize)
    }

    #[inline]
    pub const fn get(self) -> usize {
        self.0.get()
    }

    #[inline]
    pub fn as_ptr<T>(self) -> *mut T {
        self.0.get() as *mut T
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub struct GetAddrInfoRequestHandle(NonZeroUsize);

impl GetAddrInfoRequestHandle {
    #[inline]
    pub const fn from_usize(handle: usize) -> Option<Self> {
        match NonZeroUsize::new(handle) {
            Some(handle) => Some(Self(handle)),
            None => None,
        }
    }

    #[inline]
    pub fn from_ptr<T>(ptr: *mut T) -> Option<Self> {
        Self::from_usize(ptr.cast::<()>() as usize)
    }

    #[inline]
    pub const fn get(self) -> usize {
        self.0.get()
    }

    #[inline]
    pub fn as_ptr<T>(self) -> *mut T {
        self.0.get() as *mut T
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub struct DnsRequestHandle(NonZeroUsize);

impl DnsRequestHandle {
    #[inline]
    pub const fn from_usize(handle: usize) -> Option<Self> {
        match NonZeroUsize::new(handle) {
            Some(handle) => Some(Self(handle)),
            None => None,
        }
    }

    #[inline]
    pub fn from_ptr<T>(ptr: *mut T) -> Option<Self> {
        Self::from_usize(ptr.cast::<()>() as usize)
    }

    #[inline]
    pub const fn get(self) -> usize {
        self.0.get()
    }

    #[inline]
    pub fn as_ptr<T>(self) -> *mut T {
        self.0.get() as *mut T
    }
}

#[cfg(test)]
mod tests {
    use super::{DnsRequestHandle, DnsResolverHandle, GetAddrInfoRequestHandle};

    #[test]
    fn dns_handles_reject_null_and_preserve_pointers() {
        assert!(DnsResolverHandle::from_usize(0).is_none());
        assert!(GetAddrInfoRequestHandle::from_usize(0).is_none());
        assert!(DnsRequestHandle::from_usize(0).is_none());

        let mut resolver = 1u8;
        let mut get_addr_info = 2u8;
        let mut request = 3u8;
        let resolver_ptr = core::ptr::from_mut(&mut resolver);
        let get_addr_info_ptr = core::ptr::from_mut(&mut get_addr_info);
        let request_ptr = core::ptr::from_mut(&mut request);

        assert_eq!(
            DnsResolverHandle::from_ptr(resolver_ptr)
                .unwrap()
                .as_ptr::<u8>(),
            resolver_ptr
        );
        assert_eq!(
            GetAddrInfoRequestHandle::from_ptr(get_addr_info_ptr)
                .unwrap()
                .as_ptr::<u8>(),
            get_addr_info_ptr
        );
        assert_eq!(
            DnsRequestHandle::from_ptr(request_ptr)
                .unwrap()
                .as_ptr::<u8>(),
            request_ptr
        );
    }
}
