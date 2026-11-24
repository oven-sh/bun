//! Where a picture is flat, or repeats itself, there is no need to work out the same thing again and again.

/// The outcome for some samples and what is around them.
pub(super) struct Memo<'a, Samples, Around, Outcome> {
    basis: Option<(&'a Samples, Around)>,
    outcome: Outcome,
}

impl<Samples, Around, Outcome: Default> Default for Memo<'_, Samples, Around, Outcome> {
    fn default() -> Self {
        Self {
            basis: None,
            outcome: Outcome::default(),
        }
    }
}

impl<'a, Samples: PartialEq, Around: PartialEq + Copy, Outcome> Memo<'a, Samples, Around, Outcome> {
    pub(super) const fn forget(&mut self) {
        self.basis = None;
    }

    #[inline(always)]
    pub(super) fn get(
        &mut self,
        samples: &'a Samples,
        around: &Around,
        work_out: impl FnOnce(&mut Outcome),
    ) -> &Outcome {
        let basis = self.basis.as_ref();
        if !basis.is_some_and(|it| it.1 == *around && it.0 == samples) {
            self.basis = Some((samples, *around));
            work_out(&mut self.outcome);
        }
        &self.outcome
    }
}
