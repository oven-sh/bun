//! The normalization forms. ICU4C: normalizer2.cpp, loadednormalizer2impl.cpp

use crate::common::normalizer2impl::{NFC, Normalizer2Impl};
use crate::common::sink::BufferAccess;
use crate::common::umutex::OnceBox;
use crate::common::utypes::UErrorCode;
use UNormalization2Mode::{Compose, Decompose};

#[derive(Clone, Copy)]
pub(crate) enum UNormalization2Mode {
    Compose,
    Decompose,
}

pub(crate) struct Normalizer2 {
    impl_: &'static Normalizer2Impl,
    mode: UNormalization2Mode,
}

impl Normalizer2 {
    pub(crate) const fn new(impl_: &'static Normalizer2Impl, mode: UNormalization2Mode) -> Self {
        Self { impl_, mode }
    }

    /// Replaces the contents of `dest`.
    pub(crate) fn normalize(
        &self,
        src: &[u16],
        dest: &mut impl BufferAccess,
    ) -> Result<(), UErrorCode> {
        dest.truncate(0);
        self.normalize_append(src, 0, dest)
    }

    /// Does not merge `src` with the end of `dest`. `unchanged` is 0 or the result of `span_unchanged`.
    pub(crate) fn normalize_append(
        &self,
        src: &[u16],
        unchanged: usize,
        dest: &mut impl BufferAccess,
    ) -> Result<(), UErrorCode> {
        let impl_ = self.impl_;
        impl_.with_buffer(dest, src.len(), |buffer| match self.mode {
            Compose => _ = impl_.compose(src, unchanged, true, buffer),
            Decompose => impl_.decompose(src, unchanged, buffer),
        })
    }

    /// The length of a prefix that passes the fast path. If that is all of `s`, it is normalized.
    #[inline]
    pub(crate) fn span_unchanged(&self, s: &[u16]) -> usize {
        self.impl_.span_unchanged(s, self.mode)
    }

    pub(crate) fn is_normalized(&self, s: &[u16]) -> Result<bool, UErrorCode> {
        match self.mode {
            Compose => self.impl_.is_composed(s),
            Decompose => Ok(self.impl_.span_decomposed(s, 0) == s.len()),
        }
    }

    /// Requires that `c` occurs in normalized text.
    pub(crate) fn get_combining_class(&self, c: u32) -> u8 {
        self.impl_.get_cc_from_yes_or_maybe_yes_cp(c)
    }

    /// Requires a composing form.
    pub(crate) fn has_boundary_before(&self, c: u32) -> bool {
        self.impl_.has_comp_boundary_before_cp(c)
    }
}

/// Lazily loaded data, and the composing and decomposing forms that borrow it once it has a `'static` address.
struct Loaded(
    OnceBox<Result<Normalizer2Impl, UErrorCode>>,
    OnceBox<[Normalizer2; 2]>,
);

impl Loaded {
    fn get(&'static self, name: &[u8]) -> Result<&'static [Normalizer2; 2], UErrorCode> {
        self.1.get_or_try_init(|| {
            self.0
                .get_or_init_caching_err(|| Normalizer2Impl::load(name))
                .map(|impl_| [Compose, Decompose].map(|mode| Normalizer2::new(impl_, mode)))
        })
    }
}

static NFKC: Loaded = Loaded(OnceBox::new(), OnceBox::new());

pub(crate) fn get_nfc_instance() -> &'static Normalizer2 {
    static INSTANCE: Normalizer2 = Normalizer2::new(&NFC, Compose);
    &INSTANCE
}

pub(crate) fn get_nfd_instance() -> &'static Normalizer2 {
    static INSTANCE: Normalizer2 = Normalizer2::new(&NFC, Decompose);
    &INSTANCE
}

pub(crate) fn get_nfkc_instance() -> Result<&'static Normalizer2, UErrorCode> {
    NFKC.get(b"nfkc").map(|[nfkc, _]| nfkc)
}

pub(crate) fn get_nfkd_instance() -> Result<&'static Normalizer2, UErrorCode> {
    NFKC.get(b"nfkc").map(|[_, nfkd]| nfkd)
}

/// The mapping table of UTS #46 combined with NFC.
pub(crate) fn get_uts46_instance() -> Result<&'static Normalizer2, UErrorCode> {
    static UTS46: Loaded = Loaded(OnceBox::new(), OnceBox::new());
    UTS46.get(b"uts46").map(|[uts46, _]| uts46)
}
