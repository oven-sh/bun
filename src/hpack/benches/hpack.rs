//! One field through `Encoder::encode` and `Decoder::next`, by the kind and length of its value. Run `scripts/bench-hpack-rust.sh`.
use bun_hpack::{Decoder, Encoder, Indexing};
use criterion::{
    BenchmarkGroup, Criterion, criterion_group, criterion_main, measurement::WallTime,
};
use std::hint::black_box;
use std::time::Duration;

/// In the static table, so that the time goes into the value.
const NAME: &[u8] = b"user-agent";
const LENGTHS: [usize; 7] = [1, 8, 32, 64, 127, 128, 1000];
/// So many of the longest values fit the dynamic table.
const IN_TABLE: usize = 3;

/// What the values of each kind are made of, at random. A byte that is there twice is twice as likely.
const KINDS: [(&str, &[u8]); 8] = [
    // Every byte with a code of up to 8 bits.
    (
        "text",
        b" %&*,-./0123456789:;=ABCDEFGHIJKLMNOPQRSTUVWXYZ_abcdefghijklmnopqrstuvwxyz",
    ),
    (
        "url",
        b"abcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyz0123456789////--__..==&&%?",
    ),
    ("digits", b"0123456789"),
    (
        "base64",
        b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/",
    ),
    ("upper", b"ABCDEFGHIJKLMNOPQRSTUVWXYZ"),
    ("json", b"\"\"\"\"::,,{}[]0123456789aeiotnrslu"),
    (
        "printable",
        b" !\"#$%&'()*+,-./0123456789:;<=>?@ABCDEFGHIJKLMNOPQRSTUVWXYZ[\\]^_`abcdefghijklmnopqrstuvwxyz{|}~",
    ),
    // Their codes are longer than they are, so they are sent as they are.
    ("raw", b"\x01\x02\x7f\x80\x90\xa0\xb0\xc0\xd0\xe0\xf0\xff"),
];

/// So many that the branch predictor cannot learn them: it does learn 512. At most 4 MB.
fn values(alphabet: &[u8], len: usize) -> Vec<Vec<u8>> {
    let mut state = 0x9e37_79b9_7f4a_7c15_u64;
    let mut byte = || {
        state ^= state << 13;
        state ^= state >> 7;
        state ^= state << 17;
        alphabet[(state % alphabet.len() as u64) as usize]
    };
    let count = 16384.min((4 << 20) / len);
    (0..count)
        .map(|_| (0..len).map(|_| byte()).collect())
        .collect()
}

/// One call of `f` per iteration, with one item after the other.
fn bench<T>(group: &mut BenchmarkGroup<WallTime>, id: String, items: &[T], mut f: impl FnMut(&T)) {
    let mut cycle = items.iter().cycle();
    group.bench_function(id, |b| b.iter(|| cycle.next().map(&mut f)));
}

fn encode(group: &mut BenchmarkGroup<WallTime>, id: String, values: &[Vec<u8>], how: Indexing) {
    let (mut encoder, mut out) = (Encoder::new(), Vec::new());
    bench(group, id, values, |value| {
        out.clear();
        encoder.encode(&mut out, NAME, value, how).unwrap();
        black_box(&out);
    });
}

fn decode(group: &mut BenchmarkGroup<WallTime>, id: String, values: &[Vec<u8>], how: Indexing) {
    let (mut encoder, mut decoder) = (Encoder::new(), Decoder::new());
    let mut blocks = |values: &[Vec<u8>]| -> Vec<Vec<u8>> {
        let block = |value: &Vec<u8>| {
            let mut block = Vec::new();
            encoder.encode(&mut block, NAME, value, how).unwrap();
            block
        };
        values.iter().map(block).collect()
    };
    let mut next = |block: &Vec<u8>| {
        let field = decoder.next(block, &mut 0).unwrap().unwrap();
        black_box(field.value.len());
    };
    // Few enough to stay in the table are sent again, as references.
    if values.len() <= IN_TABLE {
        blocks(values).iter().for_each(&mut next);
    }
    bench(group, id, &blocks(values), next);
}

fn bench_hpack(c: &mut Criterion) {
    let mut group = c.benchmark_group("hpack");
    group
        .warm_up_time(Duration::from_millis(300))
        .measurement_time(Duration::from_secs(1));
    for (kind, alphabet) in KINDS {
        for len in LENGTHS {
            let values = values(alphabet, len);
            let id = |what| format!("{what}/{kind}/{len}");
            // Values of 1 byte come again while they are in the table, so most of those are references.
            encode(&mut group, id("encode/add"), &values, Indexing::Add);
            decode(&mut group, id("decode/skip"), &values, Indexing::Skip);
            if kind != "text" {
                continue;
            }
            encode(&mut group, id("encode/skip"), &values, Indexing::Skip);
            decode(&mut group, id("decode/add"), &values, Indexing::Add);
            let values = &values[..IN_TABLE];
            encode(&mut group, id("encode/indexed"), values, Indexing::Add);
            decode(&mut group, id("decode/indexed"), values, Indexing::Add);
        }
    }
    group.finish();
}

criterion_group! {
    name = benches;
    config = Criterion::default().without_plots();
    targets = bench_hpack
}
criterion_main!(benches);
