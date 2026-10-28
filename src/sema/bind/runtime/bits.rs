#[inline]
pub(super) fn has_bit(words: &[u64], index: usize) -> bool {
    words
        .get(index / 64)
        .is_some_and(|word| word >> (index % 64) & 1 != 0)
}

#[inline]
pub(super) fn insert_bit(words: &mut Vec<u64>, index: usize) -> bool {
    let word = index / 64;
    if words.len() <= word {
        words.resize(word + 1, 0);
    }
    let mask = 1u64 << (index % 64);
    let is_new = words[word] & mask == 0;
    words[word] |= mask;
    is_new
}

#[cfg(test)]
mod tests {
    use super::{has_bit, insert_bit};

    #[test]
    fn insert_crosses_word_boundary() {
        let mut words = Vec::new();
        assert!(insert_bit(&mut words, 63));
        assert!(insert_bit(&mut words, 64));
        assert_eq!(words.len(), 2);
        assert!(has_bit(&words, 63) && has_bit(&words, 64));
        assert!(!has_bit(&words, 62) && !has_bit(&words, 65));
    }

    #[test]
    fn insert_reports_repeated_index() {
        let mut words = Vec::new();
        assert!(insert_bit(&mut words, 7));
        assert!(!insert_bit(&mut words, 7));
    }

    #[test]
    fn index_past_end_is_absent() {
        let mut words = Vec::new();
        assert!(!has_bit(&words, 0));
        insert_bit(&mut words, 3);
        assert!(!has_bit(&words, 64));
        assert!(!has_bit(&words, u32::MAX as usize));
    }
}
