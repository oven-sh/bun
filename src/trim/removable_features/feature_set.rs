use crate::Feature;

const WORD_BITS: usize = u64::BITS as usize;
const WORD_COUNT: usize = Feature::INDEX_LIMIT / WORD_BITS;

const fn word_position(feature: Feature) -> usize {
    feature.index() as usize / WORD_BITS
}

const fn word_mask(feature: Feature) -> u64 {
    1 << (feature.index() as usize % WORD_BITS)
}

#[derive(Copy, Clone, PartialEq, Eq, Default, Debug)]
pub struct FeatureSet([u64; WORD_COUNT]);

impl FeatureSet {
    pub const EMPTY: FeatureSet = FeatureSet([0; WORD_COUNT]);

    pub const fn from_features(features: &[Feature]) -> FeatureSet {
        let mut words = [0; WORD_COUNT];
        let mut position = 0;
        while position < features.len() {
            words[word_position(features[position])] |= word_mask(features[position]);
            position += 1;
        }
        FeatureSet(words)
    }

    pub fn all() -> FeatureSet {
        FeatureSet::from_features(Feature::ALL)
    }

    pub fn insert(&mut self, feature: Feature) {
        self.0[word_position(feature)] |= word_mask(feature);
    }

    pub fn remove(&mut self, feature: Feature) {
        self.0[word_position(feature)] &= !word_mask(feature);
    }

    pub fn contains(&self, feature: Feature) -> bool {
        self.0[word_position(feature)] & word_mask(feature) != 0
    }

    pub fn union_with(&mut self, other: &FeatureSet) {
        for (word, other_word) in self.0.iter_mut().zip(other.0) {
            *word |= other_word;
        }
    }

    pub fn subtract(&mut self, other: &FeatureSet) {
        for (word, other_word) in self.0.iter_mut().zip(other.0) {
            *word &= !other_word;
        }
    }

    pub fn intersect_with(&mut self, other: &FeatureSet) {
        for (word, other_word) in self.0.iter_mut().zip(other.0) {
            *word &= other_word;
        }
    }

    pub fn intersects(&self, other: &FeatureSet) -> bool {
        self.0
            .iter()
            .zip(other.0)
            .any(|(word, other_word)| word & other_word != 0)
    }

    pub fn is_subset_of(&self, other: &FeatureSet) -> bool {
        self.0
            .iter()
            .zip(other.0)
            .all(|(word, other_word)| word & !other_word == 0)
    }

    pub fn is_empty(&self) -> bool {
        *self == FeatureSet::EMPTY
    }

    pub fn len(&self) -> usize {
        self.0.iter().map(|word| word.count_ones() as usize).sum()
    }

    pub fn iter(&self) -> impl Iterator<Item = Feature> + '_ {
        Feature::ALL
            .iter()
            .copied()
            .filter(move |feature| self.contains(*feature))
    }
}

impl FromIterator<Feature> for FeatureSet {
    fn from_iter<I: IntoIterator<Item = Feature>>(features: I) -> FeatureSet {
        let mut set = FeatureSet::EMPTY;
        for feature in features {
            set.insert(feature);
        }
        set
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn word_boundary_features() -> Vec<Feature> {
        let highest = Feature::ALL[Feature::ALL.len() - 1];
        Feature::ALL
            .iter()
            .copied()
            .filter(|feature| matches!(feature.index() as usize % WORD_BITS, 0 | 63))
            .chain([highest])
            .collect()
    }

    fn every_nth_feature(step: usize) -> Vec<Feature> {
        Feature::ALL.iter().copied().step_by(step).collect()
    }

    #[test]
    fn insert_remove_contains_at_word_boundaries() {
        let boundaries = word_boundary_features();
        assert!(boundaries.contains(&Feature::Jit));
        assert!(boundaries.contains(&Feature::Tools));
        for feature in boundaries {
            let mut set = FeatureSet::EMPTY;
            assert!(!set.contains(feature));
            set.insert(feature);
            set.insert(feature);
            assert!(set.contains(feature));
            assert_eq!(set.len(), 1);
            set.remove(feature);
            set.remove(feature);
            assert!(!set.contains(feature));
            assert!(set.is_empty());
        }
    }

    #[test]
    fn iter_is_ascending_and_equals_inserted() {
        let mut expected = word_boundary_features();
        expected.sort_unstable();
        expected.dedup();
        let set: FeatureSet = expected.iter().rev().copied().collect();
        assert_eq!(set.iter().collect::<Vec<_>>(), expected);
        assert_eq!(set, FeatureSet::from_features(&expected));
    }

    #[test]
    fn all_holds_every_declared_feature() {
        assert_eq!(FeatureSet::all().len(), Feature::ALL.len());
        assert_eq!(FeatureSet::all().iter().collect::<Vec<_>>(), Feature::ALL);
    }

    #[test]
    fn set_operations_match_model() {
        let left = every_nth_feature(2);
        let right = every_nth_feature(3);
        let left_set = FeatureSet::from_features(&left);
        let right_set = FeatureSet::from_features(&right);

        let mut union = left_set;
        union.union_with(&right_set);
        let mut difference = left_set;
        difference.subtract(&right_set);
        let mut intersection = left_set;
        intersection.intersect_with(&right_set);

        for &feature in Feature::ALL {
            let in_left = left.contains(&feature);
            let in_right = right.contains(&feature);
            assert_eq!(union.contains(feature), in_left || in_right);
            assert_eq!(difference.contains(feature), in_left && !in_right);
            assert_eq!(intersection.contains(feature), in_left && in_right);
        }
        assert!(left_set.intersects(&right_set));
        assert!(intersection.is_subset_of(&left_set));
        assert!(!left_set.is_subset_of(&right_set));
    }

    #[test]
    fn subset_of_bounds() {
        let set = FeatureSet::from_features(&every_nth_feature(2));
        assert!(FeatureSet::EMPTY.is_subset_of(&set));
        assert!(set.is_subset_of(&FeatureSet::all()));
        assert!(!FeatureSet::all().is_subset_of(&FeatureSet::EMPTY));
    }

    #[test]
    fn empty_intersects_nothing() {
        assert!(!FeatureSet::EMPTY.intersects(&FeatureSet::all()));
    }

    #[test]
    fn subtract_disjoint_set_changes_nothing() {
        let (engine, embedder): (Vec<Feature>, Vec<Feature>) =
            Feature::ALL.iter().partition(|feature| feature.is_engine());
        let engine = FeatureSet::from_features(&engine);
        let embedder = FeatureSet::from_features(&embedder);
        let mut result = engine;
        result.subtract(&embedder);
        assert_eq!(result, engine);
    }
}
