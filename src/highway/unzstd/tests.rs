//! Miri runs them for this crate, which takes the portable code. They run as they are for `bun_zstd_decoder`.

use bun_highway::unzstd::{
    CHUNK, CODES_MAX, Codes, HuffmanTable, Reader, Sequence, Sequences, Tables, Tape,
    consume_stripes,
};

struct Noise(u64);

impl Noise {
    fn below(&mut self, limit: usize) -> usize {
        self.0 = self.0.wrapping_mul(0x5851_F42D_4C95_7F2D).wrapping_add(1);
        (self.0 >> 33) as usize % limit
    }

    fn bytes(&mut self, len: usize) -> Vec<u8> {
        (0..len).map(|_| self.below(256) as u8).collect()
    }
}

fn length_codes(new: fn(&[u32], &[u8]) -> Codes, plain: usize, first: &[u8], next: u8) -> Codes {
    let bits = [&vec![0; plain], first, &Vec::from_iter(next..=16)].concat();
    let base = |code| bits[..code].iter().map(|it| 1 << it).sum();
    new(&Vec::from_iter((0..bits.len()).map(base)), &bits)
}

/// Most rows of each kind have one of the `usual` codes, and some have one below `rare`.
fn tables(noise: &mut Noise, usual: [&[u8]; 3], rare: [usize; 3], adds_up: bool) -> Box<Tables> {
    let codes = [
        length_codes(Codes::literal_lengths, 16, &[1, 1, 1, 1, 2, 2, 3, 3, 4], 6),
        Codes::OFFSETS,
        length_codes(
            Codes::match_lengths,
            32,
            &[1, 1, 1, 1, 2, 2, 3, 3, 4, 4, 5],
            7,
        ),
    ];
    let mut tables = Tables::allocate().unwrap();
    for (kind, log_max) in [9, 8, 9].into_iter().enumerate() {
        let log = log_max - if cfg!(miri) { 3 } else { noise.below(4) as u32 };
        let (mut symbols, mut counts) = ([0; _], [0; CODES_MAX]);
        for symbol in &mut symbols[..1 << log] {
            *symbol = match noise.below(40) {
                0 => noise.below(rare[kind]) as u8,
                _ => usual[kind][noise.below(usual[kind].len())],
            };
            counts[usize::from(*symbol)] += 1;
        }
        if !adds_up {
            counts = counts.map(|_| noise.below(1 << 16) as i16);
        }
        match noise.below(10) {
            0 => tables.set_only(&codes[kind], symbols[0].into()),
            _ => tables.fill(&codes[kind], log, &counts, (&symbols, 1)),
        }
    }
    tables
}

/// Returns whether it is valid.
fn append(it: &Sequence, literals: &[u8], detached: &[u8], out: &mut Vec<u8>, end: usize) -> bool {
    let (literal_len, offset) = (it.literal_len as usize, it.offset as usize);
    let start = out.len() + literal_len;
    if literal_len > literals.len()
        || start + it.match_len as usize > end
        || !(1..=detached.len() + start).contains(&offset)
    {
        return false;
    }
    out.extend(&literals[..literal_len]);
    for position in start..start + it.match_len as usize {
        out.push(match position.checked_sub(offset) {
            Some(from) => out[from],
            None => detached[detached.len() + position - offset],
        });
    }
    true
}

