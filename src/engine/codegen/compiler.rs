use bun_engine_asm::{MacroAssembly, arm64, x64};

use crate::client::{Client, Frame};
use crate::ir::{Function, validate};
use crate::machine::{Emitted, Machine};
use crate::passes::{Analyses, Level, Pass};
use crate::target::Target;

/// The function would take too much time or memory to compile.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub struct TooComplex;

#[derive(Clone, Copy, Debug)]
pub struct Options {
    pub level: Level,
    pub records_origins: bool,
}

pub struct Compiled {
    pub frame: Frame,
    pub emitted: Emitted,
}

macro_rules! compilers {
    ($($name:ident: $instruction:ty, $masm:ty, $target:path;)*) => {
        $(/// Keeps its tables from one function to the next.
        #[derive(Default)]
        pub struct $name {
            analyses: Analyses,
            machine: Machine<$instruction>,
        }

        impl $name {
            pub fn compile(
                &mut self,
                function: &mut Function,
                options: Options,
                masm: &mut $masm,
                client: &mut impl Client<$masm>,
            ) -> Result<Compiled, TooComplex> {
                if cfg!(debug_assertions)
                    && let Err(problem) = validate(function)
                {
                    panic!("{problem}\n{function:?}");
                }
                self.analyses.invalidate();
                for pass in Pass::pipeline(options.level) {
                    pass.run(function, &mut self.analyses, $target(masm.features()));
                }
                let (cfg, frequencies) = self.analyses.frequencies(function);
                let Options { level, records_origins } = options;
                let (frame, emitted) =
                    self.machine.generate(function, cfg, frequencies, level, records_origins, masm, client)?;
                Ok(Compiled { frame, emitted })
            }
        })*
    };
}

compilers! {
    X64Compiler: crate::x64::Inst, x64::MacroAssembler, Target::X64;
    Arm64Compiler: crate::arm64::Inst, arm64::MacroAssembler, Target::Arm64;
}
