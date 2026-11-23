//! The null-terminated arrays of C strings that `argv` and `envp` are.

use core::ffi::{CStr, c_char};
use core::marker::PhantomData;
use core::ptr::NonNull;

use crate::ZStr;

/// A `&'a CStr` that is one pointer wide.
#[repr(transparent)]
#[derive(Clone, Copy)]
pub struct CStrRef<'a>(NonNull<c_char>, PhantomData<&'a CStr>);

const _: () = assert!(size_of::<Option<CStrRef>>() == size_of::<*const c_char>());

impl<'a> CStrRef<'a> {
    /// Panics unless the last byte is a NUL.
    #[inline]
    pub const fn from_slice_with_nul(bytes: &'a [u8]) -> Self {
        assert!(matches!(bytes.last(), Some(0)));
        Self(NonNull::from_ref(bytes).cast(), PhantomData)
    }

    #[inline]
    pub fn as_ptr(self) -> *const c_char {
        self.0.as_ptr()
    }

    /// Calls `strlen`.
    #[inline]
    pub fn to_cstr(self) -> &'a CStr {
        // SAFETY: a `CStr` and a `ZStr` end with a NUL, and the other constructors check or write
        // it. The bytes are borrowed for `'a`, which `CStringList` shortens to a borrow of itself.
        unsafe { CStr::from_ptr(self.as_ptr()) }
    }
}

impl<'a> From<&'a CStr> for CStrRef<'a> {
    #[inline]
    fn from(string: &'a CStr) -> Self {
        Self(NonNull::from(string).cast(), PhantomData)
    }
}

impl<'a> From<&'a ZStr> for CStrRef<'a> {
    #[inline]
    fn from(string: &'a ZStr) -> Self {
        Self(
            NonNull::from(string.as_bytes_with_nul()).cast(),
            PhantomData,
        )
    }
}

/// Ends with `None`, which C reads as a null pointer.
#[derive(Clone, Copy)]
pub struct CStrList<'a>(&'a [Option<CStrRef<'a>>]);

impl<'a> CStrList<'a> {
    /// Panics unless `items` ends with `None`.
    #[inline]
    pub const fn new(items: &'a [Option<CStrRef<'a>>]) -> Self {
        assert!(matches!(items.last(), Some(None)));
        Self(items)
    }

    /// Pushes the terminating `None` onto `items`.
    #[inline]
    pub fn from_unterminated<'s: 'a>(items: &'a mut Vec<Option<CStrRef<'s>>>) -> Self {
        items.push(None);
        Self(items)
    }

    #[inline]
    pub fn first(self) -> Option<CStrRef<'a>> {
        self.0[0]
    }

    /// Without the `None`.
    #[cfg(windows)]
    #[inline]
    pub fn unterminated(self) -> &'a [Option<CStrRef<'a>>] {
        &self.0[..self.0.len() - 1]
    }

    #[inline]
    pub fn as_ptr(self) -> *const *const c_char {
        self.0.as_ptr().cast()
    }
}

/// A [`CStrList`] that owns its strings.
pub struct CStringList {
    /// The strings are in its spare capacity.
    _bytes: Vec<u8>,
    /// Point into `_bytes`, so they are handed out for a borrow of `self` only.
    items: Vec<Option<CStrRef<'static>>>,
}

impl CStringList {
    /// Each string is the concatenation of its parts.
    pub fn from_parts<'s, const N: usize>(
        strings: impl ExactSizeIterator<Item = [&'s [u8]; N]> + Clone,
    ) -> Self {
        let len_with_nul = |parts: [&[u8]; N]| parts.iter().map(|p| p.len()).sum::<usize>() + 1;
        let mut bytes = Vec::with_capacity(strings.clone().map(len_with_nul).sum());
        let mut items = Vec::with_capacity(strings.len() + 1);
        let mut spare = bytes.spare_capacity_mut();
        for parts in strings {
            let string;
            (string, spare) = spare.split_at_mut(len_with_nul(parts));
            let mut rest = &mut *string;
            for part in parts {
                let head;
                (head, rest) = rest.split_at_mut(part.len());
                head.write_copy_of_slice(part);
            }
            rest[0].write(0);
            items.push(Some(CStrRef(NonNull::from(string).cast(), PhantomData)));
        }
        items.push(None);
        Self {
            _bytes: bytes,
            items,
        }
    }

    /// Without the `None`.
    #[inline]
    pub fn unterminated(&self) -> &[Option<CStrRef<'_>>] {
        &self.items[..self.items.len() - 1]
    }

    #[inline]
    pub fn as_list(&self) -> CStrList<'_> {
        CStrList(&self.items)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn read<'a>(items: &[Option<CStrRef<'a>>]) -> Vec<Option<&'a [u8]>> {
        let bytes = |entry: CStrRef<'a>| entry.to_cstr().to_bytes();
        items.iter().map(|item| item.map(bytes)).collect()
    }

    #[test]
    fn from_parts_joins_the_parts_of_each_string() {
        let pairs: [[&[u8]; 3]; 3] = [[b"A", b"=", b"1"], [b"", b"", b""], [b"BC", b"=", b""]];
        let list = Box::new(CStringList::from_parts(pairs.into_iter()));
        assert_eq!(
            read(list.unterminated()),
            [&b"A=1"[..], b"", b"BC="].map(Some)
        );

        let empty = CStringList::from_parts(core::iter::empty::<[&[u8]; 1]>());
        assert!(empty.unterminated().is_empty());
        assert!(empty.as_list().first().is_none());
    }

    #[test]
    fn from_unterminated_adds_the_null() {
        let mut items = vec![Some(c"a".into()), Some(crate::zstr!("bc").into())];
        let list = CStrList::from_unterminated(&mut items);
        assert_eq!(read(list.0), [Some(&b"a"[..]), Some(b"bc"), None]);
        assert!(CStrList::new(&items).first().is_some());
    }

    #[test]
    #[should_panic]
    fn new_refuses_a_list_without_an_end() {
        CStrList::new(&[Some(c"a".into())]);
    }

    #[test]
    #[should_panic]
    fn from_slice_with_nul_refuses_a_string_without_an_end() {
        CStrRef::from_slice_with_nul(b"a\0b");
    }
}
