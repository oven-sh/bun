#[derive(Clone)]
pub struct NPMClient {
    // TODO(port): verify `bin` is always a static literal (no deinit in Zig source)
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

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/cli/which_npm_client.zig (12 lines)
//   confidence: high
//   todos:      1
//   notes:      `bin: []const u8` field has no deinit; mapped to &'static [u8]
// ──────────────────────────────────────────────────────────────────────────
