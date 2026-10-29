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

/// The longest name and value together that [`Encoder::encode`] takes and the decoder accepts.
const MAX_FIELD_LEN: usize = 65536;

/// What an entry counts towards the table size beside its name and value (§4.1).
const ENTRY_OVERHEAD: usize = 32;

#[cfg(test)]
#[allow(clippy::unwrap_used, clippy::indexing_slicing)]
mod tests {
    use super::*;

    // Miri skips the tests that take it over 10 seconds. `cargo test` runs them all.

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
    fn a_field_left_out_of_the_table_takes_no_index() {
        let mut decoder = Decoder::new();
        let fields = decode(&mut decoder, &hex("0003782d610131 4003782d620132 be")).unwrap();
        assert_eq!(fields[2], (b"x-b".to_vec(), b"2".to_vec(), false));
        assert_eq!(decoder.table_size(), 36);
        // Nor does it count while the block goes on.
        assert!(decoder.next(&hex("0003782d610131 be"), &mut 0).is_some());
        assert_eq!(decoder.table_size(), 36);
    }

    #[test]
    fn an_added_field_larger_than_the_table_empties_it() {
        let mut decoder = Decoder::new();
        // 36 bytes hold x-a: 1 and not x-b: 22.
        let fields = decode(&mut decoder, &hex("3f05 4003782d610131 4003782d62023232")).unwrap();
        assert_eq!(fields[1], (b"x-b".to_vec(), b"22".to_vec(), false));
        assert_eq!(decoder.table_size(), 0);
        assert_eq!(decode(&mut decoder, &hex("be")), Err(Error::Invalid));
    }

