use bun_engine_text::{AllocError, StringRef};
use bun_engine_vm::FastHashMap;

use crate::profiling::json::JsonWriter;

/// Numbers strings in the order in which they first come.
#[derive(Default)]
pub(super) struct StringTable {
    indices: FastHashMap<StringRef, u32>,
    strings: Vec<StringRef>,
}

impl StringTable {
    pub(super) fn starting_with(first: &'static str) -> StringTable {
        let first = StringRef::from_literal(first);
        StringTable {
            indices: [(first.clone(), 0)].into_iter().collect(),
            strings: vec![first],
        }
    }

    pub(super) fn index_of(&mut self, string: StringRef) -> Result<u32, AllocError> {
        if let Some(&index) = self.indices.get(&string) {
            return Ok(index);
        }
        if self.indices.try_reserve(1).is_err() || self.strings.try_reserve(1).is_err() {
            return Err(AllocError);
        }
        let index = self.strings.len() as u32;
        self.indices.insert(string.clone(), index);
        self.strings.push(string);
        Ok(index)
    }

    pub(super) fn write(&self, out: &mut impl JsonWriter) {
        out.separated(&self.strings, |out, string| out.string(string.text()));
    }
}
