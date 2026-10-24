//! HPACK, the header compression of HTTP/2 (RFC 7541). One [`Encoder`] and one [`Decoder`] per connection.

#![forbid(unsafe_code)]
// A peer's bytes reach this crate and the release profile aborts on a panic.
#![deny(
    clippy::indexing_slicing,
    clippy::unwrap_used,
    clippy::expect_used,
    clippy::panic,
    clippy::unreachable
)]

mod decoder;
mod encoder;
mod error;
mod huffman;
mod integer;
mod static_table;
mod storage;

pub use decoder::{Decoder, Field};
pub use encoder::{Encoder, Indexing};
pub use error::Error;
pub(crate) use error::Result;

/// The dynamic table capacity both sides start from (RFC 9113 §6.5.2).
const DEFAULT_TABLE_CAPACITY: u32 = 4096;

/// The longest name and value together that a field may have, sent or received.
const MAX_FIELD_LEN: usize = 65536;

/// What an entry counts towards the table size beside its name and value (§4.1).
const ENTRY_OVERHEAD: usize = 32;

#[cfg(test)]
#[allow(clippy::unwrap_used, clippy::indexing_slicing)]
mod tests {
    use super::*;

    fn hex(text: &str) -> Vec<u8> {
        let digits: Vec<u32> = text.chars().filter_map(|c| c.to_digit(16)).collect();
        digits
            .chunks(2)
            .map(|pair| pair.iter().fold(0, |byte, digit| byte << 4 | *digit as u8))
            .collect()
    }

    /// Each block is its fields, its bytes, and the size of the dynamic table after it.
    fn check_blocks(max_capacity: u32, blocks: &[(&[(&str, &str)], &str, usize)]) {
        let (mut encoder, mut decoder) = (Encoder::new(), Decoder::new());
        encoder.set_max_capacity(max_capacity);
        for &(fields, bytes, table_size) in blocks {
            let mut block = Vec::new();
            for (name, value) in fields {
                encoder
                    .encode(&mut block, name.as_bytes(), value.as_bytes(), Indexing::Add)
                    .unwrap();
            }
            assert_eq!(block, hex(bytes));
            assert_eq!(encoder.table_size(), table_size);

            let mut decoded = Vec::new();
            let mut pos = 0;
            while let Some(field) = decoder.next(&block, &mut pos) {
                let field = field.unwrap();
                decoded.push((field.name.to_vec(), field.value.to_vec()));
            }
            let expected = fields
                .iter()
                .map(|(name, value)| (name.as_bytes().to_vec(), value.as_bytes().to_vec()));
            assert_eq!(decoded, expected.collect::<Vec<_>>());
            assert_eq!(decoder.table_size(), table_size);
        }
    }

    fn decode(decoder: &mut Decoder, block: &[u8]) -> Result<Vec<(Vec<u8>, Vec<u8>, bool)>> {
        let (mut pos, mut fields) = (0, Vec::new());
        while let Some(field) = decoder.next(block, &mut pos) {
            let field = field?;
            fields.push((field.name.to_vec(), field.value.to_vec(), field.never_index));
        }
        Ok(fields)
    }

