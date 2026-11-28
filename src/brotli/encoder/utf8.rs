/// Whether more than three quarters of a sample are text in UTF-8.
#[inline(never)]
pub(super) fn is_mostly_utf8(parts: [&[u8]; 2]) -> bool {
    const BATCH: usize = 48;
    let (mut valid, mut seen) = (0, 0);
    let step = BATCH.max((parts[0].len() + parts[1].len()) / 128);
    for part in parts {
        for start in (0..part.len()).step_by(step) {
            let (mut padded, rest) = ([0; BATCH + 3], &part[start..]);
            let batch = rest.first_chunk().unwrap_or_else(|| {
                padded[..rest.len()].copy_from_slice(rest);
                &padded
            });
            // They do not overlap, because none starts with a continuation byte.
            valid += usize::from((0..BATCH).fold(0, |sum, i| {
                sum + sequence_length(batch[i], batch[i + 1], batch[i + 2], batch[i + 3])
            }));
            seen += BATCH.min(rest.len());
        }
    }
    valid * 4 > seen * 3
}

/// Zero for control characters, and for what is not UTF-8. Surrogates count.
#[inline(always)]
fn sequence_length(lead: u8, b: u8, c: u8, d: u8) -> u8 {
    let continues = |byte: u8| (byte as i8) < -0x40;
    let (two, three, four) = (continues(b), continues(c), continues(d));
    let out_of_range =
        (lead == 0xE0) & (b < 0xA0) | (lead == 0xF0) & (b < 0x90) | (lead == 0xF4) & (b >= 0x90);
    let two = two & !out_of_range;
    u8::from(matches!(lead, 9..=13 | 0x20..=0x7F))
        + 2 * u8::from(matches!(lead, 0xC2..=0xDF) & two)
        + 3 * u8::from(matches!(lead, 0xE0..=0xEF) & two & three)
        + 4 * u8::from(matches!(lead, 0xF0..=0xF4) & two & three & four)
}

#[cfg(test)]
mod tests {
    use super::is_mostly_utf8;

    #[test]
    fn tells_text_from_the_rest() {
        for length in [1, 15, 16, 17, 5000] {
            let text = "a\u{e9}\u{65e5}\u{1f600}\n".repeat(length);
            let (first, second) = text.as_bytes().split_at(length);
            assert!(is_mostly_utf8([text.as_bytes(), &[]]));
            assert!(is_mostly_utf8([first, second]));
            assert!(!is_mostly_utf8([&b"ab\x01".repeat(length), &[]]));
            assert!(!is_mostly_utf8([&[], &b"\xe0\x80\x80".repeat(length)]));
        }
    }
}
