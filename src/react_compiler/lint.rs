//! The compiler as a linter: upstream's `outputMode: 'lint'`. One function is lowered, analysed and
//! validated, and nothing is generated. `bun lint` calls it (`src/lint/react_compiler`).

#![allow(
    clippy::disallowed_types,
    reason = "interops with vendored react_compiler_hir which uses std::collections"
)]

use std::collections::HashSet;

use crate::collections::IndexMap;
use crate::diagnostics::CompilerError;
use crate::hir::environment::{Environment, OutputMode};
use crate::hir::environment_config::EnvironmentConfig;
use crate::hir::{HirFunction, InstructionValue, ReactFunctionType, VariableBinding};
use crate::imports::ProgramContext;
use crate::lowering::{self, FunctionNode};
use crate::options::ReactCompilerOptions;
use crate::pipeline;
use crate::program::Host;

/// What the compiler says of a function.
pub struct Linted {
    /// Upstream's `env.logErrors()`: what is reported whatever becomes of the function.
    pub logged: CompilerError,
    /// `Err`: why the function is not compiled. An error that a pass throws is alone in it: what
    /// the passes before it have recorded is dropped, as upstream drops it.
    pub result: Result<(), CompilerError>,
}

/// `everything`: also the passes that can only say `Todo` or `Invariant` of this function.
/// Without it they are left out where that changes nothing else: nothing is recorded that an
/// error of theirs would drop, and there is no manual memoization to validate.
pub fn lint_function(
    func: &FunctionNode<'_>,
    host: &dyn Host,
    fn_type: ReactFunctionType,
    config: &EnvironmentConfig,
    import_bindings: &[(bun_ast::Ref, VariableBinding)],
    everything: bool,
) -> Linted {
    let mut bindings = IndexMap::new();
    for (ref_, binding) in import_bindings {
        bindings.insert(*ref_, binding.clone());
    }
    let mut context = ProgramContext::new(ReactCompilerOptions::default(), None, None, false);
    context.output_mode = OutputMode::Lint;
    let mut env = Environment::with_config(config.clone());
    env.fn_type = fn_type;
    env.output_mode = OutputMode::Lint;
    env.seed_uid_known_names(&HashSet::new());
    let result = run(func, host, &mut env, &mut context, &bindings, everything);
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
    everything: bool,
) -> Result<(), CompilerError> {
    let mut hir = lowering::lower(func, None, host, env, import_bindings)?;
    pipeline::dump_lowered(&hir, env);
    if env.has_invariant_errors() {
        return Err(env.take_invariant_errors());
    }
    pipeline::run_analysis_passes(&mut hir, env, context)?;
    if everything || env.has_errors() || has_manual_memoization(&hir, env) {
        pipeline::run_reactive_scope_passes(&mut hir, env, context)?;
    }
    match env.has_errors() {
        true => Err(env.take_errors()),
        false => Ok(()),
    }
}

/// Whether `validate_preserved_manual_memoization` has anything to look at.
fn has_manual_memoization(hir: &HirFunction, env: &Environment) -> bool {
    std::iter::once(hir).chain(&env.functions).any(|function| {
        function
            .instructions
            .iter()
            .any(|instruction| matches!(instruction.value, InstructionValue::StartMemoize { .. }))
    })
}