/// Any bytes are a stream of sequences.
#[test]
fn groups_do_what_single_sequences_do() {
    let mut noise = Noise(1);
    let history_log = if cfg!(miri) { 11 } else { 21 };
    let history = vec![7; 1 << history_log];
    let history = [history, noise.bytes(1 << 11)].concat();
    let literal_lengths: [&[u8]; 3] = [&[0, 0, 1, 2], &[0, 3, 15, 16, 21], &[1, 22, 24, 25]];
    let far = [9, history_log - 1];
    let offsets: [&[u8]; 4] = [&[0, 1, 1, 1, 7], &[2, 3, 4, 5], &[0, 1, 6, 8, 10], &far];
    let match_lengths: [&[u8]; 3] = [&[0, 1, 5, 13], &[2, 29, 30, 38, 39], &[0, 40, 43]];
    let (mut all, mut left_over, mut complete) = (0, 0, 0);
    let rounds = if cfg!(miri) { 8 } else { 1500 };
    let all_literals = noise.bytes(999).repeat(99);
    for round in 0..rounds {
        let usual = [
            literal_lengths[round % 3],
            offsets[round / 3 % 4],
            match_lengths[round / 5 % 3],
        ];
        let rare = match noise.below(4) {
            0 => [36, 32, 53],
            1 if !cfg!(miri) => [32, 20, 49],
            _ => [26, 11, 44],
        };
        let adds_up = noise.below(8) != 0;
        let tables = tables(&mut noise, usual, rare, adds_up);
        let count = 1 + noise.below(if cfg!(miri) { 60 } else { 300 });
        let (src_len, literals_len) = (1 + noise.below(6 * count), noise.below(200 * count));
        let (src, padded) = (noise.bytes(src_len), &all_literals[..literals_len + CHUNK]);
        let (end_of_src, repeats) = (8 * src_len - 1 - noise.below(8), [100, 1, 40]);
        let reader = || Reader::new([&tables; 3], (&src, end_of_src), count, repeats);
        let (detached, attached) = history.split_at(history.len() - noise.below(1 << 11));

        let (mut expected, mut singles, mut taken) = (attached.to_vec(), reader(), 0);
        let end = attached.len() + noise.below(400 * count);
        let is_valid = singles.by_ref().all(|it| {
            let literals = &padded[taken..literals_len];
            taken += it.literal_len as usize;
            append(&it, literals, detached, &mut expected, end)
        });

        let mut out = Vec::with_capacity(match noise.below(3) {
            0 => attached.len(),
            _ => expected.len() + noise.below(3 * CHUNK),
        });
        out.extend(attached);
        let mut groups = Sequences::new(reader(), out.len());
        let got_through = loop {
            let skipped = groups.positions().0 * noise.below(2);
            let rest = padded[skipped..].to_vec();
            groups.run((&rest, skipped), detached, Tape::vec(&mut out, 0), end);
            let (taken, position) = groups.positions();
            assert_eq!(position, out.len());
            let Some(it) = groups.take() else { break true };
            left_over += 1;
            let fits = position + (it.literal_len + it.match_len) as usize <= end;
            if !(fits && Tape::vec(&mut out, 0).write(position, &it, &padded[taken..], detached)
                || append(&it, &padded[taken..literals_len], detached, &mut out, end))
            {
                break false;
            }
        };
        assert!(got_through == is_valid && out == expected);
        if is_valid {
            let groups = groups.into_reader();
            assert_eq!(groups.bits_left(), singles.bits_left());
            assert_eq!(groups.repeats(), singles.repeats());
            (all, complete) = (all + count, complete + 1);
        }
    }
    assert!(complete > rounds / 4 && (cfg!(miri) || left_over < all / 10));
}

#[test]
fn what_is_not_initialized_is_no_history() {
    let tables = tables(&mut Noise(2), [&[1], &[2], &[0]], [1; 3], true);
    let mut groups = Sequences::new(Reader::new([&tables; 3], (&[1; 99], 700), 20, [1; 3]), 9);
    let mut out = Vec::with_capacity(1000);
    groups.run((&[0; 99], 0), &[], Tape::vec(&mut out, 0), 1000);
    let first = groups.take().unwrap();
    assert!(!Tape::vec(&mut out, 0).write(9, &first, &[0; 99], &[]) && out.is_empty());
}

#[test]
fn arguments_out_of_range_do_no_harm() {
    let tables = tables(&mut Noise(2), [&[1], &[2], &[0]], [1; 3], true);
    for src in [(&[][..], 0), (&[1; 99], 1 << 63), (&[1; 99], usize::MAX)] {
        let mut groups = Sequences::new(Reader::new([&tables; 3], src, 64, [1; 3]), 9);
        groups.run((&[0; 99], 0), &[], Tape::slice(&mut [0; 999]), 0);
        assert_eq!(groups.positions(), (0, 9));
        groups.run((&[0; 99], 0), &[], Tape::slice(&mut [0; 999]), 999);
        assert_eq!(groups.positions().1, 9 + 64 * 3 + groups.positions().0);
    }
    let table = huffman_table(&[1, 1]).0;
    for (bits, len) in [([[0], [8]], usize::MAX), ([[usize::MAX], [8]], 9)] {
        assert!(!table.decode_streams(&[0; 16], bits, (Tape::slice(&mut [0; 16]), 1), len, 0));
    }
}

