//! From nodes to the instructions of the back end, and on to machine code.

mod arrays;
mod calls;
mod collections;
mod comparisons;
mod direct;
mod elements;
mod emit;
mod foreign;
mod instructions;
mod iteration;
mod numbers;
mod objects;
mod operations;
mod operators;
pub(crate) mod output;
mod places;
mod probes;
mod prototypes;
mod ropes;
mod strings;
mod suspension;
mod truth;
mod typed_arrays;
mod types;
mod validate;
mod wasm;
mod ways;

use std::hash::{BuildHasher, RandomState};

use bun_engine_asm::{Features, MacroAssembler, MacroAssembly, RegisterSet, Sign, Size, abi};
use bun_engine_baseline::ic::{Entries, entries};
use bun_engine_codegen::ir::{
    self, Access, AccessFlags, Action, Block, Effects, Entity, Exit, Function, Heap, Op, Origin,
    PatchpointData, State, Table, Token, Type, Value as Ssa,
};
use bun_engine_vm::Forbidden;

pub(crate) use self::emit::Threw;
use self::emit::{Emitter, Site, Tables};
use self::output::Output;
use self::ways::Odds;
use crate::builder::{Built, Refusal};
use crate::graph::probes::{are_checks_probed, is_wanted};
use crate::graph::{ExitKind, FormCall, Graph, Kind};
use crate::runtime::Thunks;
use crate::runtime::operations::collections::{MAP_SET, SET_ADD, WEAK_MAP_SET, WEAK_SET_ADD};
use crate::runtime::operations::suspension::THROW;
use crate::runtime::operations::{
    POWER, TO_ARGUMENT_LIST, elements::SPREAD, math_function, methods,
};

/// Keeps its memory from one function to the next.
#[derive(Default)]
pub(crate) struct Compiler {
    sites: Vec<Site>,
    forbidden: Vec<Forbidden>,
    tables: Tables,
    back_end: bun_engine_codegen::Compiler,
}

impl Compiler {
    pub(crate) fn compile(
        &mut self,
        mut graph: Graph,
        thunks: &Thunks,
        records_origins: bool,
        observe: impl Fn(&str, &Function),
    ) -> Built<Output> {
        self.sites.clear();
        self.forbidden.clear();
        lower(&mut graph, &mut self.sites, &mut self.forbidden)?;
        observe("lowering", &graph.function);
        let mut masm = MacroAssembler::new(bun_engine_asm::Options {
            features: Features::host(),
            shorten_jumps: true,
            seed: RandomState::new().hash_one(()),
        });
        let options = bun_engine_codegen::Options {
            level: graph.level,
            records_origins,
        };
        let mut function =
            core::mem::replace(&mut graph.function, Function::new(RegisterSet::EMPTY));
        let mut emitter = Emitter::new(
            &graph,
            thunks,
            &self.sites,
            &self.forbidden,
            &mut self.tables,
        );
        let compiled = (self.back_end)
            .compile(&mut function, options, &mut masm, &mut emitter)
            .map_err(|_| Refusal::TooLarge)?;
        observe("the back end", &function);
        let code = masm.finish().map_err(|_| Refusal::TooLarge)?;
        Ok(self.tables.finish(code, &compiled, graph))
    }
}

struct Lowering<'a> {
    graph: &'a mut Graph,
    /// By the tokens of patchpoints.
    sites: &'a mut Vec<Site>,
    /// The same, if effects are validated.
    forbidden: &'a mut Vec<Forbidden>,
    /// The node that is being replaced.
    at: Ssa,
    origin: Origin,
    state: State,
    /// Instructions go to its end. If there is none, they go before the node.
    open: Block,
    shadow_frame: Option<ir::Slot>,
    /// In a build with assertions.
    allocated: Vec<validate::Allocated>,
    uses: Table<Ssa, u8>,
    /// The blocks that the node has made to end with a jump to where its ways meet.
    arrivals: Vec<Block>,
    entries: &'static Entries<usize>,
}

fn lower(graph: &mut Graph, sites: &mut Vec<Site>, forbidden: &mut Vec<Forbidden>) -> Built {
    let mut lowering = Lowering {
        uses: ways::count_uses(&graph.function),
        arrivals: Vec::new(),
        graph,
        sites,
        forbidden,
        at: Ssa::NONE,
        origin: Origin::default(),
        state: State::NONE,
        open: Block::NONE,
        shadow_frame: None,
        allocated: Vec::new(),
        entries: entries().ok_or(Refusal::Unsupported)?,
    };
    for block in (0..lowering.graph.function.block_count()).map(Block::from_index) {
        if !lowering.graph.function.is_removed(block) {
            lowering.walk(block)?;
        }
    }
    debug_assert!(!lowering.graph.lacks_state);
    if lowering.graph.lacks_state {
        return Err(Refusal::Unsupported);
    }
    let function = &mut lowering.graph.function;
    function.resolve_aliases();
    if cfg!(debug_assertions)
        && let Err(problem) = validate::validate(function, &lowering.allocated)
    {
        panic!("after lowering: {problem}\n{function:?}");
    }
    Ok(())
}

