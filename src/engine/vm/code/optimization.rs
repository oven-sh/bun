//! What a code block remembers of the attempts to optimize it.

use core::any::Any;
use core::cell::{Cell, OnceCell, RefCell};
use std::rc::Rc;

use bun_engine_bytecode::{Liveness, TooLarge};

use crate::{CodeBlock, GcFree, Tier, options};

macro_rules! exit_kinds {
    ($($(#[$doc:meta])* $name:ident,)*) => {
        /// Why optimized code was left.
        #[derive(Clone, Copy, PartialEq, Eq, Debug)]
        #[repr(u8)]
        pub enum ExitKind {
            $($(#[$doc])* $name,)*
        }

        const EXIT_KINDS: &[ExitKind] = &[$(ExitKind::$name,)*];
    };
}

exit_kinds! {
    BadType,
    /// Where any number would have done.
    NotANumber,
    NotAnAtom,
    /// The operands were expected to be of one type.
    Mixed,
    /// Where a conversion was expected to have nothing to do.
    Inconvertible,
    /// Of a variable that is kept without its tag.
    BadRepresentation,
    BadShape,
    BadElements,
    /// After all kinds that had been seen were provided for.
    BadElementsAgain,
    BadIdentity,
    BadName,
    BadExecutable,
    Overflow,
    Int52Overflow,
    NegativeZero,
    NotAnInteger,
    OutOfBounds,
    NegativeIndex,
    LoadFromHole,
    StoreToHole,
    TooManyArguments,
    ExoticObject,
    ArgumentsEscaped,
    /// What is iterated over is of another kind.
    BadIterator,
    /// A pattern has more elements than there are values.
    Exhausted,
    Surrogate,
    /// At a point where the code had not gone on before.
    NeverResumed,
    /// To throw or to return.
    AbruptResumption,
    /// Of a built-in.
    BadArgument,
    BadArgumentAgain,
    Rope,
    /// What was called in place of a built-in has thrown, which is for the built-in to do.
    Threw,
    /// A check that was moved out of a loop.
    HoistingFailed,
    /// The same, after the profiles have had the chance to learn from that.
    HoistingFailedAgain,
    /// The code had not run when it was compiled.
    NeverExecuted,
    /// The interpreter is going to throw.
    WillThrow,
    /// From here on they say nothing against the speculation.
    Invalidated,
    /// A variable has no value yet: the interpreter makes it or throws.
    Uninitialized,
    Trap,
    TierUp,
}

impl ExitKind {
    pub const COUNT: usize = EXIT_KINDS.len();

    pub const fn from_u8(value: u8) -> ExitKind {
        EXIT_KINDS[value as usize]
    }

    pub const fn is_counted(self) -> bool {
        (self as u8) < ExitKind::Invalidated as u8
    }
}

#[derive(Clone, Copy, PartialEq, Eq, Default, Debug)]
pub struct ExitKinds(u64);

impl ExitKinds {
    pub fn contains(self, kind: ExitKind) -> bool {
        self.0 >> kind as u32 & 1 != 0
    }

    pub fn insert(&mut self, kind: ExitKind) {
        self.0 |= 1 << kind as u32;
    }
}

/// An instruction, or one of a function that it calls and that has too many callers to learn from them all.
#[derive(Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
pub struct ExitSite {
    pub offset: u32,
    pub offset_in_callee: Option<u32>,
}

/// What the optimizer keeps for a code block that is not optimized.
pub trait OptimizerState: GcFree + Any {}

#[derive(Default)]
pub(super) struct Optimization {
    liveness: OnceCell<Rc<Liveness>>,
    /// Ascending.
    exit_sites: RefCell<Vec<(ExitSite, ExitKinds)>>,
    exits_anywhere: Cell<ExitKinds>,
    reoptimizations: Cell<u32>,
    state: OnceCell<Box<dyn OptimizerState>>,
}

impl CodeBlock {
    pub fn liveness(&self) -> Result<Rc<Liveness>, TooLarge> {
        let baseline = self.baseline();
        if let Some(liveness) = baseline.rare_data().optimization.liveness.get() {
            return Ok(Rc::clone(liveness));
        }
        let liveness = Rc::new(Liveness::new(self.body())?);
        Ok(Rc::clone(
            baseline
                .rare_data()
                .optimization
                .liveness
                .get_or_init(|| liveness),
        ))
    }

    /// A speculation has failed often at this instruction, so it is not made again.
    pub fn add_exit_site(&self, site: ExitSite, kind: ExitKind) {
        let baseline = self.baseline();
        let mut sites = baseline.rare_data().optimization.exit_sites.borrow_mut();
        let position = sites
            .binary_search_by_key(&site, |it| it.0)
            .unwrap_or_else(|position| {
                sites.insert(position, (site, ExitKinds::default()));
                position
            });
        sites[position].1.insert(kind);
    }

    pub fn note_exit(&self, kind: ExitKind) {
        let baseline = self.baseline();
        let mut anywhere = baseline.rare_data().optimization.exits_anywhere.get();
        anywhere.insert(kind);
        baseline
            .rare_data()
            .optimization
            .exits_anywhere
            .set(anywhere);
    }

    pub fn exits_at(&self, site: ExitSite) -> ExitKinds {
        let baseline = self.baseline();
        let Some(rare_data) = baseline.existing_rare_data() else {
            return ExitKinds::default();
        };
        let sites = rare_data.optimization.exit_sites.borrow();
        let found = sites.binary_search_by_key(&site, |it| it.0);
        found.map_or_else(|_| ExitKinds::default(), |position| sites[position].1)
    }

    pub fn exits_anywhere(&self) -> ExitKinds {
        let baseline = self.baseline();
        (baseline.existing_rare_data()).map_or_default(|it| it.optimization.exits_anywhere.get())
    }

    #[inline]
    pub fn note_argument_count(&self, frame: &crate::CallFrame) {
        let several = Self::SEVERAL_ARGUMENT_COUNTS;
        let count = (frame.argument_count_including_this().try_into()).unwrap_or(several);
        (self.baseline().usual_argument_count).update(|usual| match usual {
            0 => count,
            _ if usual == count => count,
            _ => several,
        });
    }

    pub fn has_had_several_argument_counts(&self) -> bool {
        self.baseline().usual_argument_count.get() == Self::SEVERAL_ARGUMENT_COUNTS
    }

    /// How often optimized code has been thrown away.
    pub fn reoptimizations(&self) -> u32 {
        let baseline = self.baseline();
        (baseline.existing_rare_data()).map_or(0, |it| it.optimization.reoptimizations.get())
    }

    /// With the code that is installed. Very many if nothing optimizes, so that a loop that waits for it ends.
    pub fn optimizations(&self) -> u32 {
        let options = options();
        let (is_possible, least) = if options.count_only_full_optimization {
            (options.use_full_optimizer, Tier::FullyOptimized)
        } else {
            (true, Tier::QuickOptimized)
        };
        if !(is_possible && options.use_baseline_jit && options.use_quick_optimizer) {
            return 1_000_000;
        }
        let installed = self.executable().code_block(self.specialization());
        self.reoptimizations() + u32::from(installed.is_some_and(|it| it.tier() >= least))
    }

    pub fn count_reoptimization(&self) {
        let baseline = self.baseline();
        baseline
            .rare_data()
            .optimization
            .reoptimizations
            .update(|count| count.saturating_add(1));
    }

    /// Of a code block that is not optimized.
    pub fn optimizer_state<T: OptimizerState + Default>(&self) -> &T {
        assert!(!self.is_optimized());
        let state: &dyn Any = &**self
            .rare_data()
            .optimization
            .state
            .get_or_init(|| Box::new(T::default()));
        state.downcast_ref().expect("there is one optimizer")
    }
}
