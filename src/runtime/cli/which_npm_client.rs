#[derive(Clone)]
pub struct NPMClient {
    // TODO(port): verify `bin` is always a static literal (the original had no deinit)
    pub bin: &'static [u8],
    pub tag: Tag,
}

#[derive(Copy, Clone, Eq, PartialEq)]
pub enum Tag {
    Bun,
}

impl Tag {
    pub fn as_str(self) -> &'static str {
        match self {
            Tag::Bun => "bun",
        }
    }
}

impl From<Tag> for &'static str {
    fn from(t: Tag) -> &'static str {
        t.as_str()
    }
}
