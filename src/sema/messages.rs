//! TypeScript's diagnostic messages, by code.
//!
//! `messages.txt` has one `code<tab>category<tab>text` line per message, sorted by code. It's generated from
//! `internal/diagnostics/diagnostics_generated.go` of typescript-go 7.0.2 (Copyright Microsoft Corporation, Apache License 2.0)
//! and isn't edited by hand. Release builds embed it compressed and inflate it when the first message is looked up.

use bun_core::strings;

#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub enum Category {
    Warning,
    Error,
    Suggestion,
    Message,
}

impl Category {
    /// `Category.Name`
    pub fn name(self) -> &'static str {
        match self {
            Category::Warning => "warning",
            Category::Error => "error",
            Category::Suggestion => "suggestion",
            Category::Message => "message",
        }
    }
}

/// Bytes as text, for the tools that write baselines.
#[cfg(feature = "baselines")]
pub fn text(bytes: &[u8]) -> String {
    bstr::BStr::new(bytes).to_string()
}

/// The category and the text of the message with `code`. `{0}`, `{1}`, ... are placeholders for its
/// arguments.
pub fn message(code: u32) -> Option<(Category, &'static str)> {
    static MESSAGES: bun_core::Once<Vec<(u32, Category, &'static str)>> = bun_core::Once::new();
    let messages = MESSAGES.get_or_init(parse);
    let at = messages.binary_search_by_key(&code, |m| m.0).ok()?;
    messages.get(at).map(|m| (m.1, m.2))
}

fn parse() -> Vec<(u32, Category, &'static str)> {
    let bytes: &'static [u8] =
        bun_zstd::embed_compressed!("src/sema/messages.txt", include_bytes!("messages.txt"));
    let all = core::str::from_utf8(bytes).unwrap_or_default();
    let (mut messages, mut start) = (Vec::new(), 0);
    while let Some(len) = strings::index_of_char_usize(&bytes[start..], b'\n') {
        let line = &bytes[start..start + len];
        let digits = line.iter().take_while(|b| b.is_ascii_digit()).count();
        let code = line[..digits]
            .iter()
            .fold(0, |n, b| n * 10 + u32::from(b - b'0'));
        let category = match line.get(digits + 1) {
            Some(b'E') => Category::Error,
            _ => Category::Message,
        };
        if let Some(text) = all.get(start + digits + 3..start + len) {
            messages.push((code, category, text));
        }
        start += len + 1;
    }
    messages
}

/// `Message.Format`: writes `text` with `{n}` replaced by `args[n]`. A placeholder without an
/// argument is left unchanged.
pub fn format(out: &mut Vec<u8>, text: &str, args: &[impl AsRef<[u8]>]) {
    let mut rest = text.as_bytes();
    while let Some(open) = strings::index_of_char_usize(rest, b'{') {
        let after = &rest[open + 1..];
        let digits = after.iter().take_while(|b| b.is_ascii_digit()).count();
        let number = after[..digits]
            .iter()
            .fold(0, |n, b| n * 10 + usize::from(b - b'0'));
        match args.get(number) {
            Some(arg) if digits > 0 && after.get(digits) == Some(&b'}') => {
                out.extend_from_slice(&rest[..open]);
                out.extend_from_slice(arg.as_ref());
                rest = &after[digits + 1..];
            }
            _ => {
                out.extend_from_slice(&rest[..=open]);
                rest = after;
            }
        }
    }
    out.extend_from_slice(rest);
}
