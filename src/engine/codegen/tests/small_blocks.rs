//! Tangles of blocks with next to nothing in them, so that all depends on what happens between blocks.
//! `CODEGEN_FUZZ_SEED` and `CODEGEN_FUZZ_COUNT` choose the programs.

#![allow(clippy::disallowed_methods)]

mod support;

use bun_engine_asm::prelude::*;
use bun_engine_asm::{Features, Options as AssemblerOptions, Target};
use bun_engine_codegen::ir::*;
use bun_engine_codegen::passes::Level;
use bun_engine_codegen::{CallSite, Client, Compiler, ExitSite, Frame, Options, PatchpointSite};
use bun_engine_exec_memory::{Priority, link};
use support::harness::number_setting;
use support::random::{Random, mix};

const CONSTANTS: [u64; 6] = [0, 1, 2, 7, 0xffff_ffff, 0x1234_5678_9abc];
const CONDITIONS: [Cond; 6] = [
    Cond::Eq,
    Cond::Ne,
    Cond::Lt,
    Cond::Ge,
    Cond::Below,
    Cond::Above,
];
/// The variable that counts down on the way back.
const FUEL: usize = 0;

#[derive(Clone, Copy, Debug)]
enum Term {
    Variable(usize),
    Constant(u64),
}

#[derive(Debug)]
enum Statement {
    Binary(usize, Binary, usize, Term),
    Select(usize, Test, Term, Term),
    Call {
        to: usize,
        argument: usize,
        keeps_registers: bool,
    },
}

#[derive(Clone, Copy, Debug)]
struct Test(Cond, usize, Term);

#[derive(Debug)]
struct Way {
    target: usize,
    args: Vec<Term>,
    is_rare: bool,
}

#[derive(Debug)]
enum End {
    Jump(Way),
    Branch(Test, [Way; 2]),
    /// On the low three bits.
    Switch(usize, Vec<Way>),
    Return(usize),
}

#[derive(Debug)]
struct Program {
    variables: usize,
    blocks: Vec<(Vec<Statement>, End)>,
    withheld: RegisterSet,
}

extern "C" fn stir(value: u64) -> u64 {
    mix(value, 1) >> (value % 61)
}

struct Generator {
    random: Random,
    variables: usize,
    changed_percent: u32,
}

impl Generator {
    fn variable(&mut self) -> usize {
        1 + self.random.below(self.variables - 1)
    }

    fn term(&mut self) -> Term {
        if self.random.one_in(3) {
            Term::Constant(self.random.pick(&CONSTANTS))
        } else {
            Term::Variable(self.variable())
        }
    }

    fn test(&mut self) -> Test {
        Test(self.random.pick(&CONDITIONS), self.variable(), self.term())
    }

    fn way(&mut self, target: usize) -> Way {
        let variables = 0..self.variables;
        let arg = |variable| match variable != FUEL && self.random.percent(self.changed_percent) {
            true => self.term(),
            false => Term::Variable(variable),
        };
        Way {
            target,
            args: variables.map(arg).collect(),
            is_rare: self.random.one_in(8),
        }
    }

    fn statement(&mut self) -> Statement {
        const OPERATIONS: [Binary; 5] = [
            Binary::Add,
            Binary::Sub,
            Binary::Xor,
            Binary::And,
            Binary::Mul,
        ];
        let to = self.variable();
        match self.random.below(10) {
            0 => Statement::Select(to, self.test(), self.term(), self.term()),
            1 | 2 => Statement::Call {
                to,
                argument: self.variable(),
                keeps_registers: self.random.flip(),
            },
            _ => {
                let op = self.random.pick(&OPERATIONS);
                Statement::Binary(to, op, self.variable(), self.term())
            }
        }
    }
}

