//! Bringing a subsampled component up to the size of the image (jdsample.c).

/// How the rows of a component become rows of the image.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub(crate) enum Method {
    /// The component has the size of the image already.
    FullSize,
    /// Twice as wide, by linear interpolation.
    H2V1Fancy,
    /// Twice as high, by linear interpolation.
    H1V2Fancy,
    /// Twice as wide and as high, by linear interpolation.
    H2V2Fancy,
    /// Every sample repeated.
    Replicate { h_expand: u32, v_expand: u32 },
}

impl Method {
    /// Whether a row of the result depends on the rows above and below the one it comes from.
    pub(crate) fn needs_context(self) -> bool {
        matches!(self, Method::H1V2Fancy | Method::H2V2Fancy)
    }
}

/// The output samples are 1/4 and 3/4 of the way between the centers of the input samples, so each is 3/4 of the nearer
/// and 1/4 of the further one. A half is rounded down for the left one and up for the right one. Past either end the
/// edge sample repeats, which leaves the outermost samples as they are.
///
/// The result is `(3 * near + far + bias) >> shift`.
#[inline(always)]
fn widen<T: Copy + Into<u32>>(input: &[T], output: &mut [u8], bias: [u32; 2], shift: u32) {
    let (pairs, _) = output.as_chunks_mut::<2>();
    let [bias_left, bias_right] = bias;
    let sample =
        |near: T, far: T, bias: u32| ((near.into() * 3 + far.into() + bias) >> shift) as u8;

    let (Some(&first), Some(&last)) = (input.first(), input.last()) else {
        return;
    };
    let before = input;
    let at = input.get(1..).unwrap_or(&[]);
    let after = input.get(2..).unwrap_or(&[]);
    let inner = pairs.get_mut(1..).unwrap_or(&mut []);
    for (((pair, &before), &at), &after) in inner.iter_mut().zip(before).zip(at).zip(after) {
        *pair = [sample(at, before, bias_left), sample(at, after, bias_right)];
    }

    let second = at.first().copied().unwrap_or(first);
    if let Some(pair) = pairs.first_mut() {
        *pair = [
            sample(first, first, bias_left),
            sample(first, second, bias_right),
        ];
    }
    if let Some(i) = input.len().checked_sub(2)
        && let (Some(&before), Some(pair)) = (input.get(i), pairs.get_mut(i + 1))
    {
        *pair = [
            sample(last, before, bias_left),
            sample(last, last, bias_right),
        ];
    }
}

/// `output` has room for twice the samples of `input`.
pub(crate) fn h2v1_fancy(input: &[u8], output: &mut [u8]) {
    widen(input, output, [1, 2], 2);
}

/// One of the two rows that `near` turns into: the one on the side of `far`. `upper` says which side that is.
pub(crate) fn h1v2_fancy(near: &[u8], far: &[u8], upper: bool, output: &mut [u8]) {
    let bias = if upper { 1 } else { 2 };
    for ((out, &near), &far) in output.iter_mut().zip(near).zip(far) {
        *out = ((u32::from(near) * 3 + u32::from(far) + bias) >> 2) as u8;
    }
}

/// One of the two rows that `near` turns into: the one on the side of `far`. `column_sums` is scratch space.
pub(crate) fn h2v2_fancy(near: &[u8], far: &[u8], column_sums: &mut Vec<u16>, output: &mut [u8]) {
    column_sums.clear();
    column_sums.extend(
        near.iter()
            .zip(far)
            .map(|(&near, &far)| u16::from(near) * 3 + u16::from(far)),
    );
    widen(column_sums, output, [8, 7], 4);
}

/// Fills `output`.
pub(crate) fn replicate(input: &[u8], h_expand: u32, output: &mut [u8]) {
    match h_expand {
        1 => {
            for (out, &v) in output.iter_mut().zip(input) {
                *out = v;
            }
        }
        2 => {
            let (pairs, rest) = output.as_chunks_mut::<2>();
            for (pair, &v) in pairs.iter_mut().zip(input) {
                *pair = [v; 2];
            }
            if let (Some(out), Some(&v)) = (rest.first_mut(), input.get(pairs.len())) {
                *out = v;
            }
        }
        _ => {
            for (chunk, &v) in output.chunks_mut(h_expand as usize).zip(input) {
                chunk.fill(v);
            }
        }
    }
}
