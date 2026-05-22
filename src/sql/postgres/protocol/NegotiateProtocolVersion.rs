use bun_core::String;

use super::super::types::int_types::Int4;
use super::new_reader::NewReader;

#[derive(Default)]
pub struct NegotiateProtocolVersion {
    pub version: Int4,
    pub unrecognized_options: Vec<String>,
}

impl NegotiateProtocolVersion {
    // PORT NOTE: reshaped from out-param `fn(this: *@This(), ...) !void` to `-> Result<Self, E>`.
    // TODO(port): narrow error set
    pub fn decode_internal<Container: super::new_reader::ReaderContext>(
        mut reader: NewReader<Container>,
    ) -> Result<Self, bun_core::Error> {
        let length = reader.length()?;
        debug_assert!(length >= 4);

        let version = reader.int4()?;
        let mut this = Self {
            version,
            unrecognized_options: Vec::new(),
        };

        let unrecognized_options_count: u32 = reader.int4()?;
        this.unrecognized_options.reserve(
            (unrecognized_options_count as usize).saturating_sub(this.unrecognized_options.len()),
        );
        // errdefer { for ... option.deinit(); list.deinit(allocator) } — deleted:
        // Vec<bun_core::String> drops each element on the `?` error path automatically.
        for _ in 0..unrecognized_options_count {
            let option = reader.read_z()?;
            if option.slice().len() == 0 {
                break;
            }
            // `defer option.deinit()` — deleted; `option` drops at end of iteration.
            // TODO(port): Zig used `borrowUTF8` then dropped `option`; that would dangle.
            // Clone instead — `option` is Temporary into the connection buffer either way.
            this.unrecognized_options
                .push(String::clone_utf8(option.slice()));
            // PERF(port): was appendAssumeCapacity — profile if it shows up on a hot path.
        }

        Ok(this)
    }
}

// ported from: src/sql/postgres/protocol/NegotiateProtocolVersion.zig
