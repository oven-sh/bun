//! Random programs that are well typed, keep their promises and come to an end.

mod accesses;
mod constants;
mod control;
mod floats;
mod graph;
mod integers;
mod patterns;
mod sites;
mod templates;
mod themes;
mod vectors;

use bun_engine_asm::{
    Cond, FloatCond, FloatWidth, Reg, RegisterSet, Sign, VectorBinary, VectorTernary, lanes,
};
use bun_engine_codegen::Target;
use bun_engine_codegen::ir::{
    Binary, Block, Boundary, Builder, Function, Heap, HeapRange, Lanes, Op, Origin, State, Type,
    Unary, Value, Variable,
};

use self::accesses::{Pointer, Spot};
use self::constants::Temper;
use self::control::Loop;
use super::datum::canonical_nan;
use super::memory::{
    ARGUMENTS_SIZE, ARGUMENTS_START, CALLEE_TABLE, CONSTANTS, DATA_SIZE, Input, Layout,
    OBJECT_COUNT, OBJECT_SIZE, OBJECT_TABLE, READ_ONLY_SIZE, Region, position,
};
use super::nodes;
use super::random::{Random, mix};
use super::vocabulary::{NOT_CELL_MASK, NUMBER_TAG, Registers, bank_of, registers};

/// How often each kind of statement is chosen, relative to the others.
#[derive(Clone, Copy, Debug)]
pub(crate) struct Weights {
    pub(crate) themes: u32,
    pub(crate) templates: u32,
    pub(crate) integers: u32,
    pub(crate) floats: u32,
    pub(crate) vectors: u32,
    pub(crate) accesses: u32,
    pub(crate) trapping_accesses: u32,
    pub(crate) atomics: u32,
    pub(crate) checks: u32,
    pub(crate) patchpoints: u32,
    pub(crate) calls: u32,
    /// Machine code cannot be generated for them.
    pub(crate) nodes: u32,
    pub(crate) variables: u32,
    pub(crate) branches: u32,
    pub(crate) loops: u32,
    pub(crate) switches: u32,
    pub(crate) graphs: u32,
    pub(crate) pressure: u32,
    pub(crate) shapes: u32,
    pub(crate) addressing: u32,
}

#[derive(Clone, Copy, Debug)]
pub(crate) struct Shape {
    /// About the number of statements.
    pub(crate) size: u32,
    pub(crate) weights: Weights,
    pub(crate) entries: u32,
    pub(crate) slots: u32,
    pub(crate) expression_depth: u32,
    pub(crate) nesting: u32,
    /// For the product of the trip counts of nested loops.
    pub(crate) trips: u32,
    /// The most parameters of a block.
    pub(crate) params: u32,
    /// How many in a hundred values that are used by nothing else are shown to a patchpoint, or else summed up.
    pub(crate) observed_percent: u32,
    /// How many in a thousand uses that want all bits determined take a value without.
    pub(crate) leaks_per_mille: u32,
    /// Lets the builder fold what it can. The seed gives the same program otherwise.
    pub(crate) folds: bool,
    /// About how many in a hundred of the registers that can be spared are pinned without a use.
    pub(crate) withheld_percent: u32,
}

pub(crate) const PROFILES: [&str; 17] = [
    "templates",
    "themes",
    "integer themes",
    "integers",
    "floats",
    "vectors",
    "memory",
    "branches",
    "loops",
    "graphs",
    "variables",
    "sites",
    "nodes",
    "shapes",
    "tangles",
    "selection",
    "everything",
];

