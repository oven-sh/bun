use std::rc::Rc;

use bun_engine_syntax::FunctionFlags;
use bun_engine_text::{Atom, Identifier, StringRef, Text};

use crate::assembler::{Assembler, Label, SuspendedTries};
use crate::code::Storage;
use crate::function::FunctionName;
use crate::*;

pub(super) struct Random(u64);

impl Random {
    pub(super) fn new(seed: u64) -> Random {
        Random(seed.wrapping_mul(0x9e37_79b9_7f4a_7c15) | 1)
    }

    pub(super) fn next(&mut self) -> u64 {
        self.0 ^= self.0 << 13;
        self.0 ^= self.0 >> 7;
        self.0 ^= self.0 << 17;
        self.0.wrapping_mul(0x2545_f491_4f6c_dd1d)
    }

    pub(super) fn below(&mut self, limit: u32) -> u32 {
        (((self.next() >> 32) * u64::from(limit)) >> 32) as u32
    }

    pub(super) fn one_in(&mut self, count: u32) -> bool {
        self.below(count) == 0
    }

    /// Small numbers as often as large ones.
    pub(super) fn skewed_below(&mut self, limit: u32) -> u32 {
        let bits = self.below(limit.ilog2() + 2);
        self.below(limit.min(1u32.checked_shl(bits).unwrap_or(u32::MAX)))
    }

    pub(super) fn pick<T: Copy>(&mut self, elements: &[T]) -> T {
        elements[self.below(elements.len() as u32) as usize]
    }
}

pub(super) fn local(index: u32) -> Register {
    Register::local(index)
}

pub(super) fn instructions(body: &Body) -> Vec<(u32, RawInstruction)> {
    let code = body.instructions();
    Instructions::new(code, 0..code.len() as u32).collect()
}