    /// What `block` begins with (§6).
    fn representation(block: &[u8]) -> &'static str {
        match block[0] {
            0x80.. => "indexed",
            0x40.. => "added",
            0x20.. => "size update",
            0x10.. => "never indexed",
            _ => "skipped",
        }
    }

    fn encode(encoder: &mut Encoder, name: &str, value: &str, indexing: Indexing) -> Vec<u8> {
        let mut block = Vec::new();
        encoder
            .encode(&mut block, name.as_bytes(), value.as_bytes(), indexing)
            .unwrap();
        block
    }

    #[test]
    fn rfc7541_c2_fields() {
        for (block, name, value, never_index, table_size) in [
            (
                "400a637573746f6d2d6b65790d637573746f6d2d686561646572",
                "custom-key",
                "custom-header",
                false,
                55,
            ),
            (
                "040c2f73616d706c652f70617468",
                ":path",
                "/sample/path",
                false,
                0,
            ),
            (
                "100870617373776f726406736563726574",
                "password",
                "secret",
                true,
                0,
            ),
            ("82", ":method", "GET", false, 0),
        ] {
            let mut decoder = Decoder::new();
            let field = (
                name.as_bytes().to_vec(),
                value.as_bytes().to_vec(),
                never_index,
            );
            assert_eq!(decode(&mut decoder, &hex(block)), Ok(vec![field]));
            assert_eq!(decoder.table_size(), table_size);
        }
    }

    #[test]
    fn a_name_from_the_dynamic_table() {
        let mut decoder = Decoder::new();
        // x-a: 1 enters the table. Index 62 then names a field left out of it and one that evicts it.
        let fields = decode(&mut decoder, &hex("3f05 4003782d610131 0f2f0132 7e0133")).unwrap();
        let values: Vec<_> = fields
            .iter()
            .map(|(name, value, _)| (&**name, &**value))
            .collect();
        let name: &[u8] = b"x-a";
        assert_eq!(values, [(name, &b"1"[..]), (name, b"2"), (name, b"3")]);
        assert_eq!(decoder.table_size(), 36);

        // The name is the last thing stored.
        let fields = decode(&mut Decoder::new(), &hex("4003782d6100 7e0131")).unwrap();
        assert_eq!(fields[1], (name.to_vec(), b"1".to_vec(), false));
    }

    #[test]
    fn a_block_of_nothing_but_size_updates() {
        let mut decoder = Decoder::new();
        let insert = hex("4003782d610131");
        assert!(decode(&mut decoder, &insert).is_ok());
        assert_eq!(decoder.table_size(), 36);

        let (block, mut pos) = (hex("20 3fe11f"), 0);
        assert!(decoder.next(&block, &mut pos).is_none());
        assert_eq!(pos, block.len());
        assert_eq!(decoder.table_size(), 0);

        // The second update counts too: there is room again.
        assert!(decode(&mut decoder, &insert).is_ok());
        assert_eq!(decoder.table_size(), 36);
    }

    #[test]
    fn a_higher_max_capacity_needs_no_size_update() {
        let mut decoder = Decoder::new();
        decoder.set_max_capacity(8192);
        // 60 entries of 100 bytes, then a reference to the oldest.
        let mut block = Vec::new();
        for i in 0..60 {
            block.extend_from_slice(&[0x40, 4]);
            block.extend_from_slice(format!("x-{i:02}").as_bytes());
            block.push(64);
            block.extend_from_slice(&[b'v'; 64]);
        }
        block.push(0x80 | (61 + 60));
        let fields = decode(&mut decoder, &block).unwrap();
        assert_eq!(fields.last().map(|field| &field.0[..]), Some(&b"x-00"[..]));
        assert_eq!(decoder.table_size(), 6000);

        decoder.set_max_capacity(4096);
        assert_eq!(decoder.table_size(), 4000);
    }

    #[test]
    fn memory_stays_bounded() {
        let (mut encoder, mut decoder) = (Encoder::new(), Decoder::new());
        // The table holds about ten of these, so it turns over many times. One does not fit at all.
        for i in 0..160 {
            let len = if i == 80 { 60_000 } else { 300 + i % 100 };
            let block = encode(
                &mut encoder,
                &format!("x-{i}"),
                &"~".repeat(len),
                Indexing::Add,
            );
            assert!(decode(&mut decoder, &block).is_ok());
            assert_eq!(decoder.table_size(), encoder.table_size());
            // What the large field took is given back with the next one.
            if i != 80 {
                let heap_sizes = (encoder.heap_size(), decoder.heap_size());
                assert!(
                    heap_sizes.0 < 24 * 1024 && heap_sizes.1 < 24 * 1024,
                    "{i}: {heap_sizes:?}"
                );
            }
        }
    }

    /// Both tables against a plain list, while the table turns over a few times.
    fn check_lookups(capacity: u32, period: usize, fields: usize) {
        let (mut encoder, mut decoder) = (Encoder::new(), Decoder::new());
        encoder.set_max_capacity(capacity);
        let block = encode(&mut encoder, ":method", "GET", Indexing::Add);
        assert!(decode(&mut decoder, &block).is_ok());

        let mut check = |name: &str, value: &str, indexing, flags, prefix_bits, index: usize| {
            let block = encode(&mut encoder, name, value, indexing);
            let mut start = Vec::new();
            integer::encode(&mut start, flags, prefix_bits, index as u32);
            assert!(block.starts_with(&start), "{name}: {value}, {index}");
            let field = (name.as_bytes().to_vec(), value.as_bytes().to_vec(), false);
            assert_eq!(decode(&mut decoder, &block), Ok(vec![field]));
            assert_eq!(decoder.table_size(), encoder.table_size());
        };
        // Oldest first.
        type Table = std::collections::VecDeque<(String, String)>;
        let (mut table, mut size) = (Table::new(), 0);
        for i in 0..fields {
            // Two fields in three have left the table by the time they come back.
            let (name, value) = match i % 3 {
                0 => (format!("x-{}", i % 7), format!("value {i}")),
                _ => (format!("x-rare-{}", i % period), "again".into()),
            };
            // A name is taken from the oldest entry that has it.
            let name_index = |table: &Table| {
                let named = table.iter().position(|entry| entry.0 == name);
                named.map_or(0, |at| 61 + table.len() - at)
            };
            check(&name, &value, Indexing::Add, 0x40, 6, name_index(&table));
            size += name.len() + value.len() + 32;
            table.push_back((name.clone(), value));
            while size > capacity as usize {
                let (name, value) = table.pop_front().unwrap();
                size -= name.len() + value.len() + 32;
            }
            check(&name, "", Indexing::Skip, 0x00, 4, name_index(&table));
            let (name, value) = &table[0];
            check(name, value, Indexing::Add, 0x80, 7, 61 + table.len());
        }
    }

    #[test]
    fn entries_are_found_until_they_are_evicted() {
        check_lookups(4096, 120, 150);
        check_lookups(1024, 30, 90);
    }

    #[test]
    fn a_hash_collision_is_not_a_match() {
        // Found by search. Another hash needs other pairs.
        let hash = |seed, bytes: &str| bun_wyhash::hash_with_seed(seed, bytes.as_bytes()) as u32;
        assert_eq!(hash(0, "n047767"), hash(0, "n055637"));
        let name_hash = u64::from(hash(0, "x-c"));
        assert_eq!(hash(name_hash, "024993"), hash(name_hash, "070489"));

        let (mut encoder, mut decoder) = (Encoder::new(), Decoder::new());
        for (name, value, first_byte) in [
            ("n047767", "a", 0x40),
            ("n055637", "b", 0x40),
            ("x-c", "024993", 0x40),
            ("x-c", "070489", 0x7e),
        ] {
            let block = encode(&mut encoder, name, value, Indexing::Add);
            assert_eq!(block[0], first_byte, "{name}: {value}");
            let field = (name.as_bytes().to_vec(), value.as_bytes().to_vec(), false);
            assert_eq!(decode(&mut decoder, &block), Ok(vec![field]));
        }
    }

    #[test]
    fn a_field_the_size_of_the_table() {
        let (mut encoder, mut decoder) = (Encoder::new(), Decoder::new());
        encoder.set_max_capacity(100);
        for (value_len, update_len, expected) in [(65, 2, "added"), (66, 0, "skipped")] {
            let block = encode(&mut encoder, "x-a", &"~".repeat(value_len), Indexing::Add);
            assert_eq!(representation(&block[update_len..]), expected);
            assert!(decode(&mut decoder, &block).is_ok());
            assert_eq!((encoder.table_size(), decoder.table_size()), (100, 100));
        }
    }

    #[test]
    fn the_static_index_follows_a_name_through_the_dynamic_table() {
        let mut decoder = Decoder::new();
        // accept: 1 and x-a: 1 enter the table. Their names are then taken from there.
        let block = hex("530131 4003782d610131 7f000132 7f000132 bf 93");
        let (mut pos, mut static_indices) = (0, Vec::new());
        while let Some(field) = decoder.next(&block, &mut pos) {
            static_indices.push(field.unwrap().static_index);
        }
        assert_eq!(static_indices, [19, 0, 19, 0, 19, 19]);
    }

    #[test]
    fn size_updates_up_to_the_acknowledged_limit() {
        let mut decoder = Decoder::new();
        assert!(decode(&mut decoder, &hex("3fe11f")).is_ok());
        assert_eq!(decode(&mut decoder, &hex("3fe21f")), Err(Error::Invalid));
        decoder.set_max_capacity(4097);
        assert!(decode(&mut decoder, &hex("3fe21f")).is_ok());
        decoder.set_max_capacity(100);
        assert!(decode(&mut decoder, &hex("3f45")).is_ok());
        assert_eq!(decode(&mut decoder, &hex("3f46")), Err(Error::Invalid));
    }

    #[test]
    fn strings_are_huffman_coded_unless_that_is_longer() {
        let mut decoder = Decoder::new();
        for (value, coded) in [
            ("", "00"),
            ("a", "811f"),
            ("~", "017e"),
            // 8 codes of 5 bits, the shortest there are.
            ("aaaaaaaa", "8518c6318c63"),
        ] {
            let block = encode(&mut Encoder::new(), "x-a", value, Indexing::Skip);
            assert_eq!(block[block.len() - coded.len() / 2..], hex(coded));
            let field = (b"x-a".to_vec(), value.as_bytes().to_vec(), false);
            assert_eq!(decode(&mut decoder, &block), Ok(vec![field]));
        }
        // A length that does not fit the prefix.
        let value = "a".repeat(208);
        let block = encode(&mut Encoder::new(), "x-a", &value, Indexing::Skip);
        assert_eq!(block[block.len() - 132..][..2], hex("ff03"));
        let field = (b"x-a".to_vec(), value.into_bytes(), false);
        assert_eq!(decode(&mut decoder, &block), Ok(vec![field]));
    }

    #[test]
    fn huffman_codes_of_every_byte() {
        let every_byte: Vec<u8> = (0..=255).collect();
        for string in every_byte.chunks(1).chain([&every_byte[..]]) {
            let (mut coded, mut decoded) = (Vec::new(), Vec::new());
            huffman::encode(string, &mut coded);
            assert_eq!(coded.len(), huffman::encoded_len(string));
            assert_eq!(huffman::decode(&coded, &mut decoded, string.len()), Ok(()));
            assert_eq!(decoded, string);
        }
    }

    #[test]
    fn a_lower_capacity_gives_memory_back() {
        let mut decoder = Decoder::new();
        decoder.set_max_capacity(65536);
        // 1000 entries of 64 bytes as §4.1 counts them, each with a name of its own.
        let name = |i: u8, j: u8, k: u8| [b'a' + i, b'a' + j, b'a' + k];
        let mut block = Vec::new();
        for (i, j, k) in (0..1000).map(|n| (n / 100, n / 10 % 10, n % 10)) {
            block.extend([0x40, 3]);
            block.extend(name(i as u8, j as u8, k as u8));
            block.push(29);
            block.extend([b'~'; 29]);
        }
        assert_eq!(decode(&mut decoder, &block).unwrap().len(), 1000);
        assert_eq!(decoder.table_size(), 64_000);
        let before = decoder.heap_size();

        decoder.set_max_capacity(1024);
        let after = decoder.heap_size();
        assert!(after < before / 4, "{before} {after}");

        // The 16 newest are left.
        let fields = decode(&mut decoder, &hex("be cd")).unwrap();
        assert_eq!(fields[0].0, name(9, 9, 9));
        assert_eq!(fields[1].0, name(9, 8, 4));
        assert_eq!(decode(&mut decoder, &hex("ce")), Err(Error::Invalid));
    }

    #[test]
    fn static_table_lookups() {
        let entries: Vec<_> = (1..=static_table::LEN)
            .map(|index| static_table::get(index).unwrap())
            .collect();
        for (index, &(name, value)) in (1..).zip(&entries) {
            let first = 1 + entries.iter().position(|entry| entry.0 == name).unwrap() as u32;
            assert_eq!(static_table::find_name(name), Some(first));
            assert_eq!(static_table::find(first, name, value), Some(index));
            assert_eq!(static_table::find(first, name, b"no such value"), None);
        }
        // Values that only later entries, with other names, have.
        assert_eq!(static_table::find(2, b":method", b"/"), None);
        assert_eq!(static_table::find(16, b"accept-encoding", b""), None);
        assert_eq!(static_table::find_name(b"x-a"), None);
        assert_eq!(static_table::find_name(b""), None);
    }

    #[test]
    fn malformed_blocks() {
        for block in [
            "80",                // index 0
            "be",                // past the end of the tables
            "41",                // no value
            "0003782d61",        // no value
            "000001 61",         // empty name
            "822182",            // size update after a field
            "82210161",          // the same, where 21 0161 could pass for a literal
            "8220",              // size update after a field, at the end
            "3fe21f",            // nothing but a size update to 4097
            "203f",              // a size update, then one that is cut off
            "3fe21f82",          // size update to 4097
            "0f",                // integer cut off
            "7fffffffff10",      // integer over 32 bits
            "000161 0261",       // string cut off
            "000161 81ff",       // 8 bits of padding
            "000161 8100",       // padding that is not ones: "0" and 000
            "000161 82ffff",     // 16 bits of padding
            "000161 84ffffffff", // EOS
            "01 85fffffffc7f",   // EOS, then "a"
        ] {
            assert_eq!(
                decode(&mut Decoder::new(), &hex(block)),
                Err(Error::Invalid),
                "{block}"
            );
        }
    }

    #[test]
    fn field_length_limit() {
        let mut encoder = Encoder::new();
        let name = "n".repeat(6);
        for (value_len, fits) in [(MAX_FIELD_LEN - 6, true), (MAX_FIELD_LEN - 5, false)] {
            // "~" takes 13 bits, so the value is sent as it is.
            let value = "~".repeat(value_len);
            let mut block = Vec::new();
            let encoded =
                encoder.encode(&mut block, name.as_bytes(), value.as_bytes(), Indexing::Add);
            assert_eq!(encoded.is_ok(), fits);
            if !fits {
                assert_eq!(block, []);
                encoder.encode_verbatim(&mut block, name.as_bytes(), value.as_bytes());
            }
            let mut pos = 0;
            let decoded = Decoder::new()
                .next(&block, &mut pos)
                .unwrap()
                .map(|field| field.value.len());
            assert_eq!(
                decoded,
                if fits {
                    Ok(value_len)
                } else {
                    Err(Error::TooLarge)
                }
            );
        }
    }

    #[test]
    fn never_indexed_fields_are_spelled_out() {
        let (mut encoder, mut decoder) = (Encoder::new(), Decoder::new());
        for (name, value, indexing, expected) in [
            ("x-a", "1", Indexing::Add, "added"),
            ("x-a", "1", Indexing::Skip, "indexed"),
            ("x-a", "1", Indexing::Never, "never indexed"),
            (":method", "GET", Indexing::Never, "never indexed"),
        ] {
            let block = encode(&mut encoder, name, value, indexing);
            assert_eq!(representation(&block), expected);
            let field = (
                name.as_bytes().to_vec(),
                value.as_bytes().to_vec(),
                indexing == Indexing::Never,
            );
            assert_eq!(decode(&mut decoder, &block), Ok(vec![field]));
        }
    }

    #[test]
    fn capacity_changes_are_announced_with_their_low_point() {
        let mut encoder = Encoder::new();
        encoder.set_max_capacity(4096);
        assert_eq!(
            encode(&mut encoder, ":method", "GET", Indexing::Add),
            hex("82")
        );
        encoder.set_max_capacity(100);
        encoder.set_max_capacity(0);
        encoder.set_max_capacity(65536);
        assert_eq!(
            encode(&mut encoder, ":method", "GET", Indexing::Add),
            hex("20 3fe11f 82")
        );
        assert_eq!(
            encode(&mut encoder, ":method", "GET", Indexing::Add),
            hex("82")
        );

        encode(&mut encoder, "x-a", "1", Indexing::Add);
        encode(&mut encoder, "x-b", "2", Indexing::Add);
        encoder.set_max_capacity(40);
        assert_eq!(encoder.table_size(), 36);
        encoder.set_max_capacity(4096);
        let mut block = Vec::new();
        encoder.encode_verbatim(&mut block, b"a", b"");
        assert_eq!(block, hex("3f09 3fe11f 00 0161 00"));
    }

    #[test]
    fn a_discarded_block_empties_both_tables() {
        let (mut encoder, mut decoder) = (Encoder::new(), Decoder::new());
        let sent = encode(&mut encoder, "x-a", "1", Indexing::Add);
        assert!(decode(&mut decoder, &sent).is_ok());
        encode(&mut encoder, "x-b", "2", Indexing::Add);
        encoder.discard_block();
        assert_eq!(encoder.table_size(), 0);

        let sent = encode(&mut encoder, "x-a", "1", Indexing::Add);
        assert_eq!(sent[..4], hex("20 3fe11f"));
        assert_eq!(representation(&sent[4..]), "added");
        assert!(decode(&mut decoder, &sent).is_ok());
        assert_eq!((encoder.table_size(), decoder.table_size()), (36, 36));
    }

    /// Fills the history and leaves the table empty.
    fn skip_values(encoder: &mut Encoder, values: core::ops::Range<u32>) {
        for value in values {
            encode(encoder, "x-a", &value.to_string(), Indexing::Skip);
        }
    }

    #[test]
    fn history_keeps_one_off_fields_out_of_the_table() {
        let mut encoder = Encoder::with_history();
        let mut add = |value| representation(&encode(&mut encoder, "x-a", value, Indexing::Add));
        assert_eq!(add("before it is full"), "added");

        let mut encoder = Encoder::with_history();
        // It holds 4096 / 32 / 3 hashes.
        skip_values(&mut encoder, 0..42);
        let mut add = |value| representation(&encode(&mut encoder, "x-a", value, Indexing::Add));
        assert_eq!(add("new"), "skipped");
        assert_eq!(add("new"), "added");
        // Those two pushed out 0 and 1.
        assert_eq!(add("1"), "skipped");
        assert_eq!(add("5"), "added");
    }

    #[test]
    fn a_shrinking_history_keeps_the_newest() {
        let mut encoder = Encoder::with_history();
        skip_values(&mut encoder, 0..50);
        // Room for 1024 / 32 / 3 hashes: those of 40 to 49.
        encoder.set_max_capacity(1024);
        let block = encode(&mut encoder, "x-a", "49", Indexing::Add);
        assert_eq!(block[..3], hex("3fe107"));
        assert_eq!(representation(&block[3..]), "added");
        let block = encode(&mut encoder, "x-a", "39", Indexing::Add);
        assert_eq!(representation(&block), "skipped");
        // Those two pushed out 40 and 41.
        let mut add = |value| representation(&encode(&mut encoder, "x-a", value, Indexing::Add));
        assert_eq!(add("41"), "skipped");
        assert_eq!(add("43"), "added");

        // No room for any.
        encoder.set_max_capacity(95);
        let block = encode(&mut encoder, "x-a", "new", Indexing::Add);
        assert_eq!(representation(&block[2..]), "added");
    }

    #[test]
    fn rfc7541_c1_integers() {
        for (prefix_bits, value, bytes) in [(5, 10, "0a"), (5, 1337, "1f9a0a"), (8, 42, "2a")] {
            let mut out = Vec::new();
            integer::encode(&mut out, 0, prefix_bits, value);
            assert_eq!(out, hex(bytes));
            let mut pos = 0;
            assert_eq!(integer::decode(&out, &mut pos, prefix_bits), Some(value));
            assert_eq!(pos, out.len());
        }
    }

    #[test]
    fn integer_limits() {
        for (bytes, value) in [
            ("1e", Some(30)),
            ("1f00", Some(31)),
            ("1f7f", Some(31 + 127)),
            ("1f8001", Some(31 + 128)),
            ("1fe0ffffff0f", Some(u32::MAX)),
            ("1fe1ffffff0f", None),   // one more
            ("1f8080808010", None),   // bit 32
            ("1f808080808001", None), // a sixth byte
            ("1f8080808000", None),   // padded with zeros to the fifth
            ("1f80", None),           // cut off
            ("1f", None),
            ("", None),
        ] {
            assert_eq!(integer::decode(&hex(bytes), &mut 0, 5), value, "{bytes}");
            if let Some(value) = value {
                let mut out = Vec::new();
                integer::encode(&mut out, 0, 5, value);
                assert_eq!(out, hex(bytes));
            }
        }
    }

    #[test]
    fn rfc7541_c4_requests() {
        let authority = (":authority", "www.example.com");
        check_blocks(
            4096,
            &[
                (
                    &[
                        (":method", "GET"),
                        (":scheme", "http"),
                        (":path", "/"),
                        authority,
                    ],
                    "828684418cf1e3c2e5f23a6ba0ab90f4ff",
                    57,
                ),
                (
                    &[
                        (":method", "GET"),
                        (":scheme", "http"),
                        (":path", "/"),
                        authority,
                        ("cache-control", "no-cache"),
                    ],
                    "828684be5886a8eb10649cbf",
                    110,
                ),
                (
                    &[
                        (":method", "GET"),
                        (":scheme", "https"),
                        (":path", "/index.html"),
                        authority,
                        ("custom-key", "custom-value"),
                    ],
                    "828785bf408825a849e95ba97d7f8925a849e95bb8e8b4bf",
                    164,
                ),
            ],
        );
    }

    #[test]
    fn rfc7541_c6_responses_with_eviction() {
        let cache_control = ("cache-control", "private");
        let location = ("location", "https://www.example.com");
        check_blocks(
            256,
            &[
                (
                    &[
                        (":status", "302"),
                        cache_control,
                        ("date", "Mon, 21 Oct 2013 20:13:21 GMT"),
                        location,
                    ],
                    // The RFC leaves out the size update to 256 that this begins with.
                    "3fe101 488264025885aec3771a4b6196d07abe941054d444a8200595040b8166e082a62d1bff6e919d29ad171863c78f0b97c8e9ae82ae43d3",
                    222,
                ),
                (
                    &[
                        (":status", "307"),
                        cache_control,
                        ("date", "Mon, 21 Oct 2013 20:13:21 GMT"),
                        location,
                    ],
                    "4883640effc1c0bf",
                    222,
                ),
                (
                    &[
                        (":status", "200"),
                        cache_control,
                        ("date", "Mon, 21 Oct 2013 20:13:22 GMT"),
                        location,
                        ("content-encoding", "gzip"),
                        (
                            "set-cookie",
                            "foo=ASDJKHQKBZXOQWEOPIUAXQWEOIU; max-age=3600; version=1",
                        ),
                    ],
                    "88c16196d07abe941054d444a8200595040b8166e084a62d1bffc05a839bd9ab77ad94e7821dd7f2e6c7b335dfdfcd5b3960d5af27087f3672c1ab270fb5291f9587316065c003ed4ee5b1063d5007",
                    215,
                ),
            ],
        );
    }
}