impl Lowering<'_> {
    /// From the end, so that what follows a split moves once, and operands are still nodes.
    fn walk(&mut self, block: Block) -> Built {
        let mut value = self.graph.function.last(block);
        while !value.is_none() {
            let previous = self.graph.function.previous(value);
            if let Some((kind, data)) = self.graph.node(value) {
                let function = &self.graph.function;
                (self.at, self.origin, self.state) =
                    (value, function.origin(value), function.state_of(value));
                self.arrivals.clear();
                self.probe_before(kind, data);
                match self.lower(kind, data)? {
                    Some(replacement) => {
                        self.graph.function.replace(value, replacement);
                        self.branch_directly(value, replacement);
                    }
                    None => self.graph.function.remove(value),
                }
            } else {
                self.tie_to_checks(value);
            }
            value = previous;
        }
        Ok(())
    }

    /// Once checks give nothing any more, only their place tells what relies on them.
    fn tie_to_checks(&mut self, value: Ssa) {
        let function = &mut self.graph.function;
        if let Op::Load {
            address, access, ..
        } = *function.op(value)
            && access.has(AccessFlags::ALWAYS_READABLE)
            && !function.op(address).is_floating()
            && let Op::Load { access, .. } = function.op_mut(value)
        {
            *access = Access::new(access.heap(), access.flags() - AccessFlags::ALWAYS_READABLE);
        }
    }

    /// Gives what takes the place of the node, if it has a value.
    fn lower(&mut self, kind: Kind, data: u32) -> Built<Option<Ssa>> {
        let operand = |position| {
            let operands = self.graph.function.operands(self.at);
            operands.get(position).copied().unwrap_or(Ssa::NONE)
        };
        let (first, second) = (operand(0), operand(1));
        match kind {
            Kind::InvalidationPoint => self.invalidation_point(),
            Kind::ForceExit => self.force_exit(ExitKind::from_u8(data as u8)),
            Kind::PollTraps => self.poll_traps(),
            Kind::TierUpInLoop => self.tier_up_in_loop(),
            Kind::CountTurn => self.count_turn(),
            Kind::TierUpAtReturn => self.tier_up_at_return(),
            Kind::KeepAlive => self.keep_alive(first),
            Kind::Verify => self.verify(data),
            Kind::StoreBarrier if self.operands().len() > 2 => self.store_barrier(first, Ssa::NONE),
            Kind::StoreBarrier => self.store_barrier(first, second),
            Kind::MayHaveFired | Kind::MayHaveSetLastIndex => {}
            Kind::Refine | Kind::Assume | Kind::RefineShape | Kind::Unproven | Kind::InBounds => {}
            Kind::CheckType => self.check_type(first, self.graph.type_check_at(data)),
            Kind::CheckShape => self.check_shape(first, data),
            Kind::CheckModes => self.check_modes(first, self.graph.mode_check_at(data)),
            Kind::CheckOriginalArray => self.check_original_array(first, second),
            Kind::CheckSpeciesIsArray => self.check_species_is_array(first),
            Kind::SetLength => self.set_length(first, second, data),
            Kind::MapSet => _ = self.call_or_exit(MAP_SET),
            Kind::SetAdd => _ = self.call_or_exit(SET_ADD),
            Kind::WeakMapSet => _ = self.call_or_exit(WEAK_MAP_SET),
            Kind::WeakSetAdd => _ = self.call_or_exit(WEAK_SET_ADD),
            Kind::CopyView => self.copy_view(first, second),
            Kind::AsName => self.as_name(first, self.graph.interned_type(data)),
            Kind::CheckText => self.check_text(first, second),
            Kind::StorePlainElement => self.store_plain_element(),
            Kind::CheckIdentical => self.check_identical(first, second),
            Kind::CheckExecutable => self.check_executable(first, second),
            Kind::CheckBounds => self.check_bounds(first, second),
            Kind::ResolveRope => self.resolve_rope(first),
            Kind::CheckViewEndsAt => self.check_view_ends_at(first, second),
            Kind::Await => self.await_value(self.graph.type_check_at(data)),
            Kind::Throw => {
                self.call_operation(THROW, &[first]);
                self.ir().unreachable();
            }
            Kind::SetShape => self.set_shape(first, data),
            Kind::SetTime => self.set_time(first, second),
            Kind::CallCustomSetter => _ = self.call_custom(&[]),
            Kind::TailCall | Kind::DirectTailCall | Kind::NativeTailCall => self.tail_call(kind),
            Kind::TailCallVarargs => {
                self.call_varargs(kind, data);
                self.ir().unreachable();
            }
            _ => return self.compute(kind, data, first, second).map(Some),
        }
        Ok((self.graph.function.type_of(self.at) != Type::Void).then_some(first))
    }

    fn compute(&mut self, kind: Kind, data: u32, first: Ssa, second: Ssa) -> Built<Ssa> {
        Ok(match kind {
            Kind::BoxInt32 => self.box_int32(first),
            Kind::BoxInt52 => self.box_int52(first),
            Kind::BoxDouble => self.box_double(first, data),
            Kind::BoxBoolean => self.box_boolean(first),
            Kind::NumberToDouble => self.number_to_double(first, data != 0),
            Kind::PrimitiveToDouble => self.primitive_to_double(first),
            Kind::TruncateDouble => self.truncate_double(first),
            Kind::DoubleAsInt32 => self.double_as_int32(first, ExitKind::from_u8(data as u8)),
            Kind::DoubleAsInt52 => self.double_as_int52(first, ExitKind::from_u8(data as u8)),
            Kind::DoubleRemainder => self.double_remainder(first, second),
            Kind::DoublePower => self.call_leaf(POWER, &[first, second], Type::F64),
            Kind::MathFunction => self.call_leaf(math_function(data), &[first], Type::F64),
            Kind::IsType => self.is_type(first, self.graph.type_check_at(data)),
            Kind::IsCellOfType => self.is_cell_of_type(first, data),
            Kind::LoadShapeId => self.shape_id(first),
            Kind::LoadExecutable => self.load_executable(first),
            Kind::Cached => self.cached(data),
            Kind::SearchAndLoad => self.search_and_load(data),
            Kind::SearchForStore => self.search_for_store(data),
            Kind::GrowSlots => self.grow_slots(first, data),
            Kind::MakeRoom => self.make_room(first, second),
            Kind::NewArray => self.new_array(data),
            Kind::NewArrayOfHoles => self.new_array_of_holes(first, second, data),
            Kind::NewArrayFromFrame => self.new_array_from_frame(first, second, data),
            Kind::CopyElements => self.copy_elements(first, second, data),
            Kind::Push => self.call_or_exit(methods::PUSH),
            Kind::Unshift => self.call_or_exit(methods::UNSHIFT),
            Kind::Pop => self.call_or_exit(methods::POP),
            Kind::Shift | Kind::ShiftWritable => self.call_or_exit(methods::SHIFT),
            Kind::Slice => self.call_or_exit(methods::SLICE),
            Kind::Splice => self.splice(),
            Kind::FindElement => self.find_element(data),
            Kind::FindWord => self.find_word(),
            Kind::NormalizeKey => self.normalize_key(first),
            Kind::HashKey => self.hash_key(first),
            Kind::HashString => self.hash_string(first),
            Kind::FindEntry => self.find_entry(first, second, data),
            Kind::RemoveEntry => self.remove_entry(data),
            Kind::WeakMapGet => self.weak_map_get(first, second),
            Kind::HasWeakEntry => self.has_weak_entry(first, second),
            Kind::ShareList => self.share_list(first, data),
            Kind::NewArguments => self.allocate_object(data),
            Kind::NewTypedArray => self.new_typed_array(first, second, data),
            Kind::HashName => self.hash_name(first, self.graph.interned_type(data)),
            Kind::HasOwn => self.has_own(first, second, self.graph.interned_type(data)),
            Kind::NewArgumentsFromFrame => self.new_arguments_from_frame(first, second, data),
            Kind::NewList => self.new_list(data),
            Kind::Spread => self.call_operation(SPREAD, &[first]),
            Kind::SpreadElements => self.spread_elements(first),
            Kind::NewArrayWithSpread => self.new_array_with_spread(),
            Kind::CopyToMemory => self.copy_to_memory(&self.operands()),
            Kind::HasModes => self.has_modes(first, self.graph.mode_check_at(data)),
            Kind::LookUpElement => self.look_up_element(first, second),
            Kind::LookUpName => self.look_up_name(first, second),
            Kind::HasElement => self.has_element(first, second),
            Kind::SizeAsInt32 => self.size_as_int32(first),
            Kind::DoubleAsIndex => self.double_as_index(first),
            Kind::HalfToDouble => self.half_to_double(first),
            Kind::DoubleToHalf => self.double_to_half(first),
            Kind::BigIntFromDigit => self.bigint_from_digit(first, second, data),
            Kind::BigIntInRange => self.bigint_in_range(first, data),
            Kind::BigIntToBits => self.bigint_to_bits(first),
            Kind::UpdateViewLength => self.update_view_length(first),
            Kind::CurrentViewOffset => self.current_view_offset(first),
            Kind::CurrentViewLength => self.current_view_length(first, data),
            Kind::NewObject => self.new_object(data),
            Kind::NewScope => self.new_scope(first, second, data),
            Kind::NewFunction => self.new_function(first, second, data),
            Kind::StringLength => self.string_length(first),
            Kind::StringUnitAt => self.string_unit_at(first, second),
            Kind::StringCodePointAt => self.string_code_point_at(first, second),
            Kind::DateFields => self.date_fields(first, data as usize),
            Kind::StringFromUnit => self.string_from_unit(first),
            Kind::Call | Kind::Construct | Kind::DirectCall | Kind::DirectConstruct => {
                self.call(kind)
            }
            Kind::NativeCall | Kind::NativeConstruct => self.call(kind),
            Kind::CallVarargs | Kind::ConstructVarargs => self.call_varargs(kind, data),
            Kind::CallWasm
            | Kind::CallWasmForInt32
            | Kind::CallWasmForInt64
            | Kind::CallWasmForDouble
            | Kind::CallWasmForValue => self.call_wasm(data),
            Kind::ToArgumentList => self.call_operation(TO_ARGUMENT_LIST, &[first]),
            Kind::CallCustomGetter => self.call_custom_getter(),
            Kind::CallClock => self.call_clock(first, second),
            Kind::CallForeign | Kind::CallForeignForFloat => self.call_foreign(data),
            Kind::BoxForeignInteger => self.box_foreign_integer(first, data),
            Kind::ShadowFrame => self.shadow_frame(),
            Kind::Interpret => self.interpret(data, first, second)?,
            _ if kind.calls_form() => self.do_as_form(FormCall::from_data(data)),
            _ => return self.compute_for_operator(kind, data, first, second),
        })
    }

    #[inline]
    fn ir(&mut self) -> ir::Builder<'_> {
        let Some(open) = self.open.expand() else {
            return ir::Builder::before(&mut self.graph.function, self.at);
        };
        let mut builder = ir::Builder::at_end(&mut self.graph.function, open);
        builder.origin = self.origin;
        builder
    }

    fn operands(&self) -> smallvec::SmallVec<[Ssa; 8]> {
        self.graph.function.operands(self.at).into()
    }

    #[cfg_attr(debug_assertions, track_caller)]
    fn exit(&mut self, kind: ExitKind) -> Exit {
        let exit = self.graph.exit(kind, self.origin, self.state);
        if are_checks_probed() && self.has_effect() {
            self.graph.unforced_exits.push(exit.token.0);
        }
        exit
    }

    #[cfg_attr(debug_assertions, track_caller)]
    fn exit_if(&mut self, condition: Ssa, kind: ExitKind) {
        let exit = self.exit(kind);
        self.ir().check(condition, exit);
    }

    /// For when `value` is not what has been predicted.
    #[cfg_attr(debug_assertions, track_caller)]
    fn exit_blaming(&mut self, value: Ssa, kind: ExitKind) -> Exit {
        let (root, exit) = (self.graph.root(value), self.exit(kind));
        let held = self.graph.function.state(self.state);
        self.graph.exits[exit.token.0 as usize].culprit =
            self.graph.profile(root).and_then(|profile| {
                let position = held.iter().position(|&it| self.graph.root(it) == root)?;
                Some((position as u32, profile))
            });
        exit
    }

    fn patchpoint(&mut self, action: Action, site: Site, effects: Effects) -> PatchpointData {
        self.sites.push(site);
        if is_wanted(|it| it.validate_effects) {
            let kind = self.graph.kind(self.at).expect("a node");
            self.forbidden.push(self.graph.forbidden_during(kind));
        }
        PatchpointData::new(action, Token(self.sites.len() as u32 - 1), effects)
    }

    fn vm(&mut self) -> Ssa {
        self.graph.function.pinned(abi::VM)
    }

    fn word(&mut self, bits: u64) -> Ssa {
        self.graph.function.const64(bits as i64)
    }

    fn int32(&mut self, value: i32) -> Ssa {
        self.graph.function.const32(value)
    }

    fn not(&mut self, boolean: Ssa) -> Ssa {
        match *self.graph.function.op(boolean) {
            Op::Compare(cond, [lhs, rhs]) => self.ir().compare(cond.inverted(), lhs, rhs),
            _ => self.ir().xor(boolean, 1),
        }
    }

    fn load(&mut self, ty: Type, base: Ssa, offset: usize, heap: Heap) -> Ssa {
        self.ir().load(ty, base, offset as i32, heap)
    }

    fn load_byte(&mut self, base: Ssa, offset: usize, access: impl Into<Access>) -> Ssa {
        (self.ir()).load_narrow(Size::S8, Sign::Unsigned, base, offset as i32, access)
    }

    fn store(&mut self, value: Ssa, base: Ssa, offset: usize, heap: Heap) {
        self.ir().store(value, base, offset as i32, heap);
    }
}
