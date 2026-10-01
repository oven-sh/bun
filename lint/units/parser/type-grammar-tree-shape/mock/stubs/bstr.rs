use std::fmt;
pub struct BStr<'a>(&'a [u8]);
impl<'a> BStr<'a> {
    #[allow(clippy::new_ret_no_self)]
    pub fn new<B: ?Sized + AsRef<[u8]>>(b: &'a B) -> BStr<'a> { BStr(b.as_ref()) }
}
impl fmt::Display for BStr<'_> {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result { write!(f, "{}", String::from_utf8_lossy(self.0)) }
}
