//! What a macroblock is predicted from.

use bun_highway::webp::Edges;

/// The samples along the bottom of a macroblock from the left, or along its right from the bottom: Y, or U and then V.
/// `None` is outside of the picture.
pub(super) type Border = Option<[u8; 16]>;

pub(super) fn joined(parts: [u32; 4]) -> [u8; 16] {
    let [a, b, c, d] = parts.map(u128::from);
    (a | b << 32 | c << 64 | d << 96).to_le_bytes()
}

/// RFC 6386 section 12.2. `dc` gets the sums for the first and the second halves of the borders.
#[inline(always)]
fn edges(above: Border, left: Border, corner: [u8; 2], dc: impl Fn([u32; 2]) -> [u32; 2]) -> Edges {
    let sum = |half: &[u8]| half.iter().copied().map(u32::from).sum::<u32>();
    let [a, b] = [above.or(left), left.or(above)].map(|it| it.unwrap_or([128; 16]));
    let ((a0, a1), (b0, b1)) = (a.split_at(8), b.split_at(8));
    Edges {
        above: above.unwrap_or([127; 16]),
        left: left.unwrap_or([129; 16]),
        above_left: match (above, left) {
            (None, _) => [127; 2],
            (_, None) => [129; 2],
            _ => corner,
        },
        dc: dc([sum(a0) + sum(b0), sum(a1) + sum(b1)]).map(|it| it as u8),
    }
}

pub(super) fn luma_edges(above: Border, left: Border, above_left: Border) -> Edges {
    let [.., y] = above_left.unwrap_or_default();
    edges(above, left, [y; 2], |[a, b]| [(a + b + 16) >> 5; 2])
}

pub(super) fn chroma_edges(above: Border, left: Border, above_left: Border) -> Edges {
    let [.., u, _, _, _, _, _, _, _, v] = above_left.unwrap_or_default();
    edges(above, left, [u, v], |sums| sums.map(|it| (it + 8) >> 4))
}
