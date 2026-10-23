use bun_removable_features::Feature;

use crate::model::{EdgeStrength, FeatureEdge, FeatureEdges};

impl FeatureEdges {
    pub fn new(mut edges: Vec<FeatureEdge>) -> FeatureEdges {
        edges.retain(|edge| edge.from != edge.to);
        edges.sort_unstable_by_key(|edge| (edge.from, edge.to));
        edges.dedup_by(|duplicate, merged| {
            let is_same_pair = (duplicate.from, duplicate.to) == (merged.from, merged.to);
            if is_same_pair {
                merged.strength = merged.strength.min(duplicate.strength);
                merged.is_followed |= duplicate.is_followed;
            }
            is_same_pair
        });
        for edge in &mut edges {
            edge.is_followed |= edge.strength == EdgeStrength::Reference;
        }
        FeatureEdges { edges }
    }

    pub fn as_slice(&self) -> &[FeatureEdge] {
        &self.edges
    }

    pub fn leaving(&self, feature: Feature) -> &[FeatureEdge] {
        let start = self.edges.partition_point(|edge| edge.from < feature);
        let end = self.edges.partition_point(|edge| edge.from <= feature);
        &self.edges[start..end]
    }

    pub fn entering(&self, feature: Feature) -> impl Iterator<Item = &FeatureEdge> {
        self.edges.iter().filter(move |edge| edge.to == feature)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::model::EdgeStrength::{AbortingGuard, RecoverableGuard, Reference};

    fn feature(position: usize) -> Feature {
        Feature::ALL[position]
    }

    fn edge(from: usize, to: usize, strength: EdgeStrength, is_followed: bool) -> FeatureEdge {
        FeatureEdge {
            from: feature(from),
            to: feature(to),
            strength,
            is_followed,
        }
    }

    fn sample_edges() -> FeatureEdges {
        FeatureEdges::new(vec![
            edge(1, 0, Reference, true),
            edge(1, 2, AbortingGuard, true),
            edge(3, 0, RecoverableGuard, false),
            edge(5, 1, Reference, true),
            edge(5, 3, RecoverableGuard, true),
        ])
    }

    #[test]
    fn edges_are_sorted() {
        let edges = FeatureEdges::new(vec![
            edge(2, 1, Reference, true),
            edge(0, 2, RecoverableGuard, false),
            edge(2, 0, AbortingGuard, true),
            edge(0, 1, Reference, true),
        ]);
        assert_eq!(
            edges.as_slice(),
            [
                edge(0, 1, Reference, true),
                edge(0, 2, RecoverableGuard, false),
                edge(2, 0, AbortingGuard, true),
                edge(2, 1, Reference, true),
            ]
        );
    }

    #[test]
    fn equal_pairs_are_merged() {
        let edges = FeatureEdges::new(vec![
            edge(0, 1, RecoverableGuard, false),
            edge(0, 2, RecoverableGuard, false),
            edge(0, 1, AbortingGuard, false),
            edge(0, 2, RecoverableGuard, false),
            edge(0, 1, RecoverableGuard, true),
        ]);
        assert_eq!(
            edges.as_slice(),
            [
                edge(0, 1, AbortingGuard, true),
                edge(0, 2, RecoverableGuard, false),
            ]
        );
    }

    #[test]
    fn self_edge_is_dropped() {
        let edges = FeatureEdges::new(vec![
            edge(1, 1, Reference, true),
            edge(1, 2, AbortingGuard, true),
            edge(2, 2, RecoverableGuard, false),
        ]);
        assert_eq!(edges.as_slice(), [edge(1, 2, AbortingGuard, true)]);
    }

    #[test]
    fn reference_is_always_followed() {
        let edges = FeatureEdges::new(vec![
            edge(0, 1, Reference, false),
            edge(0, 2, RecoverableGuard, false),
            edge(0, 2, Reference, false),
            edge(0, 3, AbortingGuard, false),
        ]);
        assert_eq!(
            edges.as_slice(),
            [
                edge(0, 1, Reference, true),
                edge(0, 2, Reference, true),
                edge(0, 3, AbortingGuard, false),
            ]
        );
    }

    #[test]
    fn leaving_returns_edges_by_source() {
        let edges = sample_edges();
        assert_eq!(
            edges.leaving(feature(1)),
            [edge(1, 0, Reference, true), edge(1, 2, AbortingGuard, true)]
        );
        assert_eq!(
            edges.leaving(feature(3)),
            [edge(3, 0, RecoverableGuard, false)]
        );
        assert_eq!(
            edges.leaving(feature(5)),
            [
                edge(5, 1, Reference, true),
                edge(5, 3, RecoverableGuard, true)
            ]
        );
        for absent in [0, 2, 4, 6] {
            assert!(edges.leaving(feature(absent)).is_empty());
        }
        assert!(FeatureEdges::default().leaving(feature(1)).is_empty());
    }

    #[test]
    fn entering_returns_edges_by_target() {
        let edges = sample_edges();
        let sources_entering = |target: usize| -> Vec<Feature> {
            edges
                .entering(feature(target))
                .map(|edge| edge.from)
                .collect()
        };
        assert_eq!(sources_entering(0), [feature(1), feature(3)]);
        assert_eq!(sources_entering(3), [feature(5)]);
        assert!(sources_entering(4).is_empty());
    }
}