macro_rules! define_emit {
    (
        $(#[$wide16_doc:meta])* Wide16Prefix wide16_prefix Pure {};
        $(#[$wide32_doc:meta])* Wide32Prefix wide32_prefix Pure {};
        $(
            $(#[$doc:meta])*
            $name:ident $mnemonic:ident $flow:ident { $($field:ident: $shape:ident),* } $(=> $metadata:ident)?;
        )*
    ) => {
        /// Through the method of the instruction.
        pub(super) fn emit(assembler: &mut Assembler, opcode: Opcode, words: &[u32]) {
            let mut bytes = vec![Opcode::Wide32Prefix as u8, opcode as u8];
            bytes.extend(words.iter().chain(&[0]).flat_map(|word| word.to_le_bytes()));
            match Instruction::read(&bytes, 0).0 {
                $(Instruction::$name(op::$name { $($field,)* .. }) => {
                    assembler.$mnemonic($(define_emit!(@argument $shape, $field)),*)
                })*
                _ => unreachable!(),
            }
        }
    };
    (@argument Target, $field:ident) => { Label::from_word($field.word()) };
    (@argument $shape:ident, $field:ident) => { $field };
}

crate::instruction_table!(define_emit);

pub(super) const ARRAY: u32 = 0;
pub(super) const REGEXP: u32 = 1;
pub(super) const STRING: u32 = 2;
pub(super) const LONG_STRING: u32 = 8;
pub(super) const FUNCTION: u32 = 0;
pub(super) const CLASS: u32 = 1;
pub(super) const BLOCK_SCOPE: u32 = 0;
pub(super) const WITH_SCOPE: u32 = 1;
const NAME_LISTS: u32 = 4;

fn function(name: &'static str, kind: FunctionKind) -> FunctionInfo {
    FunctionInfo {
        name: FunctionName::Owned(Identifier::from_literal(name)),
        kind,
        flags: FunctionFlags::STRICT,
        origin: Origin::empty(),
        visibility: Visibility::Public,
        instance_fields: 0,
        bare_fields: 0,
        has_own_name: true,
        context: EvalContext::empty(),
        text: 0..9,
        start: 0,
        parameters_start: 3,
        end: 9,
        length: 1,
        scope: None,
        created_at: 0,
        fields: None,
        code: Default::default(),
    }
}

/// With so many constants and identifiers. Name list `n` has `n` names.
pub(super) fn code(body: Body, entries: u32) -> Code {
    let atom = Atom::from_literal;
    let template = TemplateSite {
        cooked: [Some(atom("a")), None].into(),
        raw: [atom("a"), atom("\\u")].into(),
        end: 7,
    };
    let values = [Constant::Null, Constant::Double(0.5)];
    let constants = [
        Constant::Array(Rc::new(ArrayLiteral::Values(values.into()))),
        Constant::RegExp(Rc::new(RegExpLiteral {
            pattern: atom("x+"),
            flags: atom("g"),
        })),
        Constant::String(atom("text")),
        Constant::Empty,
        Constant::Undefined,
        Constant::Boolean(true),
        Constant::Template(Rc::new(template)),
        Constant::LinkTime(LinkTimeConstant::EVAL),
        Constant::LongString(StringRef::from_literal("long")),
        Constant::BigInt(Rc::new(BigIntLiteral {
            digits: StringRef::from_literal("ff"),
            radix: 16,
            is_negative: true,
        })),
    ];
    let names = ["a", "b", "c"].map(Identifier::from_literal);
    let scope = StaticScope::of_names(ScopeKind::Block, None, names.clone().into());
    let mut code = Code {
        body,
        identifiers: names
            .iter()
            .cycle()
            .take(entries as usize)
            .cloned()
            .collect(),
        constants: constants
            .into_iter()
            .chain((0..).map(Constant::Int32))
            .take(entries as usize)
            .collect(),
        functions: Rc::new([
            function("f", FunctionKind::Normal),
            function("C", FunctionKind::BaseConstructor),
        ]),
        scopes: [scope, StaticScope::with(None)].into(),
        name_lists: (0..NAME_LISTS as usize)
            .map(|len| names[..len].into())
            .collect(),
        string_switches: Box::default(),
        machine_code: Default::default(),
    };
    add_keys(&mut code);
    code
}

fn add_keys(code: &mut Code) {
    let key = |index: usize| Atom::new(Text::Latin1(format!("key{index}").as_bytes()));
    let switches = code.body.string_switches().iter();
    code.string_switches = switches
        .map(|switch| (0..switch.targets.len()).map(key).collect())
        .collect();
}

pub(super) fn set_body(code: &mut Code, body: Body) {
    code.body = body;
    add_keys(code);
}

pub(super) fn copy(body: &Body) -> Body {
    Body {
        storage: body.storage.clone(),
        tables: body.tables.clone(),
        ..*body
    }
}

/// The layout of the metadata, the instructions and the positions.
pub(super) fn bytes(body: &mut Body) -> &mut Box<[u8]> {
    match &mut body.storage {
        Storage::Owned(bytes) => bytes,
        Storage::Borrowed(_) => unreachable!(),
    }
}

pub(super) struct Emitted {
    pub(super) opcode: Opcode,
    pub(super) words: Vec<u32>,
    /// The key and the label of each case, then the default.
    pub(super) cases: Vec<(i32, Label)>,
    pub(super) position: Option<Position>,
    /// The innermost last.
    pub(super) tries: Vec<(Label, HandlerKind)>,
}

#[derive(Clone, Copy)]
pub(super) struct Limits {
    pub(super) steps: u32,
    pub(super) locals: u32,
    pub(super) entries: u32,
    pub(super) suspends: bool,
}

/// Random code, and what the assembler was told.
pub(super) struct Program {
    pub(super) emitted: Vec<Emitted>,
    /// The index of the instruction that each label is bound to.
    pub(super) labels: Vec<Option<usize>>,
    pub(super) is_referenced: Vec<bool>,
}

struct Builder<'a> {
    assembler: &'a mut Assembler,
    random: &'a mut Random,
    limits: Limits,
    program: Program,
    is_reachable: bool,
    position: Option<Position>,
    ahead: Vec<Label>,
    behind: Vec<Label>,
    tries: Vec<(Label, HandlerKind)>,
    suspended: Vec<(SuspendedTries, Vec<(Label, HandlerKind)>, usize)>,
    handlers: Vec<Label>,
}

impl Limits {
    fn parameters(self) -> u32 {
        if self.suspends { 1 } else { self.locals / 2 }
    }

    pub(super) fn finish(self, assembler: &mut Assembler) -> Body {
        let mut flags = CodeFlags::all();
        flags.set(CodeFlags::SUSPENDS, self.suspends);
        let body = assembler.finish(CodeKind::Construct, flags, self.locals, self.parameters());
        body.unwrap()
    }

    pub(super) fn build(self, assembler: &mut Assembler, random: &mut Random) -> Program {
        assembler.reset();
        let mut builder = Builder {
            assembler,
            random,
            limits: self,
            program: Program {
                emitted: vec![],
                labels: vec![],
                is_referenced: vec![],
            },
            is_reachable: true,
            position: None,
            ahead: vec![],
            behind: vec![],
            tries: vec![],
            suspended: vec![],
            handlers: vec![],
        };
        builder.build();
        builder.program
    }
}

const SUSPENDING_ONLY: [Opcode; 9] = [
    Opcode::DebugAwait,
    Opcode::CreateGenerator,
    Opcode::CreateAsyncGenerator,
    Opcode::ResumeAfterYield,
    Opcode::ResumeAfterAwait,
    Opcode::ResumeAfterDelegate,
    Opcode::GeneratorReturn,
    Opcode::GeneratorThrow,
    Opcode::AsyncIteratorNext,
];

impl Builder<'_> {
    fn build(&mut self) {
        self.plain_instruction(Opcode::Enter);
        if self.limits.suspends {
            self.plain_instruction(Opcode::ResumeDispatch);
        }
        for _ in 0..self.limits.steps {
            self.step();
            assert_eq!(self.assembler.is_reachable(), self.is_reachable);
            assert_eq!(self.assembler.try_depth() as usize, self.tries.len());
        }
        while !self.tries.is_empty() || !self.suspended.is_empty() {
            self.close_try();
        }
        while !self.handlers.is_empty() {
            self.handler();
        }
        while let Some(label) = self.ahead.pop() {
            self.bind(label);
        }
        self.plain_instruction(Opcode::Return);
    }

    fn referenced_ahead(&self) -> Option<usize> {
        let is_referenced = |label: &Label| self.program.is_referenced[label.word() as usize];
        self.ahead.iter().rposition(is_referenced)
    }

    fn step(&mut self) {
        if !self.is_reachable
            && self.random.one_in(2)
            && let Some(index) = self.referenced_ahead()
        {
            let label = self.ahead.remove(index);
            return self.bind(label);
        }
        match self.random.below(40) {
            0..4 if !self.ahead.is_empty() => {
                let index = self.random.below(self.ahead.len() as u32);
                let label = self.ahead.swap_remove(index as usize);
                self.bind(label);
            }
            4 => {
                let label = self.label();
                self.assembler.bind_loop_head(label);
                self.note_bound(label);
            }
            5..8 => self.instruction(Opcode::Goto),
            8 | 9 => {
                let kind = self
                    .random
                    .pick(&[HandlerKind::Catch, HandlerKind::Finally]);
                let handler = match self.handlers.pop() {
                    Some(handler) => handler,
                    None => self.label(),
                };
                self.assembler.push_try(handler, kind);
                self.tries.push((handler, kind));
            }
            10 | 11 => self.close_try(),
            12 => {
                let depth = self.random.below(self.tries.len() as u32 + 1);
                let suspended = self.assembler.suspend_tries(depth);
                let tries = self.tries.split_off(depth as usize);
                self.suspended.push((suspended, tries, depth as usize));
            }
            13 if !self.handlers.is_empty() => self.handler(),
            14..=20 => {
                let divot = self.random.skewed_below(1 << 20);
                let start = divot.saturating_sub(self.random.skewed_below(300));
                let end = divot + self.random.skewed_below(300);
                self.assembler.position(divot, start, end);
                self.position = Some(Position { divot, start, end });
            }
            21 | 22 if self.limits.suspends => {
                let opcode = self.random.pick(&[Opcode::Suspend, Opcode::Await]);
                self.instruction(opcode);
            }
            _ => {
                let opcode = self.random.pick(&Opcode::ALL);
                match opcode {
                    Opcode::Wide16Prefix
                    | Opcode::Wide32Prefix
                    | Opcode::Enter
                    | Opcode::ResumeDispatch
                    | Opcode::Catch
                    | Opcode::Resume => {}
                    Opcode::Suspend | Opcode::Await if !self.limits.suspends => {}
                    _ if SUSPENDING_ONLY.contains(&opcode) && !self.limits.suspends => {}
                    _ => self.instruction(opcode),
                }
            }
        }
    }

    fn label(&mut self) -> Label {
        self.program.labels.push(None);
        self.program.is_referenced.push(false);
        self.assembler.label()
    }

    fn bind(&mut self, label: Label) {
        let is_referenced = self.program.is_referenced[label.word() as usize];
        assert_eq!(self.assembler.is_referenced(label), is_referenced);
        self.assembler.bind(label);
        self.is_reachable |= is_referenced;
        self.note_bound(label);
    }

    fn note_bound(&mut self, label: Label) {
        assert_eq!(self.assembler.last(), None);
        if self.is_reachable {
            self.program.labels[label.word() as usize] = Some(self.program.emitted.len());
            self.behind.push(label);
        }
    }

    fn close_try(&mut self) {
        match self.suspended.last() {
            Some(&(_, _, depth)) if depth == self.tries.len() => {
                let (suspended, tries, _) = self.suspended.pop().unwrap();
                self.assembler.resume_tries(suspended);
                self.tries.extend(tries);
            }
            _ => {
                if let Some((handler, _)) = self.tries.pop() {
                    self.assembler.pop_try();
                    self.handlers.push(handler);
                }
            }
        }
    }

    fn handler(&mut self) {
        let handler = self.handlers.remove(0);
        self.instruction(Opcode::Goto);
        self.bind(handler);
        self.behind.retain(|&label| label != handler);
        self.plain_instruction(Opcode::Catch);
    }

    fn target(&mut self) -> Label {
        let label = match self.random.below(4) {
            0 if !self.behind.is_empty() => {
                let back = self.random.skewed_below(self.behind.len() as u32);
                self.behind[self.behind.len() - 1 - back as usize]
            }
            1 if !self.ahead.is_empty() => self.random.pick(&self.ahead),
            _ => {
                let label = self.label();
                self.ahead.push(label);
                label
            }
        };
        self.program.is_referenced[label.word() as usize] |= self.is_reachable;
        label
    }

    fn run(&mut self, count: u32) -> u32 {
        local(1 + self.random.skewed_below(self.limits.locals - count)).word()
    }

    fn writable(&mut self) -> u32 {
        if self.random.one_in(5) {
            let parameter = self.random.skewed_below(self.limits.parameters());
            Register::THIS.word() + parameter
        } else {
            self.run(1)
        }
    }

    fn frame(&mut self, arguments: u32) -> u32 {
        let least = (Register::HEADER_WORDS + arguments).next_multiple_of(2) + 2;
        least
            + 2 * self
                .random
                .skewed_below((self.limits.locals - least) / 2 + 1)
    }

    fn operands(&mut self, opcode: Opcode) -> (Vec<u32>, Vec<(i32, Label)>) {
        let Limits {
            locals, entries, ..
        } = self.limits;
        let count = match opcode {
            Opcode::NewObjectLiteral => self.random.below(NAME_LISTS),
            Opcode::CallWithSpread | Opcode::TailCallWithSpread => {
                1 + self.random.skewed_below(locals - 9)
            }
            _ => self.random.skewed_below(locals - 8),
        };
        let mut cases = vec![];
        let mut words: Vec<u32> = vec![];
        for &shape in opcode.shapes() {
            let word = match shape {
                Shape::Dst | Shape::DstIfJumps | Shape::DstUnlessJumps => self.writable(),
                Shape::Mut => loop {
                    let word = self.writable();
                    if words.first() != Some(&word) {
                        break word;
                    }
                },
                Shape::Src if opcode == Opcode::ThrowError => Operand::constant(STRING).word(),
                Shape::Src if self.random.one_in(3) => {
                    Operand::constant(STRING + self.random.skewed_below(entries - STRING)).word()
                }
                Shape::Src | Shape::Reg if self.random.one_in(10) => self
                    .random
                    .pick(&[Register::CALLEE, Register::SCOPE])
                    .word(),
                Shape::Src | Shape::Reg => self.writable(),
                Shape::Dst2 | Shape::Reg2 => self.run(2),
                Shape::Dst3 | Shape::Reg3 | Shape::Mut3 => self.run(3),
                Shape::First => self.run(count),
                Shape::Count => count,
                Shape::ArgumentCount => count.max(1),
                Shape::Frame => self.frame(count.max(1)),
                Shape::Frame1 => self.frame(2),
                Shape::Frame2 => self.frame(3),
                Shape::Target => self.target().word(),
                Shape::Unsigned if opcode == Opcode::HasShapeWithFlags => self.random.next() as u32,
                Shape::Unsigned => self.random.skewed_below(entries),
                Shape::Variables => self.random.skewed_below(locals),
                Shape::Parameter => self.random.skewed_below(self.limits.parameters() - 1),
                Shape::Flag => self.random.below(2),
                Shape::Name => self.random.skewed_below(entries),
                Shape::Names if opcode == Opcode::NewObjectLiteral => count,
                Shape::Names => self.random.below(NAME_LISTS),
                Shape::Function if opcode == Opcode::NewClass => CLASS,
                Shape::Function => FUNCTION,
                Shape::Scope if opcode == Opcode::CreateWithScope => WITH_SCOPE,
                Shape::Scope => BLOCK_SCOPE,
                Shape::ArrayConstant => ARRAY,
                Shape::RegExpConstant => REGEXP,
                Shape::IntSwitch => {
                    let spread = self.random.pick(&[4, 100, 5000, u32::MAX]);
                    for _ in 0..self.random.below(8) {
                        let key = self.random.below(spread).wrapping_sub(spread / 2) as i32;
                        if cases.iter().all(|&(other, _)| other != key) {
                            cases.push((key, self.target()));
                        }
                    }
                    let default = self.target();
                    let index = self.assembler.add_int_switch(default, &cases);
                    cases.push((0, default));
                    index.word()
                }
                Shape::StringSwitch => {
                    let targets: Vec<_> =
                        (0..self.random.below(4)).map(|_| self.target()).collect();
                    let default = self.target();
                    cases.extend((0..).zip(targets.iter().copied().chain([default])));
                    self.assembler.add_string_switch(default, &targets).word()
                }
                Shape::SpreadMask => {
                    let bits = self.random.below(4);
                    let bits = (0..count).map(|index| bits >> (index % 2) & 1 != 0);
                    self.assembler.add_spread_mask(bits).word()
                }
                Shape::SuspendPoint => {
                    let kind = match opcode {
                        Opcode::Await => SuspendKind::Await,
                        _ => SuspendKind::from_word(words[2]),
                    };
                    self.assembler.add_suspend_point(kind).word()
                }
                Shape::CoverageBlock => {
                    let block = CoverageBlock {
                        start: 1,
                        end: 2,
                        kind: CoverageKind::Plain,
                    };
                    self.assembler.add_coverage_block(block).word()
                }
                Shape::Unresolved => self.random.below(Unresolved::COUNT),
                Shape::ErrorKind => self.random.below(ErrorKind::COUNT),
                Shape::StaticError => self.random.below(StaticError::COUNT),
                Shape::SuspendKind => self.random.below(SuspendKind::COUNT),
                Shape::CloseMode => self.random.below(CloseMode::COUNT),
                Shape::ImportPhase => self.random.below(ImportPhase::COUNT),
                Shape::DebugHook => self.random.below(DebugHook::COUNT),
                Shape::ArrayShape => self.random.below(ArrayShape::COUNT),
                Shape::PutFlags => self.random.below(4),
                Shape::DefineFlags => self.random.below(16),
                Shape::CellType => self.random.below(256),
                Shape::Context => self.random.below(64),
            };
            words.push(word);
        }
        (words, cases)
    }

    fn instruction(&mut self, opcode: Opcode) {
        if opcode.shapes().contains(&Shape::Parameter) && self.limits.parameters() == 1 {
            return;
        }
        if self.is_reachable && self.referenced_ahead().is_none() {
            let label = self.label();
            self.ahead.push(label);
            self.program.is_referenced[label.word() as usize] = true;
            let words = vec![Register::THIS.word(), label.word()];
            self.emit(Opcode::JumpIfTrue, words, vec![]);
        }
        self.plain_instruction(opcode);
    }

    fn plain_instruction(&mut self, opcode: Opcode) {
        let (words, cases) = self.operands(opcode);
        let following = match opcode {
            Opcode::TailCall | Opcode::TailCallVarargs | Opcode::TailCallWithSpread => {
                Some((Opcode::Return, vec![words[0]]))
            }
            Opcode::Suspend | Opcode::Await => {
                Some((Opcode::Resume, vec![self.run(1), *words.last().unwrap()]))
            }
            _ => None,
        };
        self.emit(opcode, words, cases);
        if let Some((opcode, words)) = following {
            self.emit(opcode, words, vec![]);
        }
    }

    fn emit(&mut self, opcode: Opcode, words: Vec<u32>, cases: Vec<(i32, Label)>) {
        let site = self.assembler.here();
        if !self.is_reachable {
            emit(self.assembler, opcode, &words);
            assert_eq!(self.assembler.here(), site);
            return;
        }
        let this = Register::THIS;
        match self.random.below(8) {
            0 if opcode.flow().can_throw() => {
                self.assembler.call2(this, this, this, this, this, 0);
                self.assembler.replace(site, opcode, &words);
            }
            1 if words.len() <= 4 => {
                self.assembler.get_outer(this, this, 0, 0);
                self.assembler.replace(site, Opcode::LoopHint, &[]);
                self.assembler.replace(site, opcode, &words);
            }
            _ => emit(self.assembler, opcode, &words),
        }
        for (index, &word) in words.iter().enumerate() {
            assert_eq!(self.assembler.operand(site, index), word);
        }
        if opcode.flow().can_throw()
            && let Some(&(handler, _)) = self.tries.last()
        {
            self.program.is_referenced[handler.word() as usize] = true;
        }
        self.is_reachable = !matches!(opcode.flow(), Flow::Jumps | Flow::Ends);
        let last = self.is_reachable.then_some((site, opcode));
        assert_eq!(self.assembler.last(), last);
        self.program.emitted.push(Emitted {
            opcode,
            words,
            cases,
            position: self.position,
            tries: self.tries.clone(),
        });
    }
}
