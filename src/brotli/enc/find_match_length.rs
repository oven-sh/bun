/// How many bytes `s1` and `s2` have in common at their start, up to `limit`.
#[inline(always)]
pub(crate) fn find_match_length_with_limit(s1: &[u8], s2: &[u8], limit: usize) -> usize {
    let limit = limit.min(s1.len()).min(s2.len());
    let (Some(s1), Some(s2)) = (s1.get(..limit), s2.get(..limit)) else {
        return 0;
    };
    let (chunks1, tail1) = s1.as_chunks::<8>();
    let (chunks2, tail2) = s2.as_chunks::<8>();
    let mut matched = 0;
    for (a, b) in chunks1.iter().zip(chunks2) {
        let x = u64::from_le_bytes(*a) ^ u64::from_le_bytes(*b);
        if x != 0 {
            return matched + (x.trailing_zeros() >> 3) as usize;
        }
        matched += 8;
    }
    matched + tail1.iter().zip(tail2).take_while(|(a, b)| a == b).count()
}