/// For symbols that have these `lengths`, from the longest on. Returns their codes too.
fn huffman_table(lengths: &[u32]) -> (Box<HuffmanTable>, Vec<u32>) {
    let (log, mut row) = (lengths[0], 0);
    let (mut starts, mut counts, mut weights, mut codes) = ([0; 16], [0; 16], [0; 256], Vec::new());
    for (symbol, length) in lengths.iter().enumerate() {
        let weight = (log + 1 - length) as usize;
        starts[weight] = symbol as u16 - counts[weight] as u16;
        counts[weight] += 1;
        weights[symbol] = weight as u8;
        codes.push(row >> (weight - 1));
        row += 1 << (weight - 1);
    }
    let (mut table, symbols) = (
        HuffmanTable::allocate().unwrap(),
        std::array::from_fn(|it| it as u8),
    );
    assert!(!table.fill(log, (&symbols, &starts, &[3; 16]), &weights));
    assert!(table.fill(log, (&symbols, &starts, &counts), &weights));
    (table, codes)
}

fn check_streams<const N: usize>(lengths: &[u32], symbols: &[u8], in_front: usize) {
    let (mut table, codes) = huffman_table(lengths);
    if symbols[0] % 2 == 0 {
        table.add_pairs(usize::MAX, 0);
    }
    let (mut src, mut bounds) = (vec![0xFF; in_front], [[0; N]; 2]);
    for (stream, share) in symbols.chunks(symbols.len().div_ceil(N)).enumerate() {
        let mut position = 8 * src.len();
        bounds[0][stream] = position;
        for symbol in share.iter().rev().map(|&it| usize::from(it)) {
            src.resize(position / 8 + 4, 0);
            let word = src.last_chunk_mut().unwrap();
            *word = (u32::from_le_bytes(*word) | codes[symbol] << (position % 8)).to_le_bytes();
            position += lengths[symbol] as usize;
        }
        bounds[1][stream] = position;
        src.truncate(position.div_ceil(8));
    }
    src.shrink_to_fit();
    let off = usize::from(symbols.len() < 1000 || !cfg!(miri));
    for len in symbols.len() - off..=symbols.len() + off {
        let mut out = Vec::with_capacity(len);
        let is_valid = table.decode_streams(&src, bounds, (Tape::vec(&mut out, 0), 0), len, 0);
        assert_eq!(is_valid, len == symbols.len());
        assert!(out == if is_valid { symbols } else { &[] });
    }
}

#[test]
fn lanes_meet_or_give_up() {
    let mut noise = Noise(3);
    let skewed = |log| Vec::from_iter([log].into_iter().chain((1..=log).rev()));
    let mixed = [[7; 64].as_slice(), &[5; 8], &[3; 2]].concat();
    for lengths in [
        mixed,
        skewed(4),
        skewed(12),
        skewed(1),
        skewed(11),
        vec![6; 64],
        vec![8; 256],
    ]
    .into_iter()
    .take(if cfg!(miri) { 3 } else { 7 })
    {
        let more: &[_] = if cfg!(miri) {
            &[]
        } else {
            &[14, 96, 1001, 1197, 8001, 50_000]
        };
        for &len in [100, 1200].iter().chain(more) {
            // Guesses are far off if the lengths change along the way.
            for run in [len / 7, 1, 40].into_iter().take(more.len() + 1) {
                let runs = (0..).flat_map(|_| vec![noise.below(lengths.len()) as u8; run]);
                let symbols = Vec::from_iter(runs.take(len));
                check_streams::<4>(&lengths, &symbols, 8);
                if len < 1024 {
                    check_streams::<1>(&lengths, &symbols, 8);
                    check_streams::<1>(&lengths, &symbols, 0);
                }
            }
        }
    }
}

#[test]
fn stripes_are_consumed_or_returned() {
    let (bytes, factors) = (
        Noise(4).bytes(41 * 32),
        [0xC2B2_AE3D_27D4_EB4F, 0x9E37_79B1_85EB_CA87],
    );
    let consume = |mut lanes: [u64; 4], stripes: &[[u8; 32]]| {
        for (index, word) in stripes.as_flattened().as_chunks().0.iter().enumerate() {
            let product = u64::from_le_bytes(*word).wrapping_mul(factors[0]);
            let sum = lanes[index % 4].wrapping_add(product);
            lanes[index % 4] = sum.rotate_left(31).wrapping_mul(factors[1]);
        }
        lanes
    };
    for len in 0..40 {
        let (mut lanes, stripes) = ([1, 2, 3, 4], &bytes[len % 32..].as_chunks().0[..len]);
        let rest = consume_stripes(&mut lanes, factors, stripes);
        assert_eq!(consume(lanes, rest), consume([1, 2, 3, 4], stripes));
    }
}