impl Shape {
    pub(crate) fn of_profile(profile: &str, random: &mut Random) -> Self {
        let none = Weights {
            themes: 0,
            templates: 0,
            integers: 0,
            floats: 0,
            vectors: 0,
            accesses: 0,
            trapping_accesses: 0,
            atomics: 0,
            checks: 0,
            patchpoints: 0,
            calls: 0,
            nodes: 0,
            variables: 0,
            branches: 0,
            loops: 0,
            switches: 0,
            graphs: 0,
            pressure: 0,
            shapes: 0,
            addressing: 0,
        };
        let basic = Weights {
            themes: 4,
            templates: 6,
            integers: 30,
            floats: 4,
            accesses: 10,
            checks: 5,
            patchpoints: 2,
            calls: 1,
            nodes: 3,
            branches: 8,
            ..none
        };
        let everything = Weights {
            floats: 10,
            vectors: 6,
            trapping_accesses: 3,
            atomics: 1,
            patchpoints: 4,
            calls: 2,
            variables: 6,
            loops: 5,
            switches: 2,
            graphs: 2,
            pressure: 1,
            shapes: 4,
            addressing: 4,
            ..basic
        };
        let mut weights = match profile {
            "templates" => Weights {
                templates: 200,
                integers: 3,
                floats: 2,
                vectors: 1,
                accesses: 2,
                trapping_accesses: 1,
                checks: 1,
                branches: 3,
                ..none
            },
            "themes" => Weights {
                themes: 200,
                integers: 2,
                floats: 3,
                vectors: 2,
                accesses: 2,
                trapping_accesses: 1,
                checks: 1,
                ..none
            },
            "integer themes" => Weights {
                themes: 200,
                integers: 2,
                accesses: 2,
                checks: 2,
                branches: 5,
                ..none
            },
            "integers" => Weights {
                integers: 40,
                accesses: 3,
                checks: 4,
                branches: 1,
                ..none
            },
            "floats" => Weights {
                integers: 5,
                floats: 40,
                accesses: 3,
                branches: 6,
                loops: 4,
                ..none
            },
            "vectors" => Weights {
                integers: 5,
                floats: 3,
                vectors: 40,
                accesses: 5,
                branches: 1,
                ..none
            },
            "memory" => Weights {
                accesses: 50,
                trapping_accesses: 8,
                atomics: 2,
                addressing: 10,
                loops: 5,
                ..basic
            },
            "branches" => Weights {
                branches: 30,
                checks: 12,
                switches: 8,
                loops: 2,
                ..basic
            },
            "loops" => Weights {
                loops: 20,
                checks: 10,
                trapping_accesses: 3,
                ..basic
            },
            "graphs" => Weights {
                graphs: 15,
                loops: 3,
                switches: 3,
                ..basic
            },
            "variables" => Weights {
                variables: 30,
                loops: 8,
                graphs: 4,
                switches: 2,
                ..basic
            },
            "sites" => Weights {
                patchpoints: 25,
                calls: 12,
                pressure: 5,
                vectors: 5,
                loops: 4,
                ..basic
            },
            "nodes" => Weights {
                nodes: 50,
                loops: 6,
                switches: 3,
                graphs: 1,
                shapes: 3,
                ..basic
            },
            "shapes" => Weights {
                shapes: 40,
                trapping_accesses: 3,
                loops: 4,
                graphs: 2,
                ..basic
            },
            "tangles" => Weights {
                integers: 5,
                accesses: 40,
                graphs: 15,
                ..none
            },
            "selection" => Weights {
                templates: 60,
                addressing: 30,
                integers: 5,
                floats: 2,
                vectors: 1,
                accesses: 5,
                trapping_accesses: 1,
                atomics: 3,
                checks: 2,
                loops: 6,
                ..none
            },
            "everything" => everything,
            _ => panic!("the profiles are {PROFILES:?}"),
        };
        let is_long = random.one_in(40);
        if is_long {
            let Weights {
                checks,
                trapping_accesses,
                patchpoints,
                calls,
                nodes,
                ..
            } = &mut weights;
            for leaving in [checks, trapping_accesses, patchpoints, calls, nodes] {
                *leaving /= 5;
            }
        }
        let has_entries = matches!(profile, "graphs" | "variables" | "tangles" | "everything");
        Self {
            size: if is_long {
                300
            } else {
                random.pick(&[3, 6, 10, 16, 24, 40])
            },
            weights,
            entries: if has_entries && random.one_in(3) {
                random.between(2, 3) as u32
            } else {
                1
            },
            slots: random.pick(&[0, 0, 1, 2, 3]),
            expression_depth: random.between(1, 4) as u32,
            nesting: random.between(1, 4) as u32,
            trips: random.pick(&[8, 30, 100]),
            params: random.pick(&[1, 3, 6, 12]),
            observed_percent: random.pick(&[0, 10, 50, 100]),
            leaks_per_mille: random.pick(&[0, 0, 5, 30]),
            folds: random.one_in(4),
            withheld_percent: random.pick(&[0, 0, 50, 100]),
        }
    }
}

