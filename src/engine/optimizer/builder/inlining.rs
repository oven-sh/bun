//! Which functions are worth translating in place of a call. Sizes are in bytes of bytecode.

use bun_engine_bytecode::CodeFlags;
use bun_engine_vm::{CodeBlock, FunctionExecutable, Gc, Tier, options};

use super::Builder;
use super::calls::CallSite;
use crate::graph::{CallKind, ExitKind, Kind};

/// The call takes about as much code as the function.
const TINY: u32 = 40;
const EXTRA_DEPTH_FOR_TINY: usize = 3;
const MAX_RECURSION: usize = 2;
/// By level.
const GREATEST_SIZE: [u32; 2] = [90, 320];
const BUDGET: [u32; 2] = [1500, 8000];

impl Builder<'_> {
    /// For a function that has reached that tier, which tells how much it has run.
    fn greatest_size(&self, site: &CallSite<'_>, tier: Tier) -> u32 {
        let (&this, arguments) = site.arguments.split_first().expect("always passed");
        let (frame, is_known_function) = (self.frame(), |&it| self.proven_executable(it).is_some());
        let for_site = if arguments.iter().any(is_known_function) {
            200
        } else if self.graph.kind(self.graph.root(this)) == Some(Kind::NewObject) {
            150
        } else if frame.header_around(frame.current).is_some() {
            140
        } else {
            100
        };
        let for_tier = match tier {
            Tier::Interpreter => 30,
            Tier::Baseline if self.is_full() => 60,
            _ => 100,
        };
        let for_depth = core::iter::repeat_n(65, self.frames.len() - 1);
        let percentages = [for_site, for_tier].into_iter().chain(for_depth);
        let greatest = GREATEST_SIZE[self.graph.level as usize];
        (percentages.fold(greatest, |size, percentage| size * percentage / 100)).max(TINY)
    }

    pub(super) fn inlinable_code(
        &self,
        script: Gc<FunctionExecutable>,
        site: &CallSite<'_>,
    ) -> Option<Gc<CodeBlock>> {
        let installed = script.code_block(site.kind.specialization())?;
        let target = installed.baseline();
        let size = target.body().instructions().len() as u32;
        let mut max_depth = options().max_inlining_depth as usize;
        if size <= TINY && max_depth > 1 {
            max_depth += EXTRA_DEPTH_FOR_TINY;
        }
        let recursion = (self.frames.iter()).filter(|frame| frame.code_block == target);
        let unsuitable = CodeFlags::SUSPENDS | CodeFlags::HAS_DEBUG_HOOKS;
        let is_suitable = self.frames.len() < max_depth
            && self.inlined_size + size <= BUDGET[self.graph.level as usize]
            && size <= self.greatest_size(site, installed.tier())
            && recursion.count() < MAX_RECURSION
            && !(script.restrictions()).contains(bun_engine_vm::Restrictions::NEVER_INLINE)
            && !target.body().flags().intersects(unsuitable)
            && !target.exits_anywhere().contains(ExitKind::ArgumentsEscaped)
            && (site.kind != CallKind::Accessor || self.can_return_from_accessor());
        is_suitable.then_some(target)
    }

    fn can_return_from_accessor(&self) -> bool {
        let frame = self.frame();
        bun_engine_interpreter::return_point(frame.code_block.body().instructions(), frame.offset)
            .is_some()
    }
}
