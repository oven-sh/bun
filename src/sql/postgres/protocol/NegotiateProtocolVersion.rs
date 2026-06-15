use bun_core::{OwnedString, String};

use super::super::types::int_types::Int4;
use super::new_reader::NewReader;
use crate::postgres::AnyPostgresError;

#[derive(Default)]
pub struct NegotiateProtocolVersion {
    pub version: Int4,
    pub unrecognized_options: Vec<OwnedString>,
}

impl NegotiateProtocolVersion {
    pub fn decode_internal<Container: super::new_reader::ReaderContext>(
        mut reader: NewReader<Container>,
    ) -> Result<Self, AnyPostgresError> {
        reader.length()?;

        let version = reader.int4()?;
        let mut this = Self {
            version,
            unrecognized_options: Vec::new(),
        };

        let unrecognized_options_count: u32 = reader.int4()?;
        this.unrecognized_options.reserve(
            (unrecognized_options_count as usize).saturating_sub(this.unrecognized_options.len()),
        );
        for _ in 0..unrecognized_options_count {
            let option = reader.read_z()?;
            if option.slice().len() == 0 {
                break;
            }
            this.unrecognized_options
                .push(OwnedString::new(String::clone_utf8(option.slice())));
        }

        Ok(this)
    }
}
