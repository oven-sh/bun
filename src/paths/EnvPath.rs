use bun_alloc::AllocError;
use bun_core::strings;

use crate::DELIMITER;

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

#[derive(Default)]
pub struct EnvPath {
    // Zig: `std.mem.Allocator param` — dropped (non-AST crate, global mimalloc).
    buf: Vec<u8>,
}

pub trait EnvPathInput {
    fn as_trimmed(&self) -> &[u8];
}

impl EnvPathInput for [u8] {
    fn as_trimmed(&self) -> &[u8] {
        strings::without_trailing_slash(trim_path_delimiters(self))
    }
}

// "assume already trimmed" — the `else` arm in Zig calls `input.slice()` for any
// `bun.Path(...)` instantiation. Blanket over all const params so callers may pass
// any `&Path<u8, KIND, SEP, CHECK>` (e.g. `PathComponentBuilder.apply()`).
impl<const KIND: u8, const SEP_OPT: u8, const CHECK: u8> EnvPathInput
    for crate::Path<u8, KIND, SEP_OPT, CHECK>
{
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

    pub fn append<I: EnvPathInput + ?Sized>(&mut self, input: &I) -> Result<(), AllocError> {
        let trimmed: &[u8] = input.as_trimmed();

        if trimmed.is_empty() {
            return Ok(());
        }

        if !self.buf.is_empty() {
            self.buf.reserve(trimmed.len() + 1);
            // PERF(port): was appendAssumeCapacity / appendSliceAssumeCapacity.
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
            path_buf: crate::AutoAbsPath::init(),
        }
    }
}

pub struct PathComponentBuilder<'a> {
    env_path: &'a mut EnvPath,
    // Zig: `AbsPath(.{ .sep = .auto })`
    path_buf: crate::AutoAbsPath,
}

impl<'a> PathComponentBuilder<'a> {
    pub fn append(&mut self, component: &[u8]) {
        let _ = self.path_buf.append(component); // OOM/capacity: Zig aborts; port keeps fire-and-forget
    }

    pub fn append_fmt(&mut self, args: core::fmt::Arguments<'_>) {
        let _ = self.path_buf.append_fmt(args); // OOM/capacity: Zig aborts; port keeps fire-and-forget
    }

    pub fn apply(self) -> Result<(), AllocError> {
        self.env_path.append(&self.path_buf)?;
        // Zig: `this.path_buf.deinit();` — `path_buf` drops at end of scope.
        Ok(())
    }
}

// ported from: src/paths/EnvPath.zig