impl Program {
    /// Block `count + n` uses up fuel and goes on to block `n`, or to the last when there is none left.
    fn generate(seed: u64) -> Self {
        let mut random = Random::new(seed);
        let count = random.between(3, 14) as usize;
        let spared = (abi::CALLEE_SAVED | RegisterSet::of(&abi::TEMPORARY_GPRS[4..], &[]))
            - RegisterSet::of(&abi::ARGUMENT_GPRS[..2], &[]);
        let withheld_percent = random.pick(&[0, 30, 70]);
        let withheld = spared.gprs().filter(|_| random.percent(withheld_percent));
        let withheld = withheld.collect();
        let mut g = Generator {
            variables: random.pick(&[2, 3, 4, 6, 9, 15]),
            changed_percent: random.pick(&[0, 10, 30, 60]),
            random,
        };
        let mut blocks = Vec::new();
        for block in 0..count {
            let length = g.random.pick(&[0, 0, 1, 1, 2, 3]);
            let statements = (0..length).map(|_| g.statement()).collect();
            let way = |g: &mut Generator| {
                let target = g.random.between(1, count as i64 - 1) as usize;
                g.way(if target <= block {
                    count + target
                } else {
                    target
                })
            };
            let end = match g.random.below(12) {
                _ if block == count - 1 => End::Return(g.variable()),
                0 => End::Return(g.variable()),
                1 => End::Switch(g.variable(), (0..8).map(|_| way(&mut g)).collect()),
                2..6 => End::Jump(way(&mut g)),
                _ => End::Branch(g.test(), [way(&mut g), way(&mut g)]),
            };
            blocks.push((statements, end));
        }
        for target in 0..count {
            let burn = Statement::Binary(FUEL, Binary::Sub, FUEL, Term::Constant(1));
            let is_left = Test(Cond::Ge, FUEL, Term::Constant(0));
            let ways = [g.way(target.max(1)), g.way(count - 1)];
            blocks.push((vec![burn], End::Branch(is_left, ways)));
        }
        Self {
            variables: g.variables,
            blocks,
            withheld,
        }
    }

    fn run(&self, fuel: u64, start: u64) -> u64 {
        let mut values: Vec<u64> = (0..self.variables as u64).map(|n| start + n).collect();
        values[FUEL] = fuel;
        let read = |values: &[u64], term| match term {
            Term::Variable(variable) => values[variable],
            Term::Constant(constant) => constant,
        };
        let holds = |values: &[u64], Test(cond, lhs, rhs)| {
            evaluate::compare(cond, Type::I64, values[lhs], read(values, rhs))
        };
        let mut block = 0;
        loop {
            let (statements, end) = &self.blocks[block];
            for statement in statements {
                match *statement {
                    Statement::Binary(to, op, lhs, rhs) => {
                        let (lhs, rhs) = (values[lhs], read(&values, rhs));
                        values[to] = evaluate::binary(op, Type::I64, lhs, rhs).unwrap();
                    }
                    Statement::Select(to, test, then, or) => {
                        values[to] = read(&values, if holds(&values, test) { then } else { or });
                    }
                    Statement::Call { to, argument, .. } => values[to] = stir(values[argument]),
                }
            }
            let way = match end {
                End::Jump(way) => way,
                End::Branch(test, ways) => &ways[usize::from(!holds(&values, *test))],
                End::Switch(variable, ways) => &ways[values[*variable] as usize % ways.len()],
                End::Return(variable) => return values[*variable],
            };
            values = way.args.iter().map(|&arg| read(&values, arg)).collect();
            block = way.target;
        }
    }

    fn build(&self) -> Function {
        let mut function = Function::new(self.withheld | abi::CALLEE_SAVED_LOW_HALF);
        function.set_results(&[Boundary::Register(abi::RETURN_GPRS[0].into())]);
        let argument = |n: usize| (Type::I64, Boundary::Register(abi::ARGUMENT_GPRS[n].into()));
        let entry = function.add_entry(&[argument(0), argument(1)]);
        let [fuel, start] = [0, 1].map(|n| function.params(entry)[n]);
        let mut b = Builder::at_end(&mut function, entry);
        let mut values: Vec<Value> = (0..self.variables as i64)
            .map(|n| b.add(start, n))
            .collect();
        values[FUEL] = fuel;
        let blocks: Vec<Block> = self.blocks.iter().map(|_| b.new_block()).collect();
        b.jump(blocks[0], &values);
        for &block in &blocks {
            (0..self.variables).for_each(|_| _ = b.add_param(block, Type::I64));
        }
        for (&block, (statements, end)) in blocks.iter().zip(&self.blocks) {
            b.switch_to(block);
            let mut values = b.params(block).to_vec();
            let read = |b: &mut Builder<'_>, values: &[Value], term| match term {
                Term::Variable(variable) => values[variable],
                Term::Constant(constant) => b.constant(Type::I64, constant),
            };
            let test = |b: &mut Builder<'_>, values: &[Value], Test(cond, lhs, rhs)| {
                let rhs = read(b, values, rhs);
                b.insert(Op::Compare(cond, [values[lhs], rhs]), Type::I32)
            };
            for statement in statements {
                match *statement {
                    Statement::Binary(to, op, lhs, rhs) => {
                        let rhs = read(&mut b, &values, rhs);
                        values[to] = b.binary(op, values[lhs], rhs);
                    }
                    Statement::Select(to, condition, then, or) => {
                        let condition = test(&mut b, &values, condition);
                        let [then, or] = [then, or].map(|term| read(&mut b, &values, term));
                        values[to] = b.select(condition, then, or);
                    }
                    Statement::Call {
                        to,
                        argument,
                        keeps_registers,
                    } => values[to] = self.call(&mut b, values[argument], keeps_registers),
                }
            }
            let ways: &[Way] = match end {
                End::Jump(way) => std::slice::from_ref(way),
                End::Branch(_, ways) => ways,
                End::Switch(_, ways) => ways,
                End::Return(_) => &[],
            };
            let args: Vec<Vec<Value>> = ways
                .iter()
                .map(|way| (way.args.iter().map(|&arg| read(&mut b, &values, arg))).collect())
                .collect();
            let successor = |n: usize| Successor {
                is_rare: ways[n].is_rare && ways.len() > 1,
                ..Successor::new(blocks[ways[n].target], &args[n])
            };
            match *end {
                End::Jump(_) => b.jump(successor(0).target, &args[0]),
                End::Branch(condition, _) => {
                    let condition = test(&mut b, &values, condition);
                    b.branch(condition, successor(0), successor(1));
                }
                End::Switch(variable, _) => {
                    let key = b.and(values[variable], 7);
                    let cases: Vec<_> = (0..7).map(|n| (n as i64, successor(n))).collect();
                    b.switch(key, &cases, successor(7));
                }
                End::Return(variable) => b.ret(&[values[variable]]),
            }
        }
        function
    }

    fn call(&self, b: &mut Builder<'_>, argument: Value, keeps_registers: bool) -> Value {
        let target = Target::Address(stir as *const () as usize);
        let mut data = PatchpointData::new(Action::Call(target), Token(0), Effects::CALL);
        data.clobbers_late = if keeps_registers {
            abi::CALLER_SAVED
        } else {
            abi::ALL - RegisterSet::of(&[abi::STACK_POINTER, abi::FRAME_POINTER], &[])
        } - b.pinned;
        b.patchpoint(
            &data,
            &[(argument, Input::Fixed(abi::ARGUMENT_GPRS[0].into()))],
            &[(Type::I64, Output::Fixed(abi::RETURN_GPRS[0].into()))],
        )
    }
}

