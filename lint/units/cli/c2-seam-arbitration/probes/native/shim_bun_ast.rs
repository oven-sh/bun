// Stand-in for the part of bun_ast::Source that src/lint/source_file.rs uses.
pub struct Source {
    contents: Vec<u8>,
}
impl Source {
    pub fn init_path_string_owned(_path: &[u8], contents: Vec<u8>) -> Source {
        Source { contents }
    }
    pub fn contents(&self) -> &[u8] {
        &self.contents
    }
}