/// What is known of a value.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub(crate) enum Class {
    Data(Type),
    /// A scalar of which some bits may be open.
    Loose(Type),
    /// A vector with lanes of this format, of which those that are NaN may have open bits.
    LooseLanes(FloatWidth),
    /// A loose F64 that is likely to hold an F32, or to be wanted as one.
    Narrowable,
    /// Unsigned. With a guard, this holds only where a branch or check has found it.
    Index {
        ty: Type,
        below: u32,
        is_guarded: bool,
    },
    /// Neither 0 nor −1.
    Divisor(Type),
    Pointer(Pointer),
    /// The address of a function with this signature.
    Callee(usize),
    /// Can only be told from others.
    Identity,
}

impl Class {
    const BOOLEAN: Self = Self::Index {
        ty: Type::I32,
        below: 2,
        is_guarded: false,
    };

    fn ty(self) -> Type {
        match self {
            Self::Data(ty) | Self::Loose(ty) | Self::Index { ty, .. } | Self::Divisor(ty) => ty,
            Self::LooseLanes(_) => Type::V128,
            Self::Narrowable => Type::F64,
            Self::Pointer(_) | Self::Callee(_) | Self::Identity => Type::I64,
        }
    }

    fn guarded(self) -> Self {
        match self {
            Self::Index { ty, below, .. } => Self::Index {
                ty,
                below,
                is_guarded: true,
            },
            Self::Pointer(pointer) => Self::Pointer(pointer.guarded()),
            _ => self,
        }
    }

    fn has_determined_bits(self) -> bool {
        match self {
            Self::Loose(_) | Self::LooseLanes(_) | Self::Narrowable | Self::Identity => false,
            Self::Pointer(pointer) => pointer.region.segment().is_none(),
            _ => true,
        }
    }

    /// Whether a value of this class is also one of `wanted`.
    fn satisfies(self, wanted: Self) -> bool {
        match (self, wanted) {
            (Self::Loose(ty), Self::Loose(wanted)) => ty == wanted,
            (Self::Data(Type::V128), Self::LooseLanes(_)) => true,
            (Self::Narrowable, Self::Loose(Type::F64)) => true,
            (_, Self::Data(ty) | Self::Loose(ty)) => self.ty() == ty && self.has_determined_bits(),
            (
                Self::Index {
                    ty,
                    below,
                    is_guarded,
                },
                Self::Index {
                    ty: wanted,
                    below: limit,
                    is_guarded: may_be_guarded,
                },
            ) => ty == wanted && below <= limit && (may_be_guarded || !is_guarded),
            (Self::Pointer(pointer), Self::Pointer(wanted)) => pointer.satisfies(wanted),
            _ => self == wanted,
        }
    }
}

#[derive(Clone, Copy)]
struct Known {
    value: Value,
    class: Class,
    is_used: bool,
}

#[derive(Clone, Copy)]
struct KnownState {
    state: State,
    has_determined_bits: bool,
}

/// What dominates the place where code is added.
#[derive(Clone, Default)]
struct Scope {
    values: Vec<Known>,
    states: Vec<KnownState>,
    spots: Vec<Spot>,
    conditions: Vec<Value>,
    nodes: Vec<Value>,
}

#[derive(Clone, Copy)]
struct Mark {
    values: usize,
    states: usize,
    spots: usize,
    conditions: usize,
    nodes: usize,
    sum: Value,
}

#[derive(Clone)]
pub(crate) struct Program {
    pub(crate) function: Function,
    pub(crate) target: Target,
    /// For each entry.
    pub(crate) params: Vec<Vec<Class>>,
    /// Numbers that occur in the program, near which inputs make a difference.
    pub(crate) remarkable: Vec<i64>,
}

struct Generator<'a> {
    function: Function,
    random: Random,
    shape: Shape,
    target: Target,
    layout: &'a Layout,
    registers: &'static Registers,
    usable: RegisterSet,
    block: Block,
    next_origin: u32,
    next_token: u32,
    scope: Scope,
    /// Of the values that nothing else uses, unless `sum_variable` holds it.
    sum: Value,
    sum_variable: Option<Variable>,
    variables: Vec<(Variable, Class)>,
    heaps: Vec<(HeapRange, Heap)>,
    results: Vec<Type>,
    params: Vec<Vec<Class>>,
    loops: Vec<Loop>,
    favourite_constants: Vec<i64>,
    remarkable: Vec<i64>,
    depth: u32,
    nesting: u32,
    trips: u32,
}

