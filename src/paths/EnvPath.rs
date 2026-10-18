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
    buf: Vec<u8>,
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

    pub fn append(&mut self, input: &[u8]) -> Result<(), AllocError> {
        let trimmed = strings::without_trailing_slash(trim_path_delimiters(input));

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
}
