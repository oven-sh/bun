use bun_sema::check::Checker;

pub struct PartsOfVisit<'r, 's> {
    pub(crate) run: &'r RunParts<'r, 's>,
    pub(crate) in_parallel: &'r InParallel<'r>,
    pub(crate) has_given_up: bool,
}

pub(crate) type InParallel<'r> = dyn Fn(usize, &(dyn Fn(usize) + Sync)) + Sync + 'r;

pub(crate) type RunParts<'r, 's> = dyn Fn(usize, &(dyn Fn(&mut Checker<'_, 's>, usize) + Sync), &mut dyn FnMut()) -> bool
    + Sync
    + 'r;

impl<'s> PartsOfVisit<'_, 's> {
    pub fn in_parallel(&self) -> &(dyn Fn(usize, &(dyn Fn(usize) + Sync)) + Sync) {
        self.in_parallel
    }

    pub fn has_given_up(&self) -> bool {
        self.has_given_up
    }

    pub fn run(
        &self,
        count: usize,
        ask: &(dyn Fn(&mut Checker<'_, 's>, usize) + Sync),
        meanwhile: &mut dyn FnMut(),
    ) -> bool {
        (self.run)(count, ask, meanwhile)
    }
}