    #[test]
    fn a_block_of_nothing_but_size_updates() {
        let mut decoder = Decoder::new();
        // Nor any of those.
        assert!(decoder.next(&[], &mut 0).is_none());
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
    fn a_max_capacity_that_does_not_grow_keeps_the_capacity_the_peer_chose() {
        // Three entries of 36 bytes.
        let three = hex("4003782d610131 4003782d610132 4003782d610133");
        for max_capacity in [4096, 200] {
            let mut decoder = Decoder::new();
            // To 100 bytes, which hold two of them.
            assert!(decode(&mut decoder, &hex("3f45 82")).is_ok());
            decoder.set_max_capacity(max_capacity);
            assert!(decode(&mut decoder, &three).is_ok());
            assert_eq!(decoder.table_size(), 72);

            decoder.set_max_capacity(40);
            assert_eq!(decoder.table_size(), 36);
            decoder.set_max_capacity(200);
            assert!(decode(&mut decoder, &three).is_ok());
            assert_eq!(decoder.table_size(), 144);
        }
    }

    #[test]
    #[cfg_attr(miri, ignore)]
    fn memory_stays_bounded() {
        let (mut encoder, mut decoder) = (Encoder::new(), Decoder::new());
        // The table holds about ten of these, so it turns over many times.
        for i in 0..160 {
            let (name, value) = (format!("{i}{}", "~".repeat(150)), "~".repeat(150 + i % 100));
            let mut block = encode(&mut encoder, &name, &value, Indexing::Add);
            if i % 8 == 7 {
                // One that does not fit at all, which an encoder does not keep.
                block.extend(hex("00 0161"));
                integer::encode(&mut block, 0x00, 7, i as u32 * 400);
                block.extend(vec![b'~'; i * 400]);
            }
            assert!(decode(&mut decoder, &block).is_ok());
            assert_eq!(decoder.table_size(), encoder.table_size());
            // What the large field took is given back at the end of its block.
            let heap_sizes = (encoder.heap_size(), decoder.heap_size());
            assert!(
                heap_sizes.0 < 18 * 1024 && heap_sizes.1 < 18 * 1024,
                "{i}: {heap_sizes:?}"
            );
        }
    }

    #[test]
    fn a_short_huffman_string_takes_little_room() {
        let (mut decoder, mut pos) = (Decoder::new(), 0);
        let field = decoder.next(&hex("00 0161 811f"), &mut pos).unwrap();
        assert_eq!(field.unwrap().value, b"a");
        // In the middle of the block, so nothing was given back yet.
        assert!(decoder.heap_size() < 1024);
    }

    #[test]
    #[cfg_attr(miri, ignore)]
    fn a_large_table_is_not_moved_every_few_blocks() {
        for capacity in [6000, 8192, 1 << 20] {
            let mut decoder = Decoder::new();
            decoder.set_max_capacity(capacity);
            let block = [&hex("40 016e 7fad01")[..], &[b'v'; 300]].concat();
            let (mut heap_size, mut changes) = (0, 0);
            for _ in 0..1000 {
                assert!(decode(&mut decoder, &block).is_ok());
                changes += usize::from(decoder.heap_size() != heap_size);
                heap_size = decoder.heap_size();
            }
            // Its two allocations double as it fills up.
            assert!(changes < 20, "{capacity}: {changes}");
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
    #[cfg_attr(miri, ignore)]
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

        let (mut encoder, mut decoder) = (Encoder::with_seed(0), Decoder::new());
        for (name, value, first_byte) in [
            ("n047767", "a", 0x40),
            ("n055637", "a", 0x40),
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
    #[cfg_attr(miri, ignore)]
    fn fields_made_for_one_bucket_share_it_under_one_seed_only() {
        // A table has up to 256 buckets.
        let made_for = |seed| {
            let strings = (0..).map(|i: u32| i.to_string());
            let made =
                strings.filter(move |s| bun_wyhash::hash_with_seed(seed, s.as_bytes()) as u8 == 0);
            made.take(90).collect::<Vec<String>>()
        };
        // `cookie` is entry 32 of the static table, which stands for its hash.
        let (values, names) = (made_for(32), made_for(0));
        let by_field = values.iter().map(|value| ("cookie", &value[..]));
        let by_name = names.iter().map(|name| (&name[..], "1"));
        for (chain, fields) in [by_field.collect::<Vec<_>>(), by_name.collect()]
            .iter()
            .enumerate()
        {
            let longest_chain = |mut encoder: Encoder| {
                for (name, value) in fields {
                    encode(&mut encoder, name, value, Indexing::Add);
                }
                encoder.longest_chains()[chain]
            };
            assert_eq!(longest_chain(Encoder::with_seed(0)), 90);
            assert!(longest_chain(Encoder::new()) < 10);
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
        // The limits one after the other, then a size update to the last of them and one over it.
        for (limits, to_it, over_it) in [
            (&[][..], "3fe11f", "3fe21f"),
            (&[4097], "3fe21f", "3fe31f"),
            (&[4097, 100], "3f45", "3f46"),
            (&[4097, 100, 1 << 16], "3fe1ff03", "3fe2ff03"),
        ] {
            let mut decoder = Decoder::new();
            for &max_capacity in limits {
                decoder.set_max_capacity(max_capacity);
            }
            let block = [hex(to_it), hex("4003782d610131")].concat();
            assert!(decode(&mut decoder, &block).is_ok());
            assert_eq!(decoder.table_size(), 36);
            assert_eq!(decode(&mut decoder, &hex(over_it)), Err(Error::Invalid));
        }
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
            // Codes of 8 bits: as long either way.
            ("&&&&&", "85f8f8f8f8f8"),
            // Longer by the 5 bits that "~" has more.
            ("&&&&&&&~", "08262626262626267e"),
        ] {
            let block = encode(&mut Encoder::new(), "x-a", value, Indexing::Skip);
            assert_eq!(block[block.len() - coded.len() / 2..], hex(coded));
            let field = (b"x-a".to_vec(), value.as_bytes().to_vec(), false);
            assert_eq!(decode(&mut decoder, &block), Ok(vec![field]));
        }
        // Up to a length that does not fit the prefix, of the string and then of its code.
        for (value, len, coded_len) in [
            ("a".repeat(126), "cf", 79),
            ("a".repeat(127), "d0", 80),
            ("a".repeat(208), "ff03", 130),
            ("~".repeat(126), "7e", 126),
            ("~".repeat(127), "7f00", 127),
            ("&".repeat(127), "ff00", 127),
        ] {
            let block = encode(&mut Encoder::new(), "x-a", &value, Indexing::Skip);
            let string = &block[block.len() - coded_len - len.len() / 2..];
            assert_eq!(string[..len.len() / 2], hex(len));
            let field = (b"x-a".to_vec(), value.into_bytes(), false);
            assert_eq!(decode(&mut decoder, &block), Ok(vec![field]));
        }
    }

    /// With and without the stand-in for the SIMD kernel.
    fn decode_huffman(coded: &[u8], max_len: usize) -> Result<Vec<u8>> {
        let [without, with] = [false, true].map(|kernel| {
            huffman::test_kernel::ENABLED.set(kernel);
            let mut decoded = vec![2];
            let result = huffman::decode(coded, &mut decoded, max_len);
            huffman::test_kernel::ENABLED.set(false);
            result.map(|()| decoded.split_off(1))
        });
        assert_eq!(without, with);
        with
    }

    fn check_huffman(string: &[u8]) {
        let mut coded = vec![1];
        huffman::encode(string, &mut coded);
        assert_eq!(coded.len(), 1 + huffman::encoded_len(string));
        assert_eq!(
            decode_huffman(&coded[1..], string.len()),
            Ok(string.to_vec())
        );
        if !string.is_empty() {
            let too_large = decode_huffman(&coded[1..], string.len() - 1);
            assert_eq!(too_large, Err(Error::TooLarge));
        }
    }

    fn kernel_calls(string: &[u8]) -> usize {
        let mut coded = Vec::new();
        huffman::encode(string, &mut coded);
        huffman::test_kernel::CALLS.set(0);
        assert_eq!(decode_huffman(&coded, string.len()), Ok(string.to_vec()));
        huffman::test_kernel::CALLS.get()
    }

    #[test]
    fn when_the_simd_kernel_is_called() {
        let calls = kernel_calls;
        // 4 and 5 bytes, of a code of 8 bits that starts with 6 ones.
        assert_eq!((calls(b"ZZZZ"), calls(b"ZZZZZ")), (0, 1));
        // To the end, as the calls that yield few come after calls that yield many. None yields 29.
        assert!(calls(&[b'a'; 1000]) > 1000 / 29);
        // Never before a code of 10 bits, which starts with 7 ones, and not again after a call that yields one symbol.
        assert_eq!((calls(&[b'!'; 100]), calls(&b"a!!".repeat(30))), (0, 1));
    }

    #[test]
    #[cfg_attr(miri, ignore)]
    fn the_simd_kernel_is_given_up_on_however_well_it_did() {
        // The first 1000 take 84 calls at most, as these yield 12 on average. The last 3000 would take over 100.
        let mixed = [&[b'a'; 1000][..], &b"a!!".repeat(40), &[b'a'; 3000]].concat();
        assert!(kernel_calls(&mixed) < 100);
    }

    #[test]
    #[cfg_attr(miri, ignore)]
    fn huffman_codes_of_every_byte() {
        let every_byte: Vec<u8> = (0..=255).collect();
        for string in every_byte.chunks(1).chain([&every_byte[..]]) {
            check_huffman(string);
        }
        // 14 zeros, the first entry of the decoder's table.
        check_huffman(b"000");
        // Every code of 8 bits, the longest that the kernel takes.
        check_huffman(b"&*,;XZ");
    }

    /// Coding and decoding with one wrong table would agree. The hash is of the 583 bytes that Go's encoder and the RFC's table give.
    #[test]
    fn huffman_codes_are_those_of_the_rfc() {
        let every_byte: Vec<u8> = (0..=255).collect();
        let mut coded = Vec::new();
        huffman::encode(&every_byte, &mut coded);
        assert_eq!(bun_wyhash::hash(&coded), 12907497261869469722);
    }

    #[test]
    #[cfg_attr(miri, ignore)]
    fn huffman_codes_of_every_length_next_to_each_other() {
        // Codes of 5, 6, 7, 8, 10, 13, 15, 19, 26 and 30 bits.
        let bytes = b"a-:&!~{\\\xff\x0a";
        for len in (0..14).chain([19, 26, 33]) {
            for step in 0..bytes.len() {
                let byte = |i| bytes[i * step % 7 * (i + step) % bytes.len()];
                check_huffman(&(0..len).map(byte).collect::<Vec<u8>>());
            }
        }
    }

    #[test]
    #[cfg_attr(miri, ignore)]
    fn huffman_codes_that_end_where_8_bytes_end() {
        // Codes of 14 and 15 bits, from every bit of a byte on.
        for (fives, sixes) in (0..8).flat_map(|fives| (0..8).map(move |sixes| (fives, sixes))) {
            for codes in [
                "{{{}", "{{}}", "}{{}", "}}}{", "}}}}}", "`}}}", "}`}}", "}}`}",
            ] {
                let string = ["a".repeat(fives), "-".repeat(sixes), codes.repeat(3)].concat();
                check_huffman(string.as_bytes());
            }
        }
    }

    /// Every way the coder writes 7 bytes at once, after every number of pending bits, and every rest.
    #[test]
    #[cfg_attr(miri, ignore)]
    fn huffman_codes_in_groups() {
        let groups: [&[u8; 7]; 12] = [
            b"aaaaaaa",      // 35 bits
            b"&&&&&&&",      // 56, the most that plain text has
            b"!&&&&&:",      // 57, the most that is written at once
            b"!&&&&&&",      // 58, so 34 and 24
            b"{{{#aaa",      // 57 and 15
            b"{{{~aaa",      // 58 and 15, so one by one
            b"aaaa\\\\\\",   // 20 and 57
            b"aaaa\\\\\x80", // 20 and 58, so one by one
            b"\n\n\n\naaa",  // 120, which does not fit 64 bits, and 15
            b"aaaa\n\n\n",   // 20 and 90
            b"a\naaaa\x80",  // 45 and 30, the long codes second
            b"aaa\na\xffa",  // 45 and 36
        ];
        for sixes in 0..8 {
            // 35 to 42 bits, so that what follows comes after every number of pending bits.
            let start = [b"-".repeat(sixes), b"a".repeat(7 - sixes)].concat();
            for group in groups {
                // Too short for `encode_groups`, as the last 7 bytes and not.
                check_huffman(&[&start, &group[..]].concat());
                check_huffman(&[&start, &group[..], b"zzz"].concat());
            }
            let rest = b"z".repeat(huffman::GROUPS_MIN_LEN + sixes);
            let all = groups.map(|group| *group);
            check_huffman(&[&start[..], all.as_flattened(), &rest].concat());
            // 90 bits are all that is left, after 7 bytes and after whole groups.
            check_huffman(&[&start, &b"\n\n\n"[..]].concat());
            let whole = b"a".repeat(huffman::GROUPS_MIN_LEN.next_multiple_of(7));
            check_huffman(&[&start, &whole, &b"\n\n\n"[..]].concat());
        }
        // Every byte in a place where room is made for its code by a multiplication.
        let every_byte = (0..128).flat_map(|byte| [b'a', byte, b'a', b'a', b'a', byte + 128, b'a']);
        check_huffman(&every_byte.collect::<Vec<_>>());
    }

    #[test]
    fn a_huffman_string_that_is_too_long_and_malformed_is_too_long() {
        for (coded, symbols) in [
            ("18c6318c63 fe", 8),   // "aaaaaaaa", then the start of a longer code
            ("18c6318c63 ffff", 8), // then 16 bits of padding
            ("18", 1),              // "a", then 000, which the padding would make another "a"
            ("18c6", 3),            // "aaa", then 0, which the padding would make "9"
            ("5961", 2),            // "--", then 0001, which the padding would make "a"
            ("1adffe", 2),          // "a-", then 13 bits, which the padding would make "}"
            ("18fffe", 2),          // "aa", then 14 bits, which the padding would make "`"
            ("18c6318c63 18c6318c63 18c6318c63 18", 25),
        ] {
            let decode = |max_len| decode_huffman(&hex(coded), max_len);
            assert_eq!(decode(symbols), Err(Error::Invalid), "{coded}");
            assert_eq!(decode(symbols - 1), Err(Error::TooLarge), "{coded}");
            assert_eq!(decode(0), Err(Error::TooLarge), "{coded}");
        }
    }

    #[test]
    fn eos_anywhere_in_a_huffman_string() {
        for (before, after) in (0..20).flat_map(|before| [0, 7, 30].map(|after| (before, after))) {
            let string = [vec![b'a'; before], vec![b'\n'], vec![b'a'; after]].concat();
            let mut coded = Vec::new();
            huffman::encode(&string, &mut coded);
            // The code of a line feed is EOS but for its last two bits.
            for bit in [5 * before + 28, 5 * before + 29] {
                coded[bit / 8] |= 0x80 >> (bit % 8);
            }
            assert_eq!(decode_huffman(&coded, 99), Err(Error::Invalid));
        }
    }

    #[test]
    #[cfg_attr(miri, ignore)]
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
    fn rfc7541_appendix_a() {
        let mut table = String::new();
        for index in 1..=61 {
            let fields = decode(&mut Decoder::new(), &[0x80 | index]).unwrap();
            let (name, value) = (str::from_utf8(&fields[0].0), str::from_utf8(&fields[0].1));
            table += &format!("{} {}|", name.unwrap(), value.unwrap());
        }
        assert_eq!(
            table,
            ":authority |:method GET|:method POST|:path /|:path /index.html|:scheme http|\
             :scheme https|:status 200|:status 204|:status 206|:status 304|:status 400|\
             :status 404|:status 500|accept-charset |accept-encoding gzip, deflate|\
             accept-language |accept-ranges |accept |access-control-allow-origin |age |allow |\
             authorization |cache-control |content-disposition |content-encoding |\
             content-language |content-length |content-location |content-range |content-type |\
             cookie |date |etag |expect |expires |from |host |if-match |if-modified-since |\
             if-none-match |if-range |if-unmodified-since |last-modified |link |location |\
             max-forwards |proxy-authenticate |proxy-authorization |range |referer |refresh |\
             retry-after |server |set-cookie |strict-transport-security |transfer-encoding |\
             user-agent |vary |via |www-authenticate |"
        );
    }

    #[test]
    fn static_table_lookups() {
        let entries: Vec<_> = (1..=static_table::LEN)
            .map(|index| static_table::get(index).unwrap())
            .collect();
        for (index, &(name, value)) in (1..).zip(&entries) {
            let first = 1 + entries.iter().position(|entry| entry.0 == name).unwrap() as u32;
            let end = 2 + entries.iter().rposition(|entry| entry.0 == name).unwrap() as u32;
            assert_eq!(static_table::find_name(name), Some((first, end)));
            assert_eq!(static_table::find((first, end), value), Some(index));
            assert_eq!(static_table::find((first, end), b"no such value"), None);
        }
        // Values that only later entries, with other names, have, and near misses.
        for (name, value) in [
            (":method", "/"),
            (":method", "get"),
            (":method", "GETs"),
            (":status", "2000"),
            ("accept-encoding", ""),
            ("accept-encoding", "GZIP, DEFLATE"),
        ] {
            let indices = static_table::find_name(name.as_bytes()).unwrap();
            let found = static_table::find(indices, value.as_bytes());
            assert_eq!(found, None, "{name}: {value}");
        }
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
            "008001 61",         // the same, Huffman coded
            "822182",            // size update after a field
            "82210161",          // the same, where 21 0161 could pass for a literal
            "8220",              // size update after a field, at the end
            "3fe21f",            // nothing but a size update to 4097
            "203f",              // a size update, then one that is cut off
            "3fe21f82",          // size update to 4097
            "0f",                // integer cut off
            "ff",                // the same in an indexed field
            "3f",                // the same in a size update
            "7fffffffff10",      // integer over 32 bits
            "ffffffffff10",      // the same in an indexed field
            "7fffffffff10 0161", // the same, and a value after it
            "007f",              // the length of a name cut off
            "00ff",              // the same for a Huffman coded one
            "007fffffffff7f",    // the length of a name over 32 bits
            "01 7f",             // the length of a value cut off
            "01 7fffffffff7f",   // the length of a value over 32 bits
            "01 7fffffffff7f61", // the same, and a byte after it
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
    #[cfg_attr(miri, ignore)]
    fn field_length_limit() {
        let mut encoder = Encoder::new();
        let name = "n".repeat(6);
        for (value_len, fits) in [(MAX_FIELD_LEN - 6, true), (MAX_FIELD_LEN - 5, false)] {
            // "~" takes 13 bits, so the value is sent as it is.
            let value = "~".repeat(value_len);
            let mut block = Vec::new();
            // There is a size update to send each time.
            encoder.set_max_capacity(value_len as u32 % 4096);
            let encoded =
                encoder.encode(&mut block, name.as_bytes(), value.as_bytes(), Indexing::Add);
            assert_eq!(encoded, if fits { Ok(()) } else { Err(Error::TooLarge) });
            if !fits {
                // Not even the size update.
                assert!(block.is_empty());
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
    #[cfg_attr(miri, ignore)]
    fn field_length_limit_however_the_strings_are_coded() {
        let string = |len: usize, coded| {
            let mut out = Vec::new();
            if coded {
                // 8 times "a" take 5 bytes.
                let mut code = hex("18c6318c63").repeat(len / 8);
                huffman::encode(&vec![b'a'; len % 8], &mut code);
                integer::encode(&mut out, 0x80, 7, code.len() as u32);
                out.extend(code);
            } else {
                integer::encode(&mut out, 0x00, 7, len as u32);
                out.extend(vec![b'a'; len]);
            }
            out
        };
        for (name_len, name_coded, value_len, value_coded, fits) in [
            (6, true, MAX_FIELD_LEN - 6, false, true),
            (6, true, MAX_FIELD_LEN - 5, false, false),
            (6, false, MAX_FIELD_LEN - 5, true, false),
            (MAX_FIELD_LEN - 1, false, 1, true, true),
            (MAX_FIELD_LEN, false, 1, true, false),
            (MAX_FIELD_LEN + 1, false, 1, true, false),
            (MAX_FIELD_LEN, true, 0, false, true),
        ] {
            let mut block = vec![0x00];
            block.extend(string(name_len, name_coded));
            block.extend(string(value_len, value_coded));
            let decoded = decode(&mut Decoder::new(), &block).map(|fields| fields.len());
            assert_eq!(decoded, if fits { Ok(1) } else { Err(Error::TooLarge) });
        }
        // A name that is far too long and then malformed: it is not decoded to its end.
        let mut name = hex("18c6318c63").repeat(MAX_FIELD_LEN / 2);
        name.push(0xfe);
        let mut block = vec![0x00];
        integer::encode(&mut block, 0x80, 7, name.len() as u32);
        block.extend(name);
        block.extend(hex("0161"));
        let mut decoder = Decoder::new();
        assert_eq!(decode(&mut decoder, &block), Err(Error::TooLarge));
        assert!(decoder.heap_size() < 2 * MAX_FIELD_LEN);
    }

    #[test]
    #[cfg_attr(miri, ignore)]
    fn field_length_limit_with_a_name_from_a_table() {
        // :authority, and an entry with a name of 9,000 bytes.
        for (name_index, name_len) in [("01", 10), ("0f2f", 9000)] {
            let mut decoder = Decoder::new();
            decoder.set_max_capacity(1 << 14);
            let entry = [hex("40 7fa945"), vec![b'n'; 9000], hex("00")].concat();
            assert!(decode(&mut decoder, &entry).is_ok());
            let room = MAX_FIELD_LEN - name_len;
            for (value_len, decoded) in [(room, Ok(room)), (room + 1, Err(Error::TooLarge))] {
                let mut block = hex(name_index);
                integer::encode(&mut block, 0x00, 7, value_len as u32);
                block.extend(vec![b'v'; value_len]);
                let fields = decode(&mut decoder, &block);
                assert_eq!(fields.map(|fields| fields[0].1.len()), decoded);
            }
        }
    }

    #[test]
    fn the_length_limit_is_not_on_what_is_left_of_the_block() {
        let field = [hex("00 0161 7e"), vec![b'b'; 0x7e]].concat();
        let fields = MAX_FIELD_LEN / field.len() + 1;
        let decoded = decode(&mut Decoder::new(), &field.repeat(fields));
        assert_eq!(decoded.map(|fields| fields.len()), Ok(fields));
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
            assert_eq!(encoder.table_size(), decoder.table_size());
        }
    }

    #[test]
    fn a_never_indexed_field_takes_its_name_from_the_tables() {
        let mut encoder = Encoder::new();
        encode(&mut encoder, "x-a", "1", Indexing::Add);
        let block = encode(&mut encoder, "x-a", "2", Indexing::Never);
        assert_eq!(block, hex("1f2f 8117"));
        let block = encode(&mut encoder, ":method", "2", Indexing::Never);
        assert_eq!(block, hex("12 8117"));
    }

    #[test]
    fn capacity_changes_are_announced_with_their_low_point() {
        let mut encoder = Encoder::new();
        // It has 4096 bytes and takes no more.
        for max_capacity in [4096, 65536] {
            encoder.set_max_capacity(max_capacity);
            assert_eq!(
                encode(&mut encoder, ":method", "GET", Indexing::Add),
                hex("82")
            );
        }
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
    fn a_capacity_raised_after_a_lower_one_was_announced() {
        let (mut encoder, mut decoder) = (Encoder::new(), Decoder::new());
        for (capacity, update, value_len, table_size) in
            [(100, "3f45", 1, 36), (4096, "3fe11f", 60, 36 + 95)]
        {
            encoder.set_max_capacity(capacity);
            let block = encode(&mut encoder, "x-a", &"v".repeat(value_len), Indexing::Add);
            assert!(block.starts_with(&hex(update)));
            assert!(decode(&mut decoder, &block).is_ok());
            let table_sizes = (encoder.table_size(), decoder.table_size());
            assert_eq!(table_sizes, (table_size, table_size));
        }
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
        // It holds 4096 / 32 / 3 hashes. The field that fills it goes by it already.
        for (before, expected) in [(0, "added"), (40, "added"), (41, "skipped")] {
            let mut encoder = Encoder::with_history();
            skip_values(&mut encoder, 0..before);
            let block = encode(&mut encoder, "x-a", "new", Indexing::Add);
            assert_eq!(representation(&block), expected);
        }

        let mut encoder = Encoder::with_history();
        skip_values(&mut encoder, 0..42);
        let mut add = |value| representation(&encode(&mut encoder, "x-a", value, Indexing::Add));
        assert_eq!(add("new"), "skipped");
        assert_eq!(add("new"), "added");
        // Those two pushed out 0 and 1.
        assert_eq!(add("1"), "skipped");
        assert_eq!(add("5"), "added");
    }

    #[test]
    fn history_leaves_a_never_indexed_field_as_it_is() {
        let mut encoder = Encoder::with_history();
        skip_values(&mut encoder, 0..42);
        let block = encode(&mut encoder, "x-a", "new", Indexing::Never);
        assert_eq!(representation(&block), "never indexed");
    }

    #[test]
    fn history_tells_a_value_under_two_names_apart() {
        let mut encoder = Encoder::with_history();
        skip_values(&mut encoder, 0..42);
        let block = encode(&mut encoder, "x-b", "41", Indexing::Add);
        assert_eq!(representation(&block), "skipped");
    }

    #[test]
    fn history_takes_note_of_fields_sent_as_an_index() {
        for (name, value, index) in [(":method", "GET", 0x82), ("x-b", "1", 0xbe)] {
            let mut encoder = Encoder::with_history();
            encode(&mut encoder, "x-b", "1", Indexing::Add);
            skip_values(&mut encoder, 0..42);
            // All but the last of those 42 make way.
            for _ in 0..41 {
                assert_eq!(encode(&mut encoder, name, value, Indexing::Add), [index]);
            }
            let mut add =
                |value| representation(&encode(&mut encoder, "x-a", value, Indexing::Add));
            assert_eq!(add("41"), "added");
            assert_eq!(add("40"), "skipped");
        }
    }

    #[test]
    fn history_takes_note_of_fields_that_stay_out_of_the_table() {
        let too_large = "~".repeat(4096);
        for (value, indexing) in [(&too_large[..], Indexing::Add), ("new", Indexing::Never)] {
            let mut encoder = Encoder::with_history();
            skip_values(&mut encoder, 0..42);
            encode(&mut encoder, "x-a", value, indexing);
            // It pushed out 0.
            let block = encode(&mut encoder, "x-a", "0", Indexing::Add);
            assert_eq!(representation(&block), "skipped");
        }
    }

    #[test]
    fn a_refused_field_leaves_the_table_and_the_history_alone() {
        let mut encoder = Encoder::with_history();
        encode(&mut encoder, "x-b", "1", Indexing::Add);
        skip_values(&mut encoder, 0..42);
        let (mut block, value) = (Vec::new(), vec![b'~'; MAX_FIELD_LEN]);
        let refused = encoder.encode(&mut block, b"x-a", &value, Indexing::Add);
        assert_eq!(refused, Err(Error::TooLarge));
        encoder.encode_verbatim(&mut block, b"x-a", &value);
        assert_eq!(encoder.table_size(), 36);
        // Neither pushed out 0.
        let block = encode(&mut encoder, "x-a", "0", Indexing::Add);
        assert_eq!(representation(&block), "added");
    }

    #[test]
    fn history_goes_by_the_capacity_in_use() {
        // 64 bytes leave no room for a history.
        for low in [1024, 64] {
            let mut encoder = Encoder::with_history();
            encoder.set_max_capacity(low);
            encoder.set_max_capacity(65536);
            // 4096 / 32 / 3 of them fill it, whatever the peer allows.
            skip_values(&mut encoder, 0..42);
            let block = encode(&mut encoder, "x-a", "new", Indexing::Add);
            assert_eq!(representation(&block), "skipped");
        }
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
    fn a_growing_history_keeps_its_order() {
        let mut encoder = Encoder::with_history();
        skip_values(&mut encoder, 0..15);
        encoder.set_max_capacity(1024);
        // It holds 10 to 19, and the oldest is in the middle.
        skip_values(&mut encoder, 15..20);
        encoder.set_max_capacity(4096);
        // Full again after 32 more. The one after those pushed out 10.
        skip_values(&mut encoder, 20..53);
        let mut add = |value| representation(&encode(&mut encoder, "x-a", value, Indexing::Add));
        assert_eq!(add("11"), "added");
        assert_eq!(add("10"), "skipped");
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
            ("1f808080808100", None), // the same, after a fifth that is not zero
            ("1f808080808f00", None),
            ("1f8080808000", None), // padded with zeros to the fifth
            ("1f80", None),         // cut off
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

    // From here on: the reproducers in ls-hpack's own history, by the commit that fixed each.

    /// test_int.c, with f427d19 and b692931: shifts of 35 bits, and of 15 by 28 as an `int`.
    #[test]
    fn ls_hpack_integers() {
        for (prefix_bits, bytes, value) in [
            (7, "7f02", Some(0x81)),
            (7, "7f818203", Some(0xc101 + 127)),
            (7, "7f81828303", Some(0x60c101 + 127)),
            (7, "7f80ffffff0f", Some(u32::MAX)),
            (7, "7f90ffffff0f", None),
            (7, "7fffffffffffffffffffff", None),
            (4, "fe", Some(0xe)),
            (6, "3f64", Some(0x3f + 0x64)),
            (4, "ff", None),
            (3, "87f0807f", Some(0x1fc077)),
            (3, "8780808001", Some(0x200007)),
            (3, "878080808001", Some(0x10000007)),
        ] {
            let bytes = hex(bytes);
            let mut pos = 0;
            assert_eq!(integer::decode(&bytes, &mut pos, prefix_bits), value);
            for len in 0..bytes.len() {
                assert_eq!(integer::decode(&bytes[..len], &mut 0, prefix_bits), None);
            }
            if let Some(value) = value {
                assert_eq!(pos, bytes.len());
                let mut out = Vec::new();
                let flags = bytes[0] & (0xff << prefix_bits);
                integer::encode(&mut out, flags, prefix_bits, value);
                assert_eq!(out, bytes);
            }
        }
    }

    /// fb24b7a (8 bits of padding), ae2304a and 6b9a958 (padding that is not ones), cf3ac6b (valid padding refused).
    #[test]
    fn ls_hpack_huffman_padding() {
        let invalid = Err(Error::Invalid);
        assert_eq!(decode_huffman(b"", 9), Ok(vec![]));
        assert_eq!(decode_huffman(&hex("bfd037d9"), 9), Ok(b"Dj1D3".to_vec()));
        assert_eq!(decode_huffman(&hex("bfd037d9ff"), 99), invalid);
        assert_eq!(decode_huffman(&hex("d96863844cfe77a0bcc9ff"), 99), invalid);
        let lite_speed = Ok(b"LiteSpeed".to_vec());
        assert_eq!(decode_huffman(&hex("ce649775652c9f"), 9), lite_speed);
        assert_eq!(decode_huffman(&hex("ce649775652c9e"), 9), invalid);
        for string in [
            &b"Dude, where is my car?"[..],
            b"Dude, where is my car\\",
            b"\x01\x02\x03Where is your\\ car, ,\\dude?",
        ] {
            check_huffman(string);
            let mut coded = Vec::new();
            huffman::encode(string, &mut coded);
            for garbage in [&[0xff][..], &[0xff, 0xff]] {
                assert_eq!(decode_huffman(&[&coded, garbage].concat(), 99), invalid);
            }
            *coded.last_mut().unwrap() &= !1;
            assert_eq!(decode_huffman(&coded, 99), invalid);
        }
    }

    /// test_huff_dec_fallback: a code of 19 bits at every place among codes of 13, and more and more of them.
    #[test]
    fn ls_hpack_huffman_long_codes_among_short_ones() {
        let mut string = [b'@'; 26];
        string[25] = 0;
        for i in 0..string.len() {
            string[i] = b'\\';
            check_huffman(&string);
        }
    }

    /// 45f36ef, 16cf6a7 and a1f1ea8: the Huffman encoder wrote or read past the end, or shifted by 32 bits.
    #[test]
    fn ls_hpack_huffman_encoder_boundaries() {
        let block = encode(&mut Encoder::new(), "x-a", "zzz", Indexing::Skip);
        assert_eq!(block[block.len() - 4..], hex("83f7efdf"));
        // Pairs of codes that have 32 bits together.
        for pair in [&b"\\\0"[..], b"\xc3\0", b"&\t", b" \xc0", b"\xd2 "] {
            check_huffman(&pair.repeat(4));
        }
        // Around the 12 + 2 bytes it read ahead.
        for len in 0..24 {
            check_huffman(&b"a".repeat(len));
        }
        // The length takes three bytes, of the code and of a string that is sent as it is.
        for value in [[b'A'; 435], [200; 435]] {
            let (mut encoder, mut block) = (Encoder::new(), Vec::new());
            let encoded = encoder.encode(&mut block, b"header", &value, Indexing::Add);
            assert!(encoded.is_ok());
            assert_eq!(decode(&mut Decoder::new(), &block).unwrap()[0].1, value);
        }
    }

    /// 04054d2 (index 0), 984fc14 (one byte of a literal and nothing else), test_hdec_table_size_updates.
    #[test]
    fn ls_hpack_decoder_errors() {
        // The last two would be "a: b" if what follows index 0 were read as a literal.
        let index_0 = ["80 026475 026465 00", "80 00 0161 0162", "80 0161 0162"];
        for block in index_0.into_iter().chain(["00", "10", "40"]) {
            let decoded = decode(&mut Decoder::new(), &hex(block));
            assert_eq!(decoded, Err(Error::Invalid), "{block}");
        }
        let mut decoder = Decoder::new();
        decoder.set_max_capacity(0x11);
        assert_eq!(decode(&mut decoder, &hex("3e 88")), Err(Error::Invalid));
        for block in ["3e 88", "20 34 88"] {
            let fields = decode(&mut Decoder::new(), &hex(block)).unwrap();
            assert_eq!(fields[0].1, b"200", "{block}");
        }
    }

    /// 9cabf89, undone by 13646d4: white space at the end of a name was cut off, also in the table.
    #[test]
    fn ls_hpack_names_are_opaque() {
        let name = b"cookie \t\x0b\x0c\r\n";
        let block = [&[0x40, 12][..], name, b"\x05value", &[0xbe]].concat();
        let mut decoder = Decoder::new();
        let fields = decode(&mut decoder, &block).unwrap();
        assert_eq!((&fields[0].0[..], &fields[1].0[..]), (&name[..], &name[..]));
        assert_eq!(decoder.table_size(), 12 + 5 + 32);
    }

    /// e10b99d: a field with an empty value never matched the static table.
    #[test]
    fn ls_hpack_static_entries_take_one_byte() {
        for index in 1..=static_table::LEN {
            let (name, value) = static_table::get(index).unwrap();
            let (mut encoder, mut block) = (Encoder::with_history(), Vec::new());
            let encoded = encoder.encode(&mut block, name, value, Indexing::Add);
            assert!(encoded.is_ok());
            assert_eq!(block, [0x80 | index as u8]);
        }
    }

    /// 1b7a5c3: an entry was added without making room, so the table grew until the next size update.
    #[test]
    fn ls_hpack_the_table_stays_within_its_capacity() {
        let (mut encoder, mut decoder) = (Encoder::new(), Decoder::new());
        encoder.set_max_capacity(100);
        for i in 0..9 {
            let value = "v".repeat(i * 7 % 30);
            let block = encode(&mut encoder, "x-a", &value, Indexing::Add);
            assert!(decode(&mut decoder, &block).is_ok());
            assert!(decoder.table_size() <= 100);
            assert_eq!(decoder.table_size(), encoder.table_size());
        }
    }

    /// 4b7c5cc: an entry with a name from the static table was on no chain of names, and took the first of one with it as it left.
    #[test]
    fn ls_hpack_an_entry_with_a_static_name_leaves() {
        // One of these names shares its bucket.
        for i in 0..16 {
            let (mut encoder, name) = (Encoder::new(), format!("x-{i}"));
            encode(&mut encoder, "content-length", "1", Indexing::Add);
            encode(&mut encoder, &name, "1", Indexing::Add);
            // Room for the second entry only, which then lends its name.
            encoder.set_max_capacity(40);
            let block = encode(&mut encoder, &name, "2", Indexing::Skip);
            assert_eq!(block[..4], hex("3f09 0f2f"), "{name}");
        }
    }

    /// 7a90325: changing the capacity switched the history on.
    #[test]
    fn ls_hpack_no_history_after_a_capacity_change() {
        let mut encoder = Encoder::new();
        encoder.set_max_capacity(1000);
        encode(&mut encoder, "x-a", "", Indexing::Add);
        // More than a history for that capacity holds, each for the first time.
        for i in 0..20 {
            let block = encode(&mut encoder, "x-a", &i.to_string(), Indexing::Add);
            assert_eq!(representation(&block), "added", "{i}");
        }
    }

    /// test_henc_boundary2: an index that takes two bytes.
    #[test]
    fn ls_hpack_an_index_of_two_bytes() {
        let (mut encoder, mut decoder) = (Encoder::new(), Decoder::new());
        let mut block = Vec::new();
        for value in (62..=127).chain([62]) {
            block.clear();
            let encoded = encoder.encode(&mut block, b"header", &[value], Indexing::Add);
            assert!(encoded.is_ok());
            assert_eq!(decode(&mut decoder, &block).unwrap()[0].1, [value]);
        }
        assert_eq!(block, hex("ff00"));
    }

    /// test_hpack_self_enc_dec_test_firefox_error: references into a nearly full table that the block evicts from.
    #[test]
    fn ls_hpack_firefox_error() {
        let entries = [
            ("content-length", "2145"),
            ("etag", "\"1e0c-54feefd5-7bfd383f\""),
            ("content-length", "31793"),
            ("etag", "\"3235d-54feefd5-9d7c08af\""),
            ("content-length", "407"),
            ("content-type", "text/css"),
            ("etag", "\"6bc-54feefd5-a7725cbd\""),
            ("content-length", "1884"),
            ("etag", "\"1b5a-54feefd5-b6a3dc2a\""),
            ("content-length", "2308"),
            ("etag", "\"1aee-54feefd5-1d91a5e4\""),
            ("content-length", "702"),
            ("etag", "\"5f8-54feefd5-197a93f1\""),
            ("content-length", "556"),
            ("etag", "\"52b-54feefd5-e6075901\""),
            ("content-length", "6913"),
            ("etag", "\"5767-54feefd5-4a868698\""),
            ("content-length", "6724"),
            ("etag", "\"64de-54feefd5-fb73534f\""),
            ("content-length", "2568"),
            ("etag", "\"2530-54feefd5-cccfff57\""),
            ("content-length", "973"),
            ("etag", "\"b00-54feefd5-e48546d\""),
            ("content-length", "709"),
            ("etag", "\"6a4-54feefd5-82d8609d\""),
            ("content-length", "6520"),
            ("etag", "\"5b0d-54feefd5-44735f27\""),
            ("content-length", "3954"),
            ("etag", "\"22ac-54feefd5-600b05fd\""),
            ("content-length", "32825"),
            ("etag", "\"16bb3-54feefd5-d669865d\""),
            ("content-length", "1055"),
            ("etag", "\"a37-54feefd5-59e4760e\""),
            ("date", "Tue, 10 Mar 2015 19:00:06 GMT"),
            ("content-length", "737"),
            ("etag", "\"63d-54feefd5-c244a03a\""),
            ("expires", "Tue, 17 Mar 2015 19:00:06 GMT"),
            ("content-length", "3205"),
            ("etag", "\"37cf-54feefd5-10e8e54\""),
            ("content-length", "6336"),
            ("etag", "\"58d9-54feefd5-f0d60c72\""),
            ("content-length", "2707"),
            ("etag", "\"285b-54feefd5-2e2834bf\""),
            ("content-length", "9050"),
            ("etag", "\"87ed-54feefd5-741b49ef\""),
            ("content-length", "7562"),
            ("etag", "\"795a-54feefd5-9e535995\""),
            ("content-length", "8780"),
            ("etag", "\"9759-54feefd5-6c09a64d\""),
            ("content-length", "1842"),
            ("etag", "\"1288-54feefd5-51ae6c5a\""),
            ("content-length", "9153"),
            ("etag", "\"a2af-54feefd5-83098d2b\""),
            ("content-length", "437"),
            ("etag", "\"2eb-54feefd5-26eef95\""),
            ("content-length", "37451"),
            ("content-type", "application/javascript"),
            ("etag", "\"27df1-54feefd5-fe76c415\""),
            ("expires", "Tue, 17 Mar 2015 19:00:05 GMT"),
            ("cache-control", "public, max-age=604800"),
            ("server", "LiteSpeed"),
            ("accept-ranges", "bytes"),
            ("date", "Tue, 10 Mar 2015 19:00:05 GMT"),
            ("vary", "Accept-Encoding"),
            ("content-encoding", "gzip"),
            ("content-length", "5298"),
            ("content-type", "text/html"),
            ("last-modified", "Tue, 10 Mar 2015 13:21:25 GMT"),
            ("etag", "\"748f-54feefd5-dca65763\""),
        ];
        let (mut encoder, mut decoder) = (Encoder::new(), Decoder::new());
        for (name, value) in entries.into_iter().rev() {
            let block = encode(&mut encoder, name, value, Indexing::Add);
            assert!(decode(&mut decoder, &block).is_ok());
        }
        let block = hex(concat!(
            "88f96496df697e940baa681d8a08016d40bf7000b80754c5a37f6292fe4221bab36d4a52cb236b0d",
            "e13e17052ff3ff045f87352398ac5754df5c8369d75b6196df697e940814d03b141002da817ee001",
            "700ea98b46ffff01ff00",
        ));
        let mut encoded = Vec::new();
        for (name, value, _) in decode(&mut decoder, &block).unwrap() {
            let result = encoder.encode(&mut encoded, &name, &value, Indexing::Add);
            assert!(result.is_ok());
        }
        assert_eq!(encoded, block);
    }

    // From here on: what has gone wrong in other HPACK implementations.

    /// HAProxy took an index of 2^31 or more for a negative one, which is under any limit (CVE-2018-14645).
    #[test]
    fn an_index_far_past_the_tables() {
        // An entry of either table once it is cut to 8, 16 or 31 bits.
        let cut_short = [8, 16, 31].map(|bits| [(1 << bits) + 2, (1 << bits) + 62]);
        let others = [63, 1 << 16, 1 << 31, u32::MAX];
        for index in others.into_iter().chain(cut_short.into_iter().flatten()) {
            for (flags, prefix_bits) in [(0x80, 7), (0x40, 6), (0x10, 4), (0x00, 4)] {
                // One entry, which an index that wraps around or is cut short would find.
                let mut block = hex("4003782d610131");
                integer::encode(&mut block, flags, prefix_bits, index);
                block.extend(hex(if flags == 0x80 { "" } else { "0161" }));
                let decoded = decode(&mut Decoder::new(), &block);
                assert_eq!(decoded, Err(Error::Invalid), "{index} {flags}");
            }
        }
    }

    /// Jetty multiplied the length of a Huffman string until it was negative, and then made room for it (CVE-2023-36478).
    #[test]
    fn a_string_far_longer_than_the_block() {
        // The last two are 1, which is what there is, once they are cut to 16 or 31 bits.
        let lens = [2, 1 << 16, 1 << 29, 1 << 30, 1 << 31, u32::MAX];
        for len in lens.into_iter().chain([(1 << 16) + 1, (1 << 31) + 1]) {
            for huffman in [0x00, 0x80] {
                for before in ["00", "000161", "41"] {
                    let (mut decoder, mut block) = (Decoder::new(), hex(before));
                    integer::encode(&mut block, huffman, 7, len);
                    block.push(0x1f);
                    assert_eq!(decode(&mut decoder, &block), Err(Error::Invalid));
                    assert!(decoder.heap_size() < 4096, "{len}");
                }
            }
        }
    }

    /// 124 entries of 33 bytes. Tables sized for larger entries have overflowed, and HAProxy's lost track at one of no bytes (CVE-2020-11100).
    #[test]
    fn the_smallest_entries_there_are() {
        let (mut encoder, mut decoder) = (Encoder::new(), Decoder::new());
        for name in 0..=255 {
            let mut block = Vec::new();
            let encoded = encoder.encode(&mut block, &[name], b"", Indexing::Add);
            assert!(encoded.is_ok());
            assert_eq!(decode(&mut decoder, &block).unwrap()[0].0, [name]);
            let size = 33 * (usize::from(name) + 1).min(124);
            assert_eq!((encoder.table_size(), decoder.table_size()), (size, size));
        }
        // The oldest that is left, and the one before it.
        assert_eq!(decode(&mut decoder, &hex("ff3a")).unwrap()[0].0, [132]);
        assert_eq!(decode(&mut decoder, &hex("ff3b")), Err(Error::Invalid));
        let mut block = Vec::new();
        for name in [132, 131] {
            let encoded = encoder.encode(&mut block, &[name], b"", Indexing::Skip);
            assert!(encoded.is_ok());
        }
        assert_eq!(block, hex("ff3a 00018300"));
        // There is no entry of 32 bytes: a name has at least one.
        let decoded = decode(&mut Decoder::new(), &hex("400000"));
        assert_eq!(decoded, Err(Error::Invalid));
    }

    /// One decoder called itself for each.
    #[test]
    #[cfg_attr(miri, ignore)]
    fn many_size_updates_in_a_row() {
        let (mut decoder, insert) = (Decoder::new(), hex("4003782d610131"));
        assert!(decode(&mut decoder, &insert).is_ok());
        let block = [hex("203fe11f").repeat(1 << 16), insert, hex("be")].concat();
        assert_eq!(decode(&mut decoder, &block).unwrap().len(), 2);
        // The entry from before them is gone.
        assert_eq!(decoder.table_size(), 36);
    }
}
