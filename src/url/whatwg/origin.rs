use bun_engine_text::{AllocError, StringRef, names};

use crate::record::{Record, Storage, concat};
use crate::{ByteUrl, Error, Scheme};

impl<S: Storage> Record<S> {
    /// `scheme://host:port`, or `scheme:` if there is no host.
    pub fn scheme_and_host(&self) -> Result<StringRef, AllocError> {
        concat(self.without_credentials(self.parts.authority_end()))
    }

    fn has_tuple_origin(&self) -> bool {
        match self.scheme() {
            Scheme::File => false,
            Scheme::Other => self.scheme_name() == b"ftps",
            _ => true,
        }
    }

    /// The `origin` getter. It goes beyond the URL Standard for `ftps:`, and for what a `blob:` URL may have for a path.
    pub fn origin(&self) -> Result<StringRef, AllocError> {
        if self.has_tuple_origin() {
            return self.scheme_and_host();
        }
        if self.scheme_name() == b"blob" {
            match ByteUrl::parse(self.path(), None) {
                Ok(url) if url.has_tuple_origin() || url.scheme() == Scheme::File => {
                    return url.scheme_and_host();
                }
                Err(Error::OutOfMemory) => return Err(AllocError),
                _ => {}
            }
        }
        Ok(StringRef::retain(names::null.string()))
    }
}
