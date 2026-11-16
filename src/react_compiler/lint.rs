//! The compiler as a linter: upstream's `outputMode: 'lint'`. One function is lowered, analysed and
//! validated, and nothing is generated. `bun lint` calls it (`src/lint/react_compiler`).

#![allow(
    clippy::disallowed_types,
    reason = "interops with vendored react_compiler_hir which uses std::collections"
)]

use crate::collections::FxHashSet as HashSet;

use crate::collections::IndexMap;
use crate::diagnostics::{CompilerError, ErrorCategory};
use crate::hir::environment::{Environment, OutputMode};
use crate::hir::environment_config::{EnvironmentConfig, ExhaustiveEffectDepsMode};
use crate::hir::{
    HirFunction, InstructionKind, InstructionValue, ReactFunctionType, VariableBinding,
};
use crate::imports::ProgramContext;
use crate::lowering::{self, FunctionNode};
use crate::options::ReactCompilerOptions;
use crate::pipeline;
use crate::program::Host;
use core::cell::Cell;

/// What the compiler says of a function.
pub struct Linted {
    /// Upstream's `env.logErrors()`: what is reported whatever becomes of the function.
    pub logged: CompilerError,
    /// `Err`: why the function is not compiled. An error that a pass throws is alone in it: what
    /// the passes before it have recorded is dropped, as upstream drops it.
    pub result: Result<(), CompilerError>,
}

/// Categories of what the compiler says.
#[derive(Copy, Clone, PartialEq, Eq, Debug, Default)]
pub struct Categories(u32);

impl Categories {
    pub const ALL: Categories = Categories(u32::MAX);

    #[must_use]
    pub fn with(self, category: ErrorCategory) -> Categories {
        Categories(self.0 | (1 << category as u32))
    }

    pub fn has(self, category: ErrorCategory) -> bool {
        self.0 & (1 << category as u32) != 0
    }

    /// One of those that a pass throws.
    pub fn has_thrown(self) -> bool {
        self.has(ErrorCategory::Todo) || self.has(ErrorCategory::Invariant)
    }
}

/// For which functions the passes after the validations run. They take as long as all before them.
#[derive(Copy, Clone, PartialEq, Eq, Debug)]
enum LatePasses {
    /// Where they can change what is said in one of these categories, of which `Todo` and
    /// `Invariant` are none: an error is recorded, which an error of theirs would drop, or there
    /// is manual memoization to validate.
    WhereTheyCount(Categories),
    /// Also where they can say a `Todo`, which is about a function declaration that is referred
    /// to before it. Their invariants are not looked for.
    AlsoForTodos,
    Always,
}

impl LatePasses {
    fn run(self, hir: &HirFunction, env: &Environment) -> bool {
        let is_start_of_memoization =
            |value: &InstructionValue| matches!(value, InstructionValue::StartMemoize { .. });
        let is_hoisted_function = |value: &InstructionValue| {
            matches!(value, InstructionValue::DeclareContext { lvalue, .. }
                if lvalue.kind == InstructionKind::HoistedFunction)
        };
        match self {
            LatePasses::Always => true,
            LatePasses::WhereTheyCount(wanted) => {
                let validates_memoization = wanted.has(ErrorCategory::PreserveManualMemo)
                    || wanted.has(ErrorCategory::MemoDependencies);
                (env.errors.details.iter()).any(|it| wanted.has(it.category()))
                    || (validates_memoization && has_instruction(hir, env, is_start_of_memoization))
            }
            _ if env.has_errors() || has_instruction(hir, env, is_start_of_memoization) => true,
            LatePasses::AlsoForTodos => has_instruction(hir, env, is_hoisted_function),
        }
    }
}

/// `wanted`: what is said in another category need not be said.
///
/// `is_more_recorded`: the caller has errors of its own for the function that are wanted, which
/// an error that a pass throws drops like those that the passes record.
pub fn lint_function(
    func: &FunctionNode<'_>,
    host: &dyn Host,
    fn_type: ReactFunctionType,
    config: &EnvironmentConfig,
    import_bindings: &[(bun_ast::Ref, VariableBinding)],
    wanted: Categories,
    is_more_recorded: bool,
) -> Linted {
    let wants_thrown = wanted.has_thrown();
    let late_passes = match wants_thrown {
        _ if is_more_recorded => LatePasses::Always,
        true => LatePasses::AlsoForTodos,
        false => LatePasses::WhereTheyCount(wanted),
    };
    let mut config = config.clone();
    // A validation throws only a `Todo` or an `Invariant`, and that for no reason of its own.
    if !wants_thrown {
        config.validate_hooks_usage &= wanted.has(ErrorCategory::Hooks);
        if !wanted.has(ErrorCategory::CapitalizedCalls) {
            config.validate_no_capitalized_calls = None;
        }
        config.validate_no_derived_computations_in_effects &=
            wanted.has(ErrorCategory::EffectDerivationsOfState);
        if !wanted.has(ErrorCategory::EffectExhaustiveDependencies) {
            config.validate_exhaustive_effect_dependencies = ExhaustiveEffectDepsMode::Off;
        }
    }
    let mut bindings = IndexMap::new();
    for (ref_, binding) in import_bindings {
        bindings.insert(*ref_, binding.clone());
    }
    let mut context = ProgramContext::new(ReactCompilerOptions::default(), None, None, false);
    context.output_mode = OutputMode::Lint;
    let mut env = Environment::with_config(config);
    env.fn_type = fn_type;
    env.output_mode = OutputMode::Lint;
    env.seed_uid_known_names(&HashSet::default());
    let result = run(
        func,
        host,
        &mut env,
        &mut context,
        &bindings,
        late_passes,
        wants_thrown,
    );
    Linted {
        logged: context.logged,
        result,
    }
}

fn run(
    func: &FunctionNode<'_>,
    host: &dyn Host,
    env: &mut Environment,
    context: &mut ProgramContext,
    import_bindings: &IndexMap<bun_ast::Ref, VariableBinding>,
    late_passes: LatePasses,
    wants_thrown: bool,
) -> Result<(), CompilerError> {
    let mut hir = lowering::lower(func, None, host, env, import_bindings)?;
    pipeline::dump_lowered(&hir, env);
    if env.has_invariant_errors() {
        return Err(env.take_invariant_errors());
    }
    let was_followed = Cell::new(true);
    let is_followed = |hir: &HirFunction, env: &Environment| {
        was_followed.set(late_passes.run(hir, env));
        was_followed.get()
    };
    let is_followed: Option<pipeline::IsFollowed<'_>> = match wants_thrown {
        true => None,
        false => Some(&is_followed),
    };
    pipeline::run_analysis_passes(&mut hir, env, context, is_followed)?;
    if late_passes.run(&hir, env) {
        debug_assert!(
            was_followed.get(),
            "an error was recorded after the question"
        );
        pipeline::run_reactive_scope_passes(&mut hir, env, context)?;
    }
    match env.has_errors() {
        true => Err(env.take_errors()),
        false => Ok(()),
    }
}

/// In the function or in a function in it.
fn has_instruction(
    hir: &HirFunction,
    env: &Environment,
    is_one: impl Fn(&InstructionValue) -> bool,
) -> bool {
    (std::iter::once(hir).chain(&env.functions))
        .any(|function| function.instructions.iter().any(|it| is_one(&it.value)))
}
