// Stand-in for the part of bun_ast that src/lint/diagnostic.rs uses.
use std::borrow::Cow;
pub struct Source {
    pub contents: Vec<u8>,
}
impl Source {
    pub fn contents(&self) -> &[u8] {
        &self.contents
    }
}
pub enum Kind {
    Err,
    Warn,
    Note,
    Debug,
    Verbose,
}
pub struct Location {
    pub line: i32,
    pub offset: usize,
    pub length: usize,
}
pub struct Data {
    pub text: Cow<'static, [u8]>,
    pub location: Option<Location>,
}
pub struct Msg {
    pub kind: Kind,
    pub data: Data,
    pub notes: Box<[Data]>,
    pub code: Option<u32>,
}
impl Msg {
    pub fn code(&self) -> Option<u32> {
        self.code
    }
}