fn withhold(seed: u64, shape: &Shape, registers: &Registers) -> RegisterSet {
    let mut random = Random::new(mix(seed, 5));
    let mut spare = (registers.usable | registers.allocatable_scratch) - registers.indispensable;
    if shape.weights.calls != 0 {
        spare -= registers.of_signatures;
    }
    let mut spare: Vec<Reg> = spare.into_iter().collect();
    random.shuffle(&mut spare);
    let mut withheld = RegisterSet::EMPTY;
    for reg in spare {
        let left = (registers.usable - withheld).in_bank(reg.bank()).len();
        if left > registers.least[reg.bank() as usize] && random.percent(shape.withheld_percent) {
            withheld.insert(reg);
        }
    }
    withheld
}

pub(crate) fn generate(seed: u64, shape: &Shape, target: Target, layout: &Layout) -> Program {
    let registers = registers(target);
    let withheld = withhold(seed, shape, registers);
    let mut generator = Generator {
        function: Function::new(RegisterSet::of(&registers.pinned, &[]) | withheld),
        random: Random::new(seed),
        shape: *shape,
        target,
        layout,
        registers,
        usable: registers.usable - withheld,
        block: Block::NONE,
        next_origin: 1,
        next_token: 1,
        scope: Scope::default(),
        sum: Value::NONE,
        sum_variable: None,
        variables: Vec::new(),
        heaps: Vec::new(),
        results: Vec::new(),
        params: Vec::new(),
        loops: Vec::new(),
        favourite_constants: Vec::new(),
        remarkable: vec![0],
        depth: 0,
        nesting: 0,
        trips: 1,
    };
    generator.declare();
    if shape.entries == 1 {
        let entry = generator.add_entry();
        generator.start_entry(entry);
        let mark = generator.mark_at_start();
        generator.body(shape.size);
        generator.finish_with_return(mark);
    } else {
        generator.graph_with_entries();
    }
    Program {
        function: generator.function,
        target,
        params: generator.params,
        remarkable: generator.remarkable,
    }
}

impl Program {
    pub(crate) fn input(&self, layout: &Layout, random: &mut Random) -> Input {
        let entry = random.below(self.params.len());
        let temper = Temper {
            level: random.below(5),
            remarkable: &self.remarkable,
        };
        let argument = |&class: &Class| constants::argument(class, temper, layout, random);
        let args = self.params[entry].iter().map(argument).collect();
        let mut bytes = |count: u32| -> Vec<u8> {
            let words = (0..count / 8).map(|_| constants::word(temper, random));
            words.flat_map(u64::to_le_bytes).collect()
        };
        let mut data = bytes(DATA_SIZE);
        let mut read_only = bytes(READ_ONLY_SIZE);
        let arguments = bytes(ARGUMENTS_SIZE);
        let put = |bytes: &mut [u8], offset: u32, word: u64| {
            bytes[offset as usize..][..8].copy_from_slice(&word.to_le_bytes());
        };
        for object in 0..OBJECT_COUNT {
            put(
                &mut data,
                object * OBJECT_SIZE,
                layout.object(random.next()),
            );
            put(
                &mut read_only,
                OBJECT_TABLE + 8 * object,
                layout.object(object.into()),
            );
        }
        for (offset, &callee) in (CALLEE_TABLE..CONSTANTS).step_by(8).zip(&layout.callees) {
            put(&mut read_only, offset, callee);
        }
        Input {
            entry,
            args,
            data,
            read_only,
            arguments,
        }
    }
}

