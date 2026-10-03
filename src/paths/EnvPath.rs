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

/// True when a PATH entry names a `node_modules/.bin` directory.
pub fn is_node_modules_bin_dir(entry: &[u8]) -> bool {
    let entry = strings::without_trailing_slash(entry);
    crate::basename(entry) == b".bin"
        && crate::dirname(entry).is_some_and(|parent| crate::basename(parent) == b"node_modules")
}

/// Splits `path` into the entries to keep and the `node_modules/.bin` entries of `root` and of the
/// directories above and inside it.
pub fn split_bin_dirs_of(path: &[u8], root: &[u8]) -> (Vec<u8>, Vec<u8>) {
    use crate::resolve_path::{ParentEqual, is_parent_or_equal};
    let is_related = |dir: &[u8]| {
        !matches!(is_parent_or_equal(dir, root), ParentEqual::Unrelated)
            || !matches!(is_parent_or_equal(root, dir), ParentEqual::Unrelated)
    };
    let mut kept: Vec<u8> = Vec::with_capacity(path.len());
    let mut kept_any = false;
    let mut taken: Vec<u8> = Vec::new();
    for entry in strings::split(path, &[DELIMITER]) {
        let of_root = is_node_modules_bin_dir(entry)
            && crate::dirname(strings::without_trailing_slash(entry))
                .and_then(crate::dirname)
                .is_some_and(is_related);
        if of_root {
            if !taken.is_empty() {
                taken.push(DELIMITER);
            }
            taken.extend_from_slice(entry);
        } else {
            if kept_any {
                kept.push(DELIMITER);
            }
            kept_any = true;
            kept.extend_from_slice(entry);
        }
    }
    (kept, taken)
}

#[derive(Default)]
pub struct EnvPath {
    buf: Vec<u8>,
}

/// Input accepted by [`EnvPath::append`].
///
/// Raw slices are trimmed; anything else is assumed already-trimmed and has
/// `.slice()` called on it.
pub trait EnvPathInput {
    fn as_trimmed(&self) -> &[u8];
}

impl EnvPathInput for [u8] {
    fn as_trimmed(&self) -> &[u8] {
        strings::without_trailing_slash(trim_path_delimiters(self))
    }
}

// "assume already trimmed" — blanket over all const params so callers may pass
// any `&Path<u8, KIND, SEP, CHECK>` (e.g. `PathComponentBuilder.apply()`).
impl<const KIND: u8, const SEP_OPT: u8, const CHECK: u8> EnvPathInput
    for crate::Path<u8, KIND, SEP_OPT, CHECK>
{
    fn as_trimmed(&self) -> &[u8] {
        self.slice()
    }
}

impl EnvPath {
    pub fn init_capacity(capacity: usize) -> Result<Self, AllocError> {
        // `Vec::with_capacity` aborts on OOM under the global mimalloc allocator.
        Ok(Self {
            buf: Vec::with_capacity(capacity),
        })
    }

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
    path_buf: crate::AutoAbsPath,
}

impl<'a> PathComponentBuilder<'a> {
    pub fn append(&mut self, component: &[u8]) {
        let _ = self.path_buf.append(component); // OOM/capacity: fire-and-forget
    }

    pub fn apply(self) -> Result<(), AllocError> {
        self.env_path.append(&self.path_buf)?;
        Ok(())
    }
}
