use bun_engine_text::Text;

pub(crate) struct Random(u64);

impl Random {
    pub(crate) fn new() -> Random {
        Random(1)
    }

    pub(crate) fn below(&mut self, bound: usize) -> usize {
        self.0 = (self.0.wrapping_mul(6364136223846793005)).wrapping_add(1442695040888963407);
        (self.0 >> 33) as usize % bound
    }

    pub(crate) fn pick<T: Copy>(&mut self, choices: &[T]) -> T {
        choices[self.below(choices.len())]
    }

    pub(crate) fn units(&mut self, length: usize, alphabet: &[u16]) -> Vec<u16> {
        (0..length).map(|_| self.pick(alphabet)).collect()
    }
}

pub(crate) fn wide(text: &str) -> Vec<u16> {
    text.encode_utf16().collect()
}

pub(crate) fn units_of(text: Text<'_>) -> Vec<u16> {
    text.code_units().collect()
}

/// All short lengths, and some around the steps of the kernels.
pub(crate) fn lengths() -> Vec<usize> {
    if cfg!(miri) {
        return vec![0, 1, 2, 3, 4, 7, 8, 15, 16, 17, 32, 33, 64, 65, 81, 130];
    }
    let around = |length: usize| length - 1..=length + 1;
    (0..=140)
        .chain([192, 256, 320, 512, 600, 1024].into_iter().flat_map(around))
        .collect()
}

/// All indices of a short text, and of a long one those near the ends and some between.
pub(crate) fn indices(length: usize) -> impl Iterator<Item = usize> {
    let margin = if cfg!(miri) { 2 } else { 70 };
    (0..length).filter(move |&at| at < margin || length - at <= margin || at % 29 == 0)
}

/// Calls `check` with the units in each width that holds them, at an address that depends on their number.
pub(crate) fn each_width(units: &[u16], mut check: impl FnMut(Text<'_>)) {
    let offset = units.len() * 7 % 32;
    let padded: Vec<u16> = std::iter::repeat_n(0, offset)
        .chain(units.iter().copied())
        .collect();
    check(Text::Utf16(&padded[offset..]));
    let narrow: Result<Vec<u8>, _> = padded.iter().map(|&unit| u8::try_from(unit)).collect();
    if let Ok(narrow) = narrow {
        check(Text::Latin1(&narrow[offset..]));
    }
}

pub(crate) fn each_pair(a: &[u16], b: &[u16], mut check: impl FnMut(Text<'_>, Text<'_>)) {
    each_width(a, |a| each_width(b, |b| check(a, b)));
}
