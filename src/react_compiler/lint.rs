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
    BlockId, HirFunction, InstructionKind, InstructionValue, ReactFunctionType, Terminal,
    VariableBinding,
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
    /// the passes before it have recorded is dropped, as upstream drops it. One that is thrown and
    /// has no details is an error of upstream's codegen that is not the compiler's, which upstream
    /// logs as a `PipelineError` and no rule reports.
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
///
/// `has_spread_child`: a JSX spread child is in the tree as a spread, which upstream's codegen
/// fails on. See [`spread_child_reaches_codegen`].
pub fn lint_function(
    func: &FunctionNode<'_>,
    host: &dyn Host,
    fn_type: ReactFunctionType,
    config: &EnvironmentConfig,
    import_bindings: &[(bun_ast::Ref, VariableBinding)],
    wanted: Categories,
    is_more_recorded: bool,
    has_spread_child: bool,
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
        has_spread_child,
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
    has_spread_child: bool,
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
    // The passes that follow move functions out of the HIR.
    let fails_in_codegen = has_spread_child && spread_child_reaches_codegen(&hir, env);
    if late_passes.run(&hir, env) {
        debug_assert!(
            was_followed.get(),
            "an error was recorded after the question"
        );
        pipeline::run_reactive_scope_passes(&mut hir, env, context)?;
    }
    if fails_in_codegen {
        return Err(CompilerError::new());
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

/// Whether upstream's codegen, which is its last pass in this mode too, comes to a JSX spread
/// child. Its lowering keeps the node in an `UnsupportedNode`, and its codegen hands that node to
/// Babel as an expression. It is none, so Babel throws an error that is not the compiler's, and
/// what the function has recorded is never returned.
///
/// Here the node is the `SpreadElement` of `lower_expression`. Dead code elimination keeps such an
/// instruction, so codegen comes to it if its block is still there and is generated.
fn spread_child_reaches_codegen(hir: &HirFunction, env: &Environment) -> bool {
    // Each function with whether codegen generates it. One that it does not generate can still
    // have functions in it that are outlined.
    let mut functions = vec![(hir, true)];
    while let Some((function, is_function_generated)) = functions.pop() {
        // The fallthrough of a loop that codegen leaves out. The blocks of a loop are before it.
        let mut left_out_until = None;
        for block in function.body.blocks.values() {
            if left_out_until == Some(block.id) {
                left_out_until = None;
            }
            let is_generated = is_function_generated && left_out_until.is_none();
            for id in block.instructions.iter() {
                match &function.instructions[id.0 as usize].value {
                    InstructionValue::UnsupportedNode {
                        node_type: Some("SpreadElement"),
                        ..
                    } if is_generated => return true,
                    InstructionValue::FunctionExpression { lowered_func, .. } => {
                        let inner = &env.functions[lowered_func.func.0 as usize];
                        functions.push((inner, is_generated || is_outlined(inner)));
                    }
                    InstructionValue::ObjectMethod { lowered_func, .. } => {
                        let inner = &env.functions[lowered_func.func.0 as usize];
                        functions.push((inner, is_generated));
                    }
                    _ => {}
                }
            }
            match block.terminal {
                Terminal::ForOf {
                    test: head,
                    fallthrough,
                    ..
                }
                | Terminal::ForIn {
                    init: head,
                    fallthrough,
                    ..
                } if is_generated && !is_loop_generated(function, head) => {
                    left_out_until = Some(fallthrough);
                }
                _ => {}
            }
        }
    }
    false
}

/// `OutlineFunctions` moves a function expression that has no name and captures nothing out of the
/// function that it is in, and codegen generates each of those, wherever it was. One that is an
/// operand of `fbt` stays, which is not looked at here.
fn is_outlined(function: &HirFunction) -> bool {
    function.id.is_none() && function.context.is_empty()
}

/// Whether upstream's codegen makes a loop of a `for..of` or a `for..in` with this head. Of any
/// other it records the Todo "Support non-trivial for..of inits" and generates neither the head
/// nor the body.
///
/// It takes a head of two instructions whose second is not a store to a context variable. The
/// instructions are those of the sequence that `BuildReactiveFunction` makes of the head: in a
/// `try` each is a block of its own, and a value of several blocks is an instruction more.
fn is_loop_generated(function: &HirFunction, head: BlockId) -> bool {
    let mut count = 0;
    let mut last = None;
    let mut id = head;
    loop {
        let Some(block) = function.body.blocks.get(&id) else {
            return true;
        };
        count += block.instructions.len();
        last = block.instructions.last().or(last);
        match block.terminal {
            Terminal::MaybeThrow { continuation, .. } => id = continuation,
            Terminal::Branch { .. } | Terminal::Goto { .. } => break,
            _ => return false,
        }
    }
    let is_context_store = last.is_some_and(|it| {
        matches!(
            function.instructions[it.0 as usize].value,
            InstructionValue::StoreContext { .. }
        )
    });
    count == 2 && !is_context_store
}
