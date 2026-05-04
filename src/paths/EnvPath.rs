use bun_alloc::AllocError;
use bun_str::strings;

use crate::AbsPath;
use crate::DELIMITER;

#[derive(Default, Clone, Copy, PartialEq, Eq)]
pub struct EnvPathOptions {
    //
}

fn trim_path_delimiters(input: &[u8]) -> &[u8] {
    let mut trimmed = input;
    while !trimmed.is_empty() && trimmed[0] == DELIMITER {
        trimmed = &trimmed[1..];
    }
    while !trimmed.is_empty() && trimmed[trimmed.len() - 1] == DELIMITER {
        trimmed = &trimmed[0..trimmed.len() - 1];
    }
    trimmed
}

// Zig: `pub fn EnvPath(comptime opts: EnvPathOptions) type { return struct { ... } }`
// TODO(port): `EnvPathOptions` currently has no fields, so the comptime `opts`
// parameter is vacuous. Re-introduce a `<const OPTS: EnvPathOptions>` const
// generic (with `#[derive(core::marker::ConstParamTy)]` on `EnvPathOptions`)
// once options are actually added.
#[derive(Default)]
pub struct EnvPath {
    // Zig: `allocator: std.mem.Allocator` — dropped (non-AST crate, global mimalloc).
    buf: Vec<u8>,
}

/// Input accepted by [`EnvPath::append`].
///
/// Zig's `append` takes `input: anytype` and switches on `@TypeOf(input)`:
/// raw slices are trimmed, anything else is assumed already-trimmed and has
/// `.slice()` called on it. In Rust we express that dispatch as a trait.
pub trait EnvPathInput {
    fn as_trimmed(&self) -> &[u8];
}

impl EnvPathInput for &[u8] {
    fn as_trimmed(&self) -> &[u8] {
        strings::without_trailing_slash(trim_path_delimiters(self))
    }
}

impl EnvPathInput for &mut [u8] {
    fn as_trimmed(&self) -> &[u8] {
        strings::without_trailing_slash(trim_path_delimiters(self))
    }
}

// "assume already trimmed" — the `else` arm in Zig calls `input.slice()`.
// TODO(port): adjust `AbsPath` const-generic spelling once `AbsPath` is ported.
impl EnvPathInput for &AbsPath {
    fn as_trimmed(&self) -> &[u8] {
        self.slice()
    }
}

impl EnvPath {
    pub fn init() -> Self {
        Self { buf: Vec::new() }
    }

    pub fn init_capacity(capacity: usize) -> Result<Self, AllocError> {
        // PERF(port): Zig used `ArrayListUnmanaged.initCapacity` which is fallible;
        // `Vec::with_capacity` aborts on OOM under the global mimalloc allocator.
        Ok(Self {
            buf: Vec::with_capacity(capacity),
        })
    }

    // Zig `deinit` only freed `buf` — handled by `Drop` on `Vec<u8>`.

    pub fn slice(&self) -> &[u8] {
        self.buf.as_slice()
    }

    pub fn append(&mut self, input: impl EnvPathInput) -> Result<(), AllocError> {
        let trimmed: &[u8] = input.as_trimmed();

        if trimmed.is_empty() {
            return Ok(());
        }

        if !self.buf.is_empty() {
            self.buf.reserve(trimmed.len() + 1);
            // PERF(port): was appendAssumeCapacity / appendSliceAssumeCapacity — profile in Phase B
            self.buf.push(DELIMITER);
            self.buf.extend_from_slice(trimmed);
        } else {
            self.buf.extend_from_slice(trimmed);
        }
        Ok(())
    }

    pub fn path_component_builder(&mut self) -> PathComponentBuilder<'_> {
        PathComponentBuilder {
            env_path: self,
            path_buf: AbsPath::init(),
        }
    }
}

pub struct PathComponentBuilder<'a> {
    env_path: &'a mut EnvPath,
    // Zig: `AbsPath(.{ .sep = .auto })`
    // TODO(port): encode `.sep = .auto` as a const generic on `AbsPath` once ported.
    path_buf: AbsPath,
}

impl<'a> PathComponentBuilder<'a> {
    pub fn append(&mut self, component: &[u8]) {
        self.path_buf.append(component);
    }

    pub fn append_fmt(&mut self, args: core::fmt::Arguments<'_>) {
        self.path_buf.append_fmt(args);
    }

    pub fn apply(mut self) -> Result<(), AllocError> {
        self.env_path.append(&self.path_buf)?;
        // Zig: `this.path_buf.deinit();` — `path_buf` drops at end of scope.
        Ok(())
    }
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/paths/EnvPath.zig (92 lines)
//   confidence: medium
//   todos:      3
//   notes:      Dropped vacuous comptime `opts` generic; `append(anytype)` modeled via `EnvPathInput` trait; `AbsPath` const-generic spelling pending.
// ──────────────────────────────────────────────────────────────────────────