struct Plain;

impl Client<MacroAssembler> for Plain {
    fn prologue(&mut self, masm: &mut MacroAssembler, _: usize, frame: &Frame) {
        let (body, saved): (_, Vec<Gpr>) = (masm.new_label(), abi::CALLEE_SAVED.gprs().collect());
        masm.enter_frame();
        (saved.iter()).for_each(|&reg| masm.push_pair(reg, reg));
        masm.call(body);
        (saved.iter().rev()).for_each(|&reg| masm.pop_pair(reg, abi::ARGUMENT_GPRS[1]));
        masm.leave_frame();
        masm.ret();
        masm.bind(body);
        masm.enter_frame();
        masm.sub64(abi::STACK_POINTER, abi::STACK_POINTER, frame.size);
    }
    fn shared_exit(&mut self, _: &mut MacroAssembler, _: Token) -> Option<Label> {
        None
    }
    fn exit(&mut self, _: &mut MacroAssembler, _: &ExitSite<'_>) {}
    fn patchpoint(&mut self, _: &mut MacroAssembler, _: &PatchpointSite<'_>) {}
    fn after_call(&mut self, _: &mut MacroAssembler, _: &CallSite<'_>) {}
    fn out_of_line(&mut self, _: &mut MacroAssembler) {}
}

#[test]
fn machine_code_takes_the_same_way() {
    /// A block that is repeated after the moves of an edge falls through and leaves an edge of its own to place.
    const UNUSUAL: [u64; 3] = [61_902, 103_296, 120_372];
    let (first, mut compiler) = (number_setting("SEED", 0), Compiler::default());
    for seed in (first..first + number_setting("COUNT", 600)).chain(UNUSUAL) {
        let program = Program::generate(seed);
        for level in [Level::Quick, Level::Full] {
            let mut masm = MacroAssembler::new(AssemblerOptions {
                features: Features::host(),
                shorten_jumps: seed % 4 != 0,
                seed: 0,
            });
            let options = Options {
                level,
                records_origins: false,
            };
            let compiled = compiler.compile(&mut program.build(), options, &mut masm, &mut Plain);
            let (entry, code) = (compiled.unwrap().emitted.entries[0], masm.finish().unwrap());
            let linked = link(&code, Priority::Required, |_| unreachable!()).unwrap();
            let address = linked.address(code.offset_of(entry));
            // SAFETY: the function has this type.
            let native =
                unsafe { std::mem::transmute::<usize, extern "C" fn(u64, u64) -> u64>(address) };
            for input in 0..12 {
                let (fuel, start) = (input * 2, mix(seed, input) >> (input * 6 % 64));
                assert_eq!(
                    native(fuel, start >> 1),
                    program.run(fuel, start >> 1),
                    "seed {seed}, {level:?}, {program:#?}"
                );
            }
        }
    }
}
