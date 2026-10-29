//! Bringing a subsampled component up to the size of the image (jdsample.c).

/// How the rows of a component become rows of the image.
#[derive(Clone, Copy, PartialEq, Eq)]
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
fn fancy(
    input: impl DoubleEndedIterator<Item = u16> + Clone,
    output: &mut [[u8; 2]],
    [bias_left, bias_right]: [u16; 2],
    shift: u32,
) {
    let sample = |near: u16, far: u16, bias: u16| ((near * 3 + far + bias) >> shift) as u8;
    let before = input.clone().take(1).chain(input.clone());
    let after = input.clone().skip(1).chain(input.clone().next_back());
    for (((pair, at), before), after) in output.iter_mut().zip(input).zip(before).zip(after) {
        *pair = [sample(at, before, bias_left), sample(at, after, bias_right)];
    }
}

/// `output` has room for twice the samples of `input`.
pub(crate) fn h2v1_fancy(input: &[u8], output: &mut [u8]) {
    let (output, _) = output.as_chunks_mut::<2>();
    if !bun_highway::jpeg::h2v1_fancy(input, output) {
        fancy(input.iter().copied().map(u16::from), output, [1, 2], 2);
    }
}

/// The two rows that `at` turns into. A half is rounded down for the upper one and up for the lower one.
pub(crate) fn h1v2_fancy(above: &[u8], at: &[u8], below: &[u8], [upper, lower]: [&mut [u8]; 2]) {
    for (far, bias, output) in [(above, 1, upper), (below, 2, lower)] {
        for ((out, &near), &far) in output.iter_mut().zip(at).zip(far) {
            *out = ((u16::from(near) * 3 + u16::from(far) + bias) >> 2) as u8;
        }
    }
}

/// One of the two rows that `near` turns into: the one on the side of `far`.
pub(crate) fn h2v2_fancy(near: &[u8], far: &[u8], output: &mut [u8]) {
    let (output, _) = output.as_chunks_mut::<2>();
    if !bun_highway::jpeg::h2v2_fancy(near, far, output) {
        let columns = near.iter().zip(far);
        let sums = columns.map(|(&near, &far)| u16::from(near) * 3 + u16::from(far));
        fancy(sums, output, [8, 7], 4);
    }
}

/// `output` has room for `h_expand` times the samples of `input`.
pub(crate) fn replicate(input: &[u8], h_expand: u32, output: &mut [u8]) {
    match h_expand {
        1 => {
            for (out, &v) in output.iter_mut().zip(input) {
                *out = v;
            }
        }
        2 => {
            let (pairs, _) = output.as_chunks_mut::<2>();
            for (pair, &v) in pairs.iter_mut().zip(input) {
                *pair = [v; 2];
            }
        }
        _ => {
            for (chunk, &v) in output.chunks_mut(h_expand as usize).zip(input) {
                chunk.fill(v);
            }
        }
    }
}
