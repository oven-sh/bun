//! Source text, what it compiles to, and the state that running code keeps.

mod builtin;
mod builtin_values;
mod cache;
mod code_block;
mod compile;
mod compile_time;
mod discard;
mod dynamic_function;
mod eval;
mod executable;
mod lease;
pub mod metadata;
mod optimization;
mod profile;
mod scramble;
mod script;
mod serialized;
mod source;
mod speculation;
mod tiering;

pub use builtin::{
    BuiltinOutline, DetachedHost, StaticBuiltin, UnlinkedFunction, describe_builtin,
};
pub use code_block::{CodeBlock, CodeOrigin, CompiledCode, CoverageCount, InlineFrame, Tier};
pub use compile::{
    CompileError, CompileErrorKind, CompileErrorRecovery, create_compile_error,
    create_compile_error_in, throw_compile_error,
};
pub use compile_time::{counting_compile_time, total_compile_seconds};
pub use dynamic_function::{DynamicFunctionKind, create_dynamic_function};
pub(crate) use eval::evaluate_in_scope;
pub use eval::{
    direct_eval, execute_indirect_eval, indirect_eval, origin_of_caller, prepare_indirect_eval,
};
pub use executable::{
    EvalExecutable, Executable, FunctionExecutable, ModuleExecutable, NativeExecutable,
    ProgramExecutable, Restrictions, ScriptExecutable, native_source_text,
};
pub use optimization::{ExitKind, ExitKinds, ExitSite, OptimizerState};
pub use profile::{Arithmetic, ArithmeticProfile, ArrayModes, ArrayProfile, ValueProfile};
pub use script::{
    evaluate_compiled_script, evaluate_script, evaluate_script_in_scope,
    evaluate_script_to_function_in,
};
pub(crate) use serialized::log_origin_of_code;
pub use source::{
    LineColumn, SourceCode, SourceProvider, SourceProviderBuilder, SourceProviderRef, SourceType,
};
pub use speculation::SpeculatedType;
pub use tiering::is_optimizable;

use core::cell::RefCell;

use crate::Vm;
use crate::heap::Scope;

#[derive(Default)]
pub(crate) struct State {
    compilation: compile::Compilation,
    loader: std::rc::Rc<bun_engine_bytecode::cache::Loader>,
    builtins: builtin::Builtins,
    bytecodes: lease::Bytecodes,
    retired: code_block::RetiredCode,
    pub(crate) eval_variable_names: crate::scope::EvalVariableNames,
    last_function: RefCell<Option<dynamic_function::LastFunction>>,
}

impl crate::services::Service for State {
    fn did_collect(&self, vm: &Vm, scope: Scope) {
        vm.discard_expired_bytecode(scope);
        vm.release_compiler(scope);
        if scope == Scope::Full {
            (vm.heap).as_part_of_sweeping(|| vm.prune_compilation_caches());
        }
    }
}
