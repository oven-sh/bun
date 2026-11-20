use bun_zstd_decoder::{Output, Result, Status, XxHash64};
use bun_zstd_encoder::EndDirective::{self, Continue, End, Flush};
use bun_zstd_encoder::{DEFAULT_LEVEL, Encoder};

pub(crate) const WINDOW_LOG: u32 = 101;
pub(crate) const LONG_DISTANCE: u32 = 160;
pub(crate) const CHECKSUM: u32 = 201;
pub(crate) const WORKERS: u32 = 400;
pub(crate) const JOB_LEN: u32 = 401;

/// Trained by zstd.
pub(crate) const DICTIONARY: &[u8] = include_bytes!("../../../decoder/tests/fixtures/dictionary");

/// Runs of letters, and copies of what came before. Every 16 KB the letters change.
pub(crate) fn sample(len: usize) -> Vec<u8> {
    let mut state = 1u32;
    let mut below = |limit: usize| {
        state ^= state << 13;
        state ^= state >> 17;
        state ^= state << 5;
        state as usize % limit
    };
    let mut bytes = vec![b' '];
    while bytes.len() < len {
        let first = b'0' + (bytes.len() >> 14) as u8 % 4 * 16;
        for _ in 0..below(12) {
            let spread = 1 + below(16);
            bytes.push(first + below(spread) as u8);
        }
        let from = below(bytes.len());
        bytes.extend_from_within(from..bytes.len().min(from + 3 + below(20)));
    }
    bytes.truncate(len);
    bytes
}

pub(crate) fn summary(bytes: &[u8]) -> (usize, u32) {
    (bytes.len(), XxHash64::hash(bytes) as u32)
}

pub(crate) fn encoder(parameters: &[(u32, i32)], dictionary: &[u8]) -> Result<Encoder> {
    let mut encoder = Encoder::new(DEFAULT_LEVEL);
    encoder.load_dictionary(dictionary)?;
    for &(key, value) in parameters {
        encoder.set_parameter(key, value)?;
    }
    Ok(encoder)
}

/// How much it took and wrote.
pub(crate) fn step(
    encoder: &mut Encoder,
    input: &[u8],
    room: usize,
    directive: EndDirective,
) -> (usize, usize, Result<Status>) {
    let mut room = vec![0; room];
    let mut out = Output::slice(&mut room);
    let (consumed, status) = encoder.step(input, &mut out, directive);
    (consumed, out.written(), status)
}

/// `out` has room for all.
pub(crate) fn write(
    encoder: &mut Encoder,
    mut input: &[u8],
    directive: EndDirective,
    output_step: usize,
    out: &mut Vec<u8>,
) -> Result<()> {
    loop {
        let mut out = Output::spare_capacity(out, output_step);
        let (consumed, status) = encoder.step(input, &mut out, directive);
        input = &input[consumed..];
        if (status? == Status::Complete || directive == Continue) && input.is_empty() {
            return Ok(());
        }
    }
}

/// One of unknown length, a short one, and a long one.
pub(crate) fn three_frames(encoder: &mut Encoder, input: &[u8], out: &mut Vec<u8>) -> Result<()> {
    out.clear();
    write(encoder, &input[..input.len() / 2], Flush, 1000, out)?;
    write(encoder, &input[input.len() / 2..], Continue, 1000, out)?;
    write(encoder, &[], End, 1000, out)?;
    write(encoder, &input[..500], End, usize::MAX, out)?;
    write(encoder, input, End, 1000, out)
}
