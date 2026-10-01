
    use core::fmt;
    use std::borrow::Cow;
    use std::sync::OnceLock;

    #[derive(Clone, Copy, PartialEq, Eq, Debug)]
    pub struct FileId(pub u32);

    pub struct SourceFile {
        file_name: Box<[u8]>,
        text: Vec<u8>,
        ecma_line_map: OnceLock<Vec<u32>>,
    }
    impl SourceFile {
        pub fn new(file_name: Box<[u8]>, text: Vec<u8>) -> SourceFile {
            SourceFile { file_name, text, ecma_line_map: OnceLock::new() }
        }
        pub fn file_name(&self) -> &[u8] {
            &self.file_name
        }
        pub fn text(&self) -> &[u8] {
            &self.text
        }
        pub fn ecma_line_map(&self) -> &[u32] {
            self.ecma_line_map.get_or_init(|| crate::scanner::compute_ecma_line_starts(self.text()))
        }
    }
    #[derive(Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Debug)]
    pub enum Category {
        Warning,
        Error,
        Suggestion,
        Message,
    }
    impl Category {
        pub fn name(self) -> &'static str {
            match self {
                Category::Warning => "warning",
                Category::Error => "error",
                Category::Suggestion => "suggestion",
                Category::Message => "message",
            }
        }
    }
    #[derive(Clone, Copy, PartialEq, Eq, Debug)]
    pub enum Code {
        Ts(u32),
        Name(&'static str),
    }
    impl fmt::Display for Code {
        fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
            match *self {
                Code::Ts(number) => write!(f, "TS{number}"),
                Code::Name(name) => f.write_str(name),
            }
        }
    }
    #[derive(Clone, PartialEq, Eq, Debug)]
    pub struct MessageChain {
        pub text: Cow<'static, [u8]>,
        pub next: Vec<MessageChain>,
    }
    #[derive(Clone, Debug)]
    pub struct Diagnostic {
        pub file: Option<FileId>,
        pub start: u32,
        pub length: u32,
        pub category: Category,
        pub code: Code,
        pub text: Cow<'static, [u8]>,
        pub chain: Vec<MessageChain>,
        pub related: Vec<Diagnostic>,
    }
