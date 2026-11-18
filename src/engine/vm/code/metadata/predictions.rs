//! The types that the value profiles have seen, added up.

use core::cell::Cell;

use crate::{CodeBlock, SpeculatedType, ValueProfile};

impl CodeBlock {
    pub(super) fn value_profiles(&self) -> impl Iterator<Item = &ValueProfile> {
        assert!(!self.is_optimized());
        let ranges = self.body().metadata().ranges();
        let words = ranges
            .filter(|(kind, _)| kind.has_value_profile())
            .flat_map(|(kind, range)| range.step_by(kind.words() as usize));
        // SAFETY: what such an entry starts with.
        let of_instructions = words.map(|word| unsafe { self.metadata::<ValueProfile>(word) });
        self.argument_profiles().iter().chain(of_instructions)
    }

    /// Since the predictions were updated.
    pub fn has_been_entered(&self) -> bool {
        self.argument_profiles()[0].last().is_some()
    }

    pub fn update_predictions(&self) {
        let predictions = self
            .rare_data()
            .caches
            .predictions
            .get_or_init(|| self.value_profiles().map(|_| Cell::default()).collect());
        for (prediction, profile) in predictions.iter().zip(self.value_profiles()) {
            prediction.set(prediction.get() | profile.take_type());
        }
    }

    pub(in crate::code) fn predictions(&self) -> &[Cell<SpeculatedType>] {
        if self.rare_data().caches.predictions.get().is_none() {
            self.update_predictions();
        }
        (self.rare_data().caches.predictions.get()).expect("just made")
    }

    /// How many of the instructions that have a prediction have given a value, and how many there are.
    pub fn coverage(&self) -> (usize, usize) {
        let all = self
            .rare_data()
            .caches
            .predictions
            .get()
            .map_or_default(|it| &**it);
        let of_instructions = all.get(self.parameters() as usize..).unwrap_or_default();
        let live = of_instructions.iter().filter(|it| !it.get().is_empty());
        (live.count(), of_instructions.len())
    }

    fn prediction_at(&self, index: usize) -> &Cell<SpeculatedType> {
        &self.predictions()[index]
    }

    /// Argument 0 is `this`. As of the last `update_predictions`.
    pub fn argument_prediction(&self, index: u32) -> &Cell<SpeculatedType> {
        assert!(index < self.parameters());
        self.prediction_at(index as usize)
    }

    /// Of the entry that starts at `word`. As of the last `update_predictions`.
    pub fn prediction(&self, word: u32) -> &Cell<SpeculatedType> {
        let mut index = self.parameters();
        for (kind, range) in self.body().metadata().ranges() {
            if range.contains(&word) {
                assert!(kind.has_value_profile());
                index += (word - range.start) / kind.words();
                break;
            }
            if kind.has_value_profile() {
                index += range.len() as u32 / kind.words();
            }
        }
        self.prediction_at(index as usize)
    }
}
