// Stand-in for bstr::BString as the tests use it: bytes that compare with a str and print readably.
pub struct BString(Vec<u8>);
impl From<Vec<u8>> for BString {
    fn from(v: Vec<u8>) -> Self {
        BString(v)
    }
}
impl From<&str> for BString {
    fn from(v: &str) -> Self {
        BString(v.as_bytes().to_vec())
    }
}
impl PartialEq<&str> for BString {
    fn eq(&self, other: &&str) -> bool {
        self.0 == other.as_bytes()
    }
}
impl PartialEq<str> for BString {
    fn eq(&self, other: &str) -> bool {
        self.0 == other.as_bytes()
    }
}
impl PartialEq<String> for BString {
    fn eq(&self, other: &String) -> bool {
        self.0 == other.as_bytes()
    }
}
impl PartialEq for BString {
    fn eq(&self, other: &BString) -> bool {
        self.0 == other.0
    }
}
impl core::fmt::Debug for BString {
    fn fmt(&self, f: &mut core::fmt::Formatter<'_>) -> core::fmt::Result {
        write!(f, "{:?}", String::from_utf8_lossy(&self.0))
    }
}