impl Generator<'_> {
    fn declare(&mut self) {
        const UNIONS: [(u32, u32); 12] = [
            (0, 2),
            (0, 4),
            (1, 3),
            (1, 4),
            (2, 4),
            (3, 5),
            (4, 6),
            (4, 7),
            (5, 7),
            (0, 7),
            (7, 10),
            (8, 10),
        ];
        let leaves = (0..position::COUNT).map(|start| (start, start + 1));
        for (start, end) in leaves.chain(UNIONS) {
            let range = HeapRange { start, end };
            self.heaps.push((range, self.function.add_heap(range)));
        }
        self.heaps.push((HeapRange::ALL, Heap::EVERYTHING));
        if self.random.one_in(12) {
            for _ in 0..200 {
                let start = self.random.below(position::COUNT as usize) as u32;
                let range = HeapRange {
                    start,
                    end: start + self.random.pick(&[1, 1, 1, 2, 5]),
                };
                self.heaps.push((range, self.function.add_heap(range)));
            }
            self.random.shuffle(&mut self.heaps);
        }
        self.function.set_node_kinds(nodes::kinds());
        self.function.quiets_nans = self.random.flip();
        self.function.indexes_objects = self.random.percent(60);
        self.function.params_are_extended = self.random.flip();
        for _ in 0..self.shape.slots {
            let size = self.random.pick(&[4, 8, 8, 12, 16, 24, 32]);
            let alignment = self.random.pick(&[4, 8, 16]);
            self.function.add_slot(size, alignment);
        }
        if self.shape.slots != 0 {
            self.function.reserved_frame_bytes = self.random.pick(&[0, 8, 16, 32]);
        }
        self.function.outgoing_bytes = self.random.pick(&[0, 0, 0, 16, 40]);
        for _ in 0..self.random.between(1, 4) {
            let constant = constants::integer(Type::I64, &mut self.random);
            self.favourite_constants.push(constant);
        }
        let held = [self.layout.data_start(), NUMBER_TAG, NOT_CELL_MASK];
        for (reg, value) in self.registers.pinned.into_iter().zip(held) {
            if self.random.flip() {
                self.function.set_pinned_value(reg, value);
            }
            if self.random.one_in(4) {
                let distance = self
                    .random
                    .pick(&[0, 0, 2, -8, 4095, -4096, 0x1_0000, -0x12_3456]);
                self.favourite_constants
                    .push(value.wrapping_add_signed(distance) as i64);
            }
        }
        if self.shape.weights.variables != 0 {
            for _ in 0..self.random.between(1, 6) {
                let class = self.class_of_param();
                self.variables
                    .push((self.function.add_variable(class.ty()), class));
            }
            if self.random.flip() {
                self.sum_variable = Some(self.function.add_variable(Type::I64));
            }
        }
        self.results.push(Type::I64);
        for _ in 0..self.random.pick(&[0, 0, 1, 2, 5]) {
            let ty = self.data_type();
            self.results.push(ty);
        }
        let results = self.boundaries(&self.results.clone());
        self.function.set_results(&results);
    }

    fn boundaries(&mut self, types: &[Type]) -> Vec<Boundary> {
        let mut registers: Vec<Reg> = self.usable.into_iter().collect();
        let mut offsets: Vec<i32> = (0..ARGUMENTS_SIZE as i32).step_by(16).collect();
        self.random.shuffle(&mut registers);
        self.random.shuffle(&mut offsets);
        let frame_percent = self.random.pick(&[0, 0, 30, 100]);
        let place = |&ty: &Type| {
            let free = registers.iter().position(|reg| reg.bank() == bank_of(ty));
            match free {
                Some(index) if offsets.is_empty() || !self.random.percent(frame_percent) => {
                    Boundary::Register(registers.swap_remove(index))
                }
                _ => {
                    let half = if ty == Type::V128 {
                        0
                    } else {
                        self.random.pick(&[0, 8])
                    };
                    Boundary::Frame(ARGUMENTS_START + offsets.pop().unwrap() + half)
                }
            }
        };
        types.iter().map(place).collect()
    }

    fn add_entry(&mut self) -> Block {
        let mut classes = vec![Class::Data(Type::I64), Class::Data(Type::I32)];
        for _ in 0..self.random.between(1, 8) {
            let class = match self.class_of_param() {
                class @ (Class::Loose(_)
                | Class::LooseLanes(_)
                | Class::Narrowable
                | Class::Identity) => Class::Data(class.ty()),
                Class::Pointer(_) => Class::Pointer(Pointer::ANY_OBJECT),
                class => class,
            };
            classes.push(class);
        }
        self.random.shuffle(&mut classes);
        let types: Vec<Type> = classes.iter().map(|class| class.ty()).collect();
        let boundaries = self.boundaries(&types);
        let params: Vec<_> = types.into_iter().zip(boundaries).collect();
        self.params.push(classes);
        self.function.add_entry(&params)
    }

    fn start_entry(&mut self, entry: Block) {
        self.block = entry;
        let index = self
            .function
            .entries()
            .iter()
            .position(|known| known.block == entry);
        let classes = self.params[index.unwrap()].clone();
        for (param, class) in self
            .function
            .params(entry)
            .to_vec()
            .into_iter()
            .zip(classes)
        {
            self.keep(param, class);
        }
        let zero = self.function.const64(0);
        self.set_sum(zero);
        self.initialize_frame();
        for (variable, class) in self.variables.clone() {
            let initial = self.value_of(class);
            self.builder().set(variable, initial);
        }
    }

    // Types and classes

    fn int_type(&mut self) -> Type {
        self.random.pick(&[Type::I32, Type::I64])
    }

    fn float_type(&mut self) -> Type {
        self.random.pick(&[Type::F32, Type::F64])
    }

    fn data_type(&mut self) -> Type {
        let Weights {
            integers,
            floats,
            vectors,
            ..
        } = self.shape.weights;
        self.random.weighted(&[
            (integers, Type::I32),
            (integers, Type::I64),
            (floats, Type::F32),
            (floats, Type::F64),
            (2 * vectors, Type::V128),
        ])
    }

    fn class_of_param(&mut self) -> Class {
        let ty = self.data_type();
        match self.random.below(16) {
            0 | 1 if self.shape.weights.accesses != 0 => Class::Pointer(self.class_of_pointer()),
            2 | 3 if ty.is_int() => Class::Index {
                ty,
                below: self.random.pick(&[2, 4, 8, 16, 100]),
                is_guarded: self.random.flip(),
            },
            4 if ty.is_int() => Class::Divisor(ty),
            5 if self.shape.weights.calls != 0 => Class::Callee(self.signature_index()),
            6 if self.shape.weights.nodes > 10 => Class::Identity,
            6..9 if ty.is_float() => Class::Narrowable,
            6..11 if ty.is_float() => Class::Loose(ty),
            6..11 if ty == Type::V128 => Class::LooseLanes(self.float_type().float_width()),
            _ => Class::Data(ty),
        }
    }

    // The scope

    fn keep(&mut self, value: Value, class: Class) -> Value {
        debug_assert!(self.function.type_of(value) == class.ty());
        self.scope.values.push(Known {
            value,
            class,
            is_used: false,
        });
        value
    }

    /// Of the value that was kept last, which is about to be an operand.
    fn count_as_used(&mut self) {
        let is_used = !self.random.one_in(8);
        self.scope.values.last_mut().unwrap().is_used = is_used;
    }

    /// For what has been learnt of a value that is in scope already.
    fn learn(&mut self, value: Value, class: Class) {
        self.scope.values.push(Known {
            value,
            class,
            is_used: true,
        });
    }

    fn mark(&self) -> Mark {
        Mark {
            values: self.scope.values.len(),
            states: self.scope.states.len(),
            spots: self.scope.spots.len(),
            conditions: self.scope.conditions.len(),
            nodes: self.scope.nodes.len(),
            sum: self.sum,
        }
    }

    fn mark_at_start(&self) -> Mark {
        Mark {
            values: 0,
            ..self.mark()
        }
    }

    fn restore(&mut self, mark: Mark) {
        self.scope.values.truncate(mark.values);
        self.scope.states.truncate(mark.states);
        self.scope.spots.truncate(mark.spots);
        self.scope.conditions.truncate(mark.conditions);
        self.scope.nodes.truncate(mark.nodes);
        self.sum = mark.sum;
    }

    /// Prefers recent values.
    fn find_position(&mut self, wanted: impl Fn(Class) -> bool) -> Option<usize> {
        let count = self.scope.values.len();
        let skipped = match self.random.below(4) {
            0 => 0,
            1 | 2 => self.random.below(count.min(6) + 1),
            _ => self.random.below(count + 1),
        };
        let mut positions = (0..count - skipped).rev().chain(count - skipped..count);
        let found = positions.find(|&position| wanted(self.scope.values[position].class))?;
        self.scope.values[found].is_used = true;
        Some(found)
    }

    fn find(&mut self, wanted: impl Fn(Class) -> bool) -> Option<(Value, Class)> {
        let found = self.find_position(wanted)?;
        let Known { value, class, .. } = self.scope.values[found];
        Some((value, class))
    }

    fn leaks(&mut self) -> bool {
        self.random.below(1000) < self.shape.leaks_per_mille as usize
    }

    fn value_of(&mut self, class: Class) -> Value {
        match class {
            Class::Data(ty) => self.data(ty),
            Class::Loose(ty) => self.loose(ty).0,
            Class::LooseLanes(width) => self.vector(Some(width)).0,
            _ if self.random.percent(70)
                && let Some((found, _)) = self.find(|known| known.satisfies(class)) =>
            {
                found
            }
            Class::Index { ty, below, .. } => self.fresh_index(ty, below),
            Class::Divisor(ty) => self.fresh_divisor(ty),
            Class::Pointer(pointer) => self.fresh_pointer_for(pointer),
            Class::Callee(signature) => self.fresh_callee(signature),
            Class::Identity => self.fresh_identity(),
            Class::Narrowable => self.fresh_narrowable(),
        }
    }

    /// With all bits determined.
    fn data(&mut self, ty: Type) -> Value {
        if ty.is_int() {
            return self.int(ty);
        }
        let (value, class) = self.loose(ty);
        if self.leaks() {
            value
        } else {
            self.settle(value, class)
        }
    }

    fn loose(&mut self, ty: Type) -> (Value, Class) {
        match ty {
            Type::I32 | Type::I64 => self
                .find(|known| known == Class::Loose(ty))
                .unwrap_or_else(|| (self.int(ty), Class::Data(ty))),
            Type::V128 => {
                let width = self.float_type().float_width();
                self.vector(Some(width))
            }
            _ => self.float(ty),
        }
    }

    /// Replaces NaNs by the canonical one, unless they are determined.
    fn settle(&mut self, value: Value, class: Class) -> Value {
        let ty = class.ty();
        if class.has_determined_bits() || ty.is_int() {
            return value;
        }
        let settled = if let Class::LooseLanes(width) = class {
            let equal = match width {
                FloatWidth::F32 => VectorBinary::F32x4Eq,
                FloatWidth::F64 => VectorBinary::F64x2Eq,
            };
            let is_number = self.emit(Op::VectorBinary(equal, [value, value]), ty);
            let nan = self.splat_constant(width.width().size(), canonical_nan(width));
            self.emit(
                Op::VectorTernary(VectorTernary::Bitselect, [value, nan, is_number]),
                ty,
            )
        } else if ty == Type::F64 && self.random.percent(70) {
            self.unary(Unary::CanonicalizeNan, ty, value)
        } else {
            let nan = self.function.constant(ty, canonical_nan(ty.float_width()));
            let cond = self
                .random
                .pick(&[FloatCond::Eq, FloatCond::Ordered, FloatCond::Le]);
            if self.random.flip() {
                let is_number = self.float_compare(cond, value, value);
                self.select(is_number, value, nan)
            } else {
                let is_nan = self.float_compare(cond.inverted(), value, value);
                self.select(is_nan, nan, value)
            }
        };
        self.learn(settled, Class::Data(ty));
        settled
    }

    // The sum

    fn get_sum(&mut self) -> Value {
        match self.sum_variable {
            Some(variable) => self.builder().get(variable),
            None => self.sum,
        }
    }

    fn set_sum(&mut self, sum: Value) {
        match self.sum_variable {
            Some(variable) => self.builder().set(variable, sum),
            None => self.sum = sum,
        }
    }

    fn add_to_sum(&mut self, value: Value) {
        let word = match self.function.type_of(value) {
            Type::I32 => {
                let sign = self.random.pick(&[Sign::Signed, Sign::Unsigned]);
                self.unary(Unary::Widen(sign), Type::I64, value)
            }
            Type::F32 => {
                let bits = self.unary(Unary::Bitcast, Type::I32, value);
                self.unary(Unary::Widen(Sign::Unsigned), Type::I64, bits)
            }
            Type::F64 => self.unary(Unary::Bitcast, Type::I64, value),
            Type::V128 => {
                let lanes = Lanes::Int(bun_engine_asm::Size::S64);
                let [low, high] = [0, 1].map(|lane| {
                    self.builder()
                        .extract_lane(lanes, Sign::Unsigned, value, lane)
                });
                self.add_to_sum(low);
                high
            }
            _ => value,
        };
        let sum = self.get_sum();
        let stirred = match self.random.below(3) {
            0 => self.binary_constant(Binary::Mul, sum, 31),
            1 => self.binary_constant(Binary::RotateLeft, sum, 7),
            _ => sum,
        };
        let op = self.random.pick(&[Binary::Add, Binary::Xor, Binary::Sub]);
        let sum = self.binary(op, stirred, word);
        self.set_sum(sum);
    }

    /// Makes most of the values since the mark matter.
    fn use_up(&mut self, mark: Mark) {
        let mut shown = Vec::new();
        for index in mark.values..self.scope.values.len() {
            let known = &mut self.scope.values[index];
            let Known { value, class, .. } = *known;
            if std::mem::replace(&mut known.is_used, true) || self.random.one_in(10) {
                continue;
            }
            if self.random.percent(self.shape.observed_percent)
                || class.ty().is_int() && !class.has_determined_bits()
            {
                shown.push(value);
            } else {
                let settled = self.settle(value, class);
                self.add_to_sum(settled);
            }
        }
        if !shown.is_empty() {
            self.observe(&shown);
        }
    }

    // Instructions

    fn builder(&mut self) -> Builder<'_> {
        let mut builder = Builder::at_end(&mut self.function, self.block);
        builder.origin = Origin(self.next_origin);
        self.next_origin += 1;
        builder
    }

    fn emit(&mut self, op: Op, ty: Type) -> Value {
        self.builder().insert(op, ty)
    }

    fn type_of(&self, value: Value) -> Type {
        self.function.type_of(value)
    }

    fn constant(&mut self, ty: Type, value: i64) -> Value {
        self.function.constant(ty, value as u64)
    }

    fn unary(&mut self, op: Unary, to: Type, operand: Value) -> Value {
        match op {
            _ if !self.shape.folds => self.emit(Op::Unary(op, operand), to),
            Unary::Wrap => self.builder().wrap(operand),
            _ => self.builder().convert(op, to, operand),
        }
    }

    fn binary(&mut self, op: Binary, lhs: Value, rhs: Value) -> Value {
        if self.shape.folds {
            self.builder().binary(op, lhs, rhs)
        } else {
            self.emit(Op::Binary(op, [lhs, rhs]), self.type_of(lhs))
        }
    }

    fn binary_constant(&mut self, op: Binary, lhs: Value, rhs: i64) -> Value {
        let ty = if op.is_shift() {
            Type::I32
        } else {
            self.type_of(lhs)
        };
        let rhs = self.constant(ty, rhs);
        self.binary(op, lhs, rhs)
    }

    /// With the operands in either order.
    fn commutative(&mut self, op: Binary, a: Value, b: Value) -> Value {
        debug_assert!(op.is_commutative());
        if self.random.flip() {
            self.binary(op, a, b)
        } else {
            self.binary(op, b, a)
        }
    }

    /// With the operands in either order.
    fn compare(&mut self, cond: Cond, lhs: Value, rhs: Value) -> Value {
        let (cond, lhs, rhs) = if self.random.one_in(4) {
            (cond.commuted(), rhs, lhs)
        } else {
            (cond, lhs, rhs)
        };
        if self.shape.folds {
            self.builder().compare(cond, lhs, rhs)
        } else {
            self.emit(Op::Compare(cond, [lhs, rhs]), Type::I32)
        }
    }

    fn compare_constant(&mut self, cond: Cond, lhs: Value, rhs: i64) -> Value {
        let rhs = self.constant(self.type_of(lhs), rhs);
        self.compare(cond, lhs, rhs)
    }

    fn float_compare(&mut self, cond: FloatCond, lhs: Value, rhs: Value) -> Value {
        if self.shape.folds {
            self.builder().float_compare(cond, lhs, rhs)
        } else {
            self.emit(Op::FloatCompare(cond, [lhs, rhs]), Type::I32)
        }
    }

    fn select(&mut self, condition: Value, then: Value, or: Value) -> Value {
        if self.shape.folds {
            self.builder().select(condition, then, or)
        } else {
            self.emit(Op::Select([condition, then, or]), self.type_of(then))
        }
    }

    fn splat_constant(&mut self, size: bun_engine_asm::Size, bits: u64) -> Value {
        self.function.const_v128(lanes::splat(size, bits))
    }

    fn start_of(&self, region: Region) -> u64 {
        self.layout.start_of(&self.function, region)
    }
}
