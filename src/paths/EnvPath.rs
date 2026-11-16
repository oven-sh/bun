use bun_alloc::AllocError;

use crate::DELIMITER;
use crate::platform::Auto;
use crate::style::len_without_seps;

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
        let trimmed = trim_path_delimiters(input);
        self.append_entry(&trimmed[..len_without_seps::<Auto, _>(trimmed, 1)]);
        Ok(())
    }

    /// One directory, which is taken as it is.
    pub fn append_entry(&mut self, entry: &[u8]) {
        if entry.is_empty() {
            return;
        }
        if !self.buf.is_empty() {
            self.buf.reserve(entry.len() + 1);
            self.buf.push(DELIMITER);
        }
        self.buf.extend_from_slice(entry);
    }
}
