//! Extracted from `install/PackageManager/PackageManagerOptions.zig` so
//! `options_types/schema.zig`, `cli/bunfig.zig`, and `ini/` can name the
//! linker mode without depending on the full package manager.

#[repr(u8)]
#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub enum NodeLinker {
    // If workspaces are used: isolated
    // If not: hoisted
    // Used when nodeLinker is absent from package.json/bun.lock/bun.lockb
    Auto,

    Hoisted,
    Isolated,
}

impl NodeLinker {
    pub fn from_str(input: &[u8]) -> Option<NodeLinker> {
        if input == b"hoisted" {
            return Some(NodeLinker::Hoisted);
        }
        if input == b"isolated" {
            return Some(NodeLinker::Isolated);
        }
        None
    }
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/install_types/NodeLinker.zig (25 lines)
//   confidence: high
//   todos:      0
//   notes:      variant names PascalCased; if @tagName is used elsewhere add #[derive(strum::IntoStaticStr)] with serialize attrs
// ──────────────────────────────────────────────────────────────────────────
