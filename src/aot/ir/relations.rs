#[cfg(test)]
mod tests;

use rustc_hash::FxHashMap;
use smallvec::SmallVec;

use super::builder::{
    ENTRY_BLOCK, MAX_SPARE_BLOCKS, MAX_SPARE_VALUES, PendingBlock, PendingDefinition,
    PendingTarget, PendingTerminator, PendingValue, recycle_vector,
};
use super::generated::{
    FunctionFlags, FunctionRelations, HandedTo, IteratorResumeResult, Opcode, OperandInfo,
    OperandOf, OperandUse, OperandWord, Protocol, RelationSubject, RelationSubjectKind,
    ResultOrigin, Retainer, RetainingHeap, StoredInto, TerminatorKind, ValueFate,
    compares_identity, defines_members, is_made_from_payload, operand_infos_of, result_origin_of,
    retaining_heap_of, visit_terminator_operands, visit_value_operands,
};
use super::ids::{BlockId, Id, PropertyKeyId, ValueId};

const MAX_PATH_LENGTH: u8 = 4;
const MAX_ORDER_QUESTIONS: usize = 1 << 16;
const MAX_SPARE_SET_WORDS: usize = 1 << 18;
const MAX_SPARE_ROWS: usize = 1 << 14;
const MAX_SPARE_READS: usize = 1 << 10;
const NO_SUBJECT: u16 = u16::MAX;
// In a row: the value may also be something that is no subject.
const UNLISTED: u32 = u32::MAX;

// In ascending order.
type Subjects = SmallVec<[u16; 4]>;

const KEEPS: ValueFate = ValueFate(
    ValueFate::IS_RETURNED.0
        | ValueFate::IS_THROWN.0
        | ValueFate::IS_YIELDED.0
        | ValueFate::IS_STORED_IN_VARIABLE.0
        | ValueFate::IS_STORED_IN_ENVIRONMENT.0
        | ValueFate::IS_STORED_IN_UNKNOWN_OBJECT.0
        | ValueFate::IS_HANDED_TO_UNKNOWN_CODE.0,
);

pub(super) struct WalkedFunction<'a> {
    pub(super) flags: FunctionFlags,
    pub(super) result_count: usize,
    pub(super) blocks: &'a [PendingBlock],
    pub(super) values: &'a [PendingValue],
    pub(super) field_words: &'a [u32],
    pub(super) order: &'a [BlockId],
    pub(super) block_numbers: &'a [Option<BlockId>],
    pub(super) value_numbers: &'a [Option<ValueId>],
}

struct Subject {
    kind: RelationSubjectKind,
    // The index of the entry parameter, or the value as the builder numbers it.
    index: u32,
    source: u16,
    key: Option<PropertyKeyId>,
    fate: ValueFate,
    results: u32,
    path_length: u8,
    is_left_out: bool,
}

#[derive(Copy, Clone, PartialEq, Eq)]
struct Place {
    block: u32,
    position: u32,
}

struct Store {
    // `NO_SUBJECT`: something that is no subject.
    source: u16,
    target: u16,
    key: Option<PropertyKeyId>,
    creation_operand: Option<u32>,
    // The target holds it from its creation on.
    is_at_creation: bool,
    // The store goes into the target and into nothing else. Where the object may be one of several, each run stores into one of them.
    is_sure_of_target: bool,
    place: Place,
}

#[derive(Copy, Clone)]
struct Operation<'a> {
    opcode: Opcode,
    // Each with its index in the operation's own list of operands.
    operands: &'a [(u32, ValueId)],
    key: Option<PropertyKeyId>,
}

#[derive(Copy, Clone)]
struct DecodedOperation {
    opcode: Opcode,
    first_operand: u32,
    operand_count: u32,
    key: Option<PropertyKeyId>,
}

// The operations of the reached blocks, each taken apart once.
#[derive(Default)]
pub(super) struct Operations {
    // By value.
    operations: Vec<Option<DecodedOperation>>,
    operands: Vec<(u32, ValueId)>,
    // For each of `operands`: which of the field words of its operation it is.
    operand_places: Vec<u32>,
    // By block, as the builder numbers them.
    terminator_operands: Vec<Option<ValueId>>,
}

impl Operations {
    pub(super) fn decode(function: &WalkedFunction<'_>, scratch: Operations) -> Operations {
        let mut decoded = scratch;
        decoded.operations.resize(function.values.len(), None);
        decoded
            .terminator_operands
            .resize(function.blocks.len(), None);
        for &block in function.order {
            let pending = &function.blocks[block.index()];
            for &value in &pending.values {
                decoded.decode_value(function, value);
            }
            let terminator = terminator_of(pending);
            let fields = &terminator.fields;
            let words = &function.field_words[fields.start as usize..fields.end as usize];
            let operand = &mut decoded.terminator_operands[block.index()];
            visit_terminator_operands(terminator.kind, words, &mut |word, at| {
                if word == OperandWord::Operand(0) {
                    *operand = Some(ValueId::from_word(words[at]));
                }
            });
        }
        decoded
    }

    fn decode_value(&mut self, function: &WalkedFunction<'_>, value: ValueId) {
        let PendingDefinition::Operation { opcode, fields } =
            &function.values[value.index()].definition
        else {
            return;
        };
        let words = &function.field_words[fields.start as usize..fields.end as usize];
        let first_operand = self.operands.len() as u32;
        let (operands, places, mut key) = (&mut self.operands, &mut self.operand_places, None);
        visit_value_operands(*opcode, words, &mut |word, at| match word {
            OperandWord::Operand(index) => {
                operands.push((index, ValueId::from_word(words[at])));
                places.push(at as u32);
            }
            OperandWord::Key => key = key.or_else(|| Some(PropertyKeyId::from_word(words[at]))),
        });
        self.operations[value.index()] = Some(DecodedOperation {
            opcode: *opcode,
            first_operand,
            operand_count: self.operands.len() as u32 - first_operand,
            key,
        });
    }

    fn get(&self, value: ValueId) -> Option<Operation<'_>> {
        let decoded = self.operations[value.index()]?;
        let first = decoded.first_operand as usize;
        Some(Operation {
            opcode: decoded.opcode,
            operands: &self.operands[first..first + decoded.operand_count as usize],
            key: decoded.key,
        })
    }

    // The operands of an operation of a reached block, each with its place among the field words.
    pub(super) fn operand_words(&self, value: ValueId) -> impl Iterator<Item = (usize, ValueId)> {
        let decoded = self.operations[value.index()].expect("a listed value is an operation");
        let first = decoded.first_operand as usize;
        let range = first..first + decoded.operand_count as usize;
        let places = self.operand_places[range.clone()].iter();
        places
            .zip(&self.operands[range])
            .map(|(&place, &(_, operand))| (place as usize, operand))
    }

    pub(super) fn into_scratch(self) -> Operations {
        Operations {
            operations: recycle_vector(self.operations, MAX_SPARE_VALUES),
            operands: recycle_vector(self.operands, MAX_SPARE_VALUES),
            operand_places: recycle_vector(self.operand_places, MAX_SPARE_VALUES),
            terminator_operands: recycle_vector(self.terminator_operands, MAX_SPARE_BLOCKS),
        }
    }
}

// A set of subjects for every value, of as many words as the function needs: see relate(). Nearly every set holds nothing, or a subject or two.
struct Sets<const W: usize> {
    // W for a value.
    words: Vec<u64>,
    // By value. Bit w: word w of the set holds something. There are at most 64 words.
    occupied: Vec<u64>,
}

impl<const W: usize> Sets<W> {
    fn insert(&mut self, value: ValueId, subject: u16) {
        let word = subject as usize / 64;
        self.words[value.index() * W + word] |= 1 << (subject % 64);
        self.occupied[value.index()] |= 1 << word;
    }

    fn unite(&mut self, value: ValueId, other: ValueId) -> bool {
        let mut occupied = self.occupied[other.index()];
        self.occupied[value.index()] |= occupied;
        let mut has_grown = false;
        while occupied != 0 {
            let word = occupied.trailing_zeros() as usize;
            occupied &= occupied - 1;
            let added = self.words[other.index() * W + word];
            let united = &mut self.words[value.index() * W + word];
            has_grown |= added & !*united != 0;
            *united |= added;
        }
        has_grown
    }

    fn is_empty(&self, value: ValueId) -> bool {
        self.occupied[value.index()] == 0
    }

    fn is_single(&self, value: ValueId) -> bool {
        let occupied = self.occupied[value.index()];
        let word = occupied.trailing_zeros() as usize;
        occupied.is_power_of_two() && self.words[value.index() * W + word].is_power_of_two()
    }

    fn members(&self, value: ValueId) -> Members {
        Members {
            first_word: value.index() * W,
            occupied: self.occupied[value.index()],
            word: 0,
            rest: 0,
        }
    }
}

// The members of the set of a value, in ascending order. It borrows nothing, so the walk can add subjects and rows on the way. The set itself stays as it is meanwhile.
struct Members {
    first_word: usize,
    // The words that have not been begun.
    occupied: u64,
    word: u32,
    rest: u64,
}

impl Members {
    fn next_in<const W: usize>(&mut self, sets: &Sets<W>) -> Option<u16> {
        while self.rest == 0 {
            if self.occupied == 0 {
                return None;
            }
            self.word = self.occupied.trailing_zeros();
            self.occupied &= self.occupied - 1;
            self.rest = sets.words[self.first_word + self.word as usize];
        }
        let bit = self.rest.trailing_zeros();
        self.rest &= self.rest - 1;
        Some((self.word * 64 + bit) as u16)
    }
}

fn parameters_of(block: &PendingBlock) -> impl Iterator<Item = ValueId> {
    let parameters = block.parameters.iter().chain(&block.variable_parameters);
    parameters.chain(&block.edge_results).copied()
}

fn arguments_of(target: &PendingTarget) -> impl Iterator<Item = ValueId> {
    let arguments = target.arguments.iter().chain(&target.variable_arguments);
    arguments.chain(&target.trailing_arguments).copied()
}

fn terminator_of(block: &PendingBlock) -> &PendingTerminator {
    block
        .terminator
        .as_ref()
        .expect("every block is terminated")
}

fn info_of(infos: &[OperandInfo], index: u32) -> Option<&OperandInfo> {
    infos.get(index as usize).or_else(|| infos.last())
}

// What is read comes last, so that every subject stands behind what it is read out of.
fn place_of(kind: RelationSubjectKind) -> u8 {
    match kind {
        RelationSubjectKind::ReadFrom => u8::MAX,
        kind => kind as u8,
    }
}

// The parameters can be reached through what the operation makes or runs, under names that no operand shows.
fn hides_uses_of_parameters(opcode: Opcode) -> bool {
    matches!(
        opcode,
        Opcode::CreateMappedArguments
            | Opcode::CreateUnmappedArguments
            | Opcode::GetMappedArgument
            | Opcode::SetMappedArgument
            | Opcode::DirectEval
            | Opcode::ScopeHasBinding
    )
}

// The state of an iteration stands for what is iterated, and a step reads out of that.
fn origin_of(opcode: Opcode) -> ResultOrigin {
    match opcode {
        Opcode::IteratorOpen | Opcode::ResultAt => ResultOrigin::Nothing,
        Opcode::IteratorResume => ResultOrigin::Read { receiver: 0 },
        opcode => result_origin_of(opcode),
    }
}

fn is_construction(opcode: Opcode) -> bool {
    matches!(
        opcode,
        Opcode::Construct
            | Opcode::ConstructList
            | Opcode::SuperConstruct
            | Opcode::SuperConstructList
    )
}

fn retains_an_operand(infos: &[OperandInfo], operation: &Operation<'_>, retaining: u32) -> bool {
    operation.operands.iter().any(|&(index, _)| {
        info_of(infos, index).is_some_and(|info| {
            info.uses.contains(OperandUse::RETAINS)
                && info.retainer == Retainer::Operand(retaining as u8)
        })
    })
}

#[derive(Default)]
pub(super) struct RelationsScratch {
    set_words: Vec<u64>,
    occupied_words: Vec<u64>,
    is_unlisted: Vec<bool>,
    subject_of_value: Vec<u16>,
    subjects: Vec<Subject>,
    reads: FxHashMap<(u32, u16), u16>,
    stores: Vec<Store>,
    handed: Vec<HandedTo>,
    operands: Vec<OperandOf>,
    departures: Vec<(u16, Place)>,
    returns: Vec<Place>,
    places: Vec<Place>,
    is_used: Vec<bool>,
    order: Vec<(u64, u16)>,
    final_numbers: Vec<u32>,
}

struct Walk<'a, const W: usize> {
    function: &'a WalkedFunction<'a>,
    operations: &'a Operations,
    holds: Sets<W>,
    // The value may be something that is no subject.
    is_unlisted: Vec<bool>,
    subject_of_value: Vec<u16>,
    subjects: Vec<Subject>,
    reads: FxHashMap<(u32, u16), u16>,
    stores: Vec<Store>,
    handed: Vec<HandedTo>,
    operands: Vec<OperandOf>,
    // Where a subject is returned, thrown, stored or handed on.
    departures: Vec<(u16, Place)>,
    returns: Vec<Place>,
    // By value.
    places: Vec<Place>,
    // By subject.
    is_used: Vec<bool>,
    // The subjects that are not left out, each behind its key.
    order: Vec<(u64, u16)>,
    // By subject.
    final_numbers: Vec<u32>,
    results_fully_listed: u32,
    undefined_result: u16,
    hides_uses_of_parameters: bool,
}

impl<'a, const W: usize> Walk<'a, W> {
    fn new(
        function: &'a WalkedFunction<'a>,
        operations: &'a Operations,
        scratch: RelationsScratch,
    ) -> Walk<'a, W> {
        let value_count = function.values.len();
        let result_count = function.result_count.min(32) as u32;
        let mut walk = Walk {
            function,
            operations,
            holds: Sets {
                words: scratch.set_words,
                occupied: scratch.occupied_words,
            },
            is_unlisted: scratch.is_unlisted,
            subject_of_value: scratch.subject_of_value,
            subjects: scratch.subjects,
            reads: scratch.reads,
            stores: scratch.stores,
            handed: scratch.handed,
            operands: scratch.operands,
            departures: scratch.departures,
            returns: scratch.returns,
            places: scratch.places,
            is_used: scratch.is_used,
            order: scratch.order,
            final_numbers: scratch.final_numbers,
            results_fully_listed: (1u64 << result_count).wrapping_sub(1) as u32,
            undefined_result: NO_SUBJECT,
            hides_uses_of_parameters: false,
        };
        walk.holds.words.resize(value_count * W, 0);
        walk.holds.occupied.resize(value_count, 0);
        walk.is_unlisted.resize(value_count, false);
        walk.subject_of_value.resize(value_count, NO_SUBJECT);
        walk.places.resize(
            value_count,
            Place {
                block: 0,
                position: 0,
            },
        );
        walk
    }

    fn into_scratch(self) -> RelationsScratch {
        let mut reads = self.reads;
        if reads.capacity() > MAX_SPARE_READS {
            reads = FxHashMap::default();
        }
        reads.clear();
        RelationsScratch {
            set_words: recycle_vector(self.holds.words, MAX_SPARE_SET_WORDS),
            occupied_words: recycle_vector(self.holds.occupied, MAX_SPARE_VALUES),
            is_unlisted: recycle_vector(self.is_unlisted, MAX_SPARE_VALUES),
            subject_of_value: recycle_vector(self.subject_of_value, MAX_SPARE_VALUES),
            subjects: recycle_vector(self.subjects, MAX_SPARE_ROWS),
            reads,
            stores: recycle_vector(self.stores, MAX_SPARE_ROWS),
            handed: recycle_vector(self.handed, MAX_SPARE_ROWS),
            operands: recycle_vector(self.operands, MAX_SPARE_ROWS),
            departures: recycle_vector(self.departures, MAX_SPARE_ROWS),
            returns: recycle_vector(self.returns, MAX_SPARE_ROWS),
            places: recycle_vector(self.places, MAX_SPARE_VALUES),
            is_used: recycle_vector(self.is_used, MAX_SPARE_ROWS),
            order: recycle_vector(self.order, MAX_SPARE_ROWS),
            final_numbers: recycle_vector(self.final_numbers, MAX_SPARE_ROWS),
        }
    }

    fn add_subject(&mut self, kind: RelationSubjectKind, index: u32) -> Option<u16> {
        if self.subjects.len() == W * 64 {
            return None;
        }
        self.subjects.push(Subject {
            kind,
            index,
            source: NO_SUBJECT,
            key: None,
            fate: ValueFate::default(),
            results: 0,
            path_length: 0,
            is_left_out: false,
        });
        Some((self.subjects.len() - 1) as u16)
    }

    fn subject_of(&mut self, value: ValueId, kind: RelationSubjectKind) -> Option<u16> {
        let known = self.subject_of_value[value.index()];
        if known != NO_SUBJECT {
            return Some(known);
        }
        let subject = self.add_subject(kind, value.index() as u32)?;
        self.subject_of_value[value.index()] = subject;
        Some(subject)
    }

    fn read_from(&mut self, read: ValueId, source: u16, key: Option<PropertyKeyId>) -> Option<u16> {
        if let Some(&known) = self.reads.get(&(read.index() as u32, source)) {
            return Some(known);
        }
        let path_length = self.subjects[source as usize].path_length + 1;
        let subject = match path_length > MAX_PATH_LENGTH {
            true => None,
            false => self.add_subject(RelationSubjectKind::ReadFrom, read.index() as u32),
        };
        let Some(subject) = subject else {
            self.subjects[source as usize].fate |= ValueFate::IS_INCOMPLETE;
            return None;
        };
        let record = &mut self.subjects[subject as usize];
        (record.source, record.key, record.path_length) = (source, key, path_length);
        self.reads.insert((read.index() as u32, source), subject);
        Some(subject)
    }

    fn is_value_of_step(&self, result_at: ValueId, results: ValueId) -> bool {
        let definition_of = |value: ValueId| &self.function.values[value.index()].definition;
        let PendingDefinition::Operation { fields, .. } = definition_of(result_at) else {
            return false;
        };
        let index = self.function.field_words[fields.start as usize + 1];
        let is_step = matches!(
            definition_of(results),
            PendingDefinition::Operation {
                opcode: Opcode::IteratorResume,
                ..
            }
        );
        is_step && index == IteratorResumeResult::Value as u32
    }

    fn add_parameters(&mut self) {
        let entry = &self.function.blocks[ENTRY_BLOCK.index()];
        for (index, parameter) in (0u32..).zip(parameters_of(entry)) {
            match self.add_subject(RelationSubjectKind::Parameter, index) {
                Some(subject) => self.holds.insert(parameter, subject),
                None => self.is_unlisted[parameter.index()] = true,
            }
        }
    }

    // Objects and results of calls come before what is read out of them where not everything can be followed.
    fn add_allocations_and_calls(&mut self) {
        for &block in self.function.order {
            for &value in &self.function.blocks[block.index()].values {
                let Some(Operation { opcode, .. }) = self.operations.get(value) else {
                    continue;
                };
                self.hides_uses_of_parameters |= hides_uses_of_parameters(opcode);
                match origin_of(opcode) {
                    ResultOrigin::Allocation => {
                        self.subject_of(value, RelationSubjectKind::Allocation);
                    }
                    ResultOrigin::Call => {
                        self.subject_of(value, RelationSubjectKind::CallResult);
                    }
                    ResultOrigin::Nothing
                    | ResultOrigin::Constant
                    | ResultOrigin::Read { .. }
                    | ResultOrigin::Computed
                    | ResultOrigin::Other => {}
                }
            }
        }
    }

    fn follow_value(&mut self, value: ValueId) {
        let Some(operation) = self.operations.get(value) else {
            return;
        };
        let infos = operand_infos_of(operation.opcode);
        let mut is_unlisted = self.is_unlisted[value.index()];
        for &(index, operand) in operation.operands {
            if info_of(infos, index).is_some_and(|info| info.uses.contains(OperandUse::RETURNS)) {
                self.holds.unite(value, operand);
                is_unlisted |= self.is_unlisted[operand.index()];
            }
        }
        match (operation.opcode, operation.operands.first()) {
            (Opcode::IteratorOpen, Some(&(_, iterable))) => {
                self.holds.unite(value, iterable);
                is_unlisted |= self.is_unlisted[iterable.index()];
            }
            (Opcode::ResultAt, Some(&(_, results))) if self.is_value_of_step(value, results) => {
                self.holds.unite(value, results);
                is_unlisted |= self.is_unlisted[results.index()];
            }
            (Opcode::ResultAt, _) => is_unlisted = true,
            _ => {}
        }
        let own = match origin_of(operation.opcode) {
            ResultOrigin::Nothing => None,
            ResultOrigin::Other => {
                is_unlisted = true;
                None
            }
            ResultOrigin::Constant => Some(RelationSubjectKind::Constant),
            ResultOrigin::Allocation => Some(RelationSubjectKind::Allocation),
            ResultOrigin::Call => Some(RelationSubjectKind::CallResult),
            ResultOrigin::Computed => Some(RelationSubjectKind::Computed),
            ResultOrigin::Read { receiver } => {
                let base = operation
                    .operands
                    .iter()
                    .find(|&&(index, _)| index == u32::from(receiver));
                let Some(&(_, base)) = base else {
                    self.is_unlisted[value.index()] = true;
                    return;
                };
                is_unlisted |= self.is_unlisted[base.index()] || self.holds.is_empty(base);
                let mut sources = self.holds.members(base);
                while let Some(source) = sources.next_in(&self.holds) {
                    match self.read_from(value, source, operation.key) {
                        Some(read) => self.holds.insert(value, read),
                        None => is_unlisted = true,
                    }
                }
                None
            }
        };
        if let Some(kind) = own {
            match self.subject_of(value, kind) {
                Some(subject) => self.holds.insert(value, subject),
                None => is_unlisted = true,
            }
        }
        self.is_unlisted[value.index()] = is_unlisted;
    }

    // What a test has looked at comes out of the branch as a parameter of the block behind it.
    fn find_tested_operand(&self, from: BlockId, proof: u32) -> Option<ValueId> {
        let subject = self.operations.terminator_operands[from.index()]?;
        if terminator_of(&self.function.blocks[from.index()]).kind != TerminatorKind::Branch {
            return (proof == 0).then_some(subject);
        }
        let mut test = self.operations.get(subject)?;
        while test.opcode == Opcode::LogicalNot {
            test = self.operations.get(test.operands.first()?.1)?;
        }
        let operand = test.operands.iter().find(|&&(index, _)| index == proof);
        operand.map(|&(_, operand)| operand)
    }

    fn follow_edge(&mut self, from: BlockId, target: &PendingTarget) -> bool {
        let function = self.function;
        let mut parameters = parameters_of(&function.blocks[target.block.index()]);
        let mut has_changed = false;
        let mut pass = |walk: &mut Walk<'_, W>, parameter: ValueId, argument: Option<ValueId>| {
            let is_unlisted = match argument {
                Some(argument) => {
                    has_changed |= walk.holds.unite(parameter, argument);
                    walk.is_unlisted[argument.index()]
                }
                None => true,
            };
            has_changed |= is_unlisted && !walk.is_unlisted[parameter.index()];
            walk.is_unlisted[parameter.index()] |= is_unlisted;
        };
        for argument in arguments_of(target) {
            if let Some(parameter) = parameters.next() {
                pass(self, parameter, Some(argument));
            }
        }
        for &proof in &target.proofs {
            if let Some(parameter) = parameters.next() {
                let tested = self.find_tested_operand(from, proof);
                pass(self, parameter, tested);
            }
        }
        has_changed
    }

    // In this order whatever a value is made of has been followed before it, but what comes round an edge that goes back.
    fn follow_values(&mut self) {
        let function = self.function;
        let mut first = 0;
        loop {
            let mut first_to_repeat = usize::MAX;
            for (number, &id) in function.order.iter().enumerate().skip(first) {
                let block = &function.blocks[id.index()];
                for &value in &block.values {
                    self.follow_value(value);
                }
                for target in block.handler.iter().chain(&terminator_of(block).targets) {
                    let has_changed = self.follow_edge(id, target);
                    let target_number = function.block_numbers[target.block.index()];
                    if has_changed
                        && let Some(target_number) = target_number
                        && target_number.index() <= number
                    {
                        first_to_repeat = first_to_repeat.min(target_number.index());
                    }
                }
            }
            if first_to_repeat == usize::MAX {
                return;
            }
            first = first_to_repeat;
        }
    }

    fn add_fate(&mut self, subject: u16, fate: ValueFate, place: Place) {
        self.subjects[subject as usize].fate |= fate;
        if fate.intersects(KEEPS) {
            self.departures.push((subject, place));
        }
    }

    fn fate_of_uses(info: &OperandInfo) -> ValueFate {
        const WRITES: OperandUse = OperandUse(
            OperandUse::WRITES_CONTENTS.0
                | OperandUse::STORES_BY_KEY.0
                | OperandUse::ASSIGNS_FROM.0
                | OperandUse::MOVES_ELEMENTS.0,
        );
        const DEFINES: OperandUse = OperandUse(
            OperandUse::DELETES_BY_KEY.0
                | OperandUse::DEFINES_NAME.0
                | OperandUse::TAKES_DESCRIPTOR.0
                | OperandUse::CHANGES_INTEGRITY.0
                | OperandUse::CHANGES_PROTOTYPE.0,
        );
        const CALLS: OperandUse = OperandUse(
            OperandUse::CALLS.0 | OperandUse::CALLS_PER_ELEMENT.0 | OperandUse::CALLS_REPEATEDLY.0,
        );
        const REACHES_FURTHER: OperandUse =
            OperandUse(OperandUse::APPLIES_TRANSITIVELY.0 | OperandUse::APPLIES_TO_CONTENTS.0);
        const READS: Protocol =
            Protocol(Protocol::OWN_VALUES.0 | Protocol::PROTOTYPE_CHAIN.0 | Protocol::NAMED.0);
        const RUNS_CODE: Protocol = Protocol(
            Protocol::THENABLE.0
                | Protocol::SPECIES.0
                | Protocol::TO_JSON.0
                | Protocol::CALLS_NAMED.0,
        );
        let (uses, protocols) = (info.uses, info.protocols);
        let mut fate = ValueFate::default();
        let mut add = |holds: bool, added: ValueFate| {
            if holds {
                fate |= added;
            }
        };
        add(
            uses.contains(OperandUse::READS_CONTENTS),
            ValueFate::HAS_MEMBERS_READ,
        );
        add(uses.intersects(WRITES), ValueFate::HAS_MEMBERS_WRITTEN);
        add(
            uses.intersects(DEFINES),
            ValueFate::HAS_MEMBERS_DELETED_OR_DEFINED,
        );
        add(uses.intersects(CALLS), ValueFate::IS_CALLED);
        add(
            uses.contains(OperandUse::PASSES_TO_USER_CODE),
            ValueFate::IS_HANDED_TO_UNKNOWN_CODE,
        );
        add(uses.intersects(REACHES_FURTHER), ValueFate::IS_INCOMPLETE);
        add(
            protocols.contains(Protocol::OWN_KEYS),
            ValueFate::HAS_KEYS_ENUMERATED,
        );
        add(
            protocols.contains(Protocol::ITERATE),
            ValueFate::IS_ITERATED,
        );
        add(protocols.intersects(READS), ValueFate::HAS_MEMBERS_READ);
        add(
            protocols.intersects(RUNS_CODE),
            ValueFate::IS_HANDED_TO_UNKNOWN_CODE | ValueFate::HAS_MEMBERS_READ,
        );
        add(
            protocols.contains(Protocol::TO_PRIMITIVE),
            ValueFate::IS_CONVERTED_TO_PRIMITIVE,
        );
        add(
            protocols.contains(Protocol::HAS_INSTANCE),
            ValueFate::IS_INCOMPLETE,
        );
        fate
    }

    fn fate_of_unknown_memory(opcode: Opcode) -> ValueFate {
        match (opcode, retaining_heap_of(opcode)) {
            (Opcode::Yield, _) => ValueFate::IS_YIELDED,
            (_, RetainingHeap::ModuleVariables) => ValueFate::IS_STORED_IN_VARIABLE,
            (_, RetainingHeap::EnvironmentFields) => ValueFate::IS_STORED_IN_ENVIRONMENT,
            (_, RetainingHeap::Other) => ValueFate::IS_STORED_IN_UNKNOWN_OBJECT,
        }
    }

    fn note_retained(
        &mut self,
        value: ValueId,
        operation: &Operation<'_>,
        info: &OperandInfo,
        (index, stored): (u32, ValueId),
        place: Place,
    ) {
        let unknown = Self::fate_of_unknown_memory(operation.opcode);
        let (targets, is_unlisted) = match info.retainer {
            Retainer::UnknownMemory => (Subjects::new(), true),
            Retainer::Result => match self.subject_of_value[value.index()] {
                NO_SUBJECT => (Subjects::new(), true),
                subject => (Subjects::from_slice(&[subject]), false),
            },
            Retainer::Operand(retaining) => {
                let mut operands = operation.operands.iter();
                match operands.find(|&&(index, _)| index == u32::from(retaining)) {
                    Some(&(_, target)) => {
                        let (targets, holds_others) = self.find_holders(target);
                        let is_unlisted = self.is_unlisted[target.index()] || holds_others;
                        let is_unlisted = is_unlisted || targets.is_empty();
                        (targets, is_unlisted)
                    }
                    None => (Subjects::new(), true),
                }
            }
        };
        let written = match defines_members(operation.opcode) {
            true => ValueFate::HAS_MEMBERS_DELETED_OR_DEFINED,
            false => ValueFate::HAS_MEMBERS_WRITTEN,
        };
        let is_in_result = info.retainer == Retainer::Result;
        let key = operation.key.filter(|_| !is_in_result);
        let creation_operand = is_in_result.then_some(index);
        let is_sure_of_target = !is_unlisted && targets.len() == 1;
        for &target in &targets {
            if !is_in_result && operation.opcode != Opcode::PutEnvironmentField {
                let done =
                    self.as_done_to(target, operation.opcode, operation.key.is_some(), written);
                self.subjects[target as usize].fate |= done;
            }
            if self.is_unlisted[stored.index()] || self.holds.is_empty(stored) {
                self.stores.push(Store {
                    source: NO_SUBJECT,
                    target,
                    key,
                    creation_operand,
                    is_at_creation: is_in_result,
                    is_sure_of_target,
                    place,
                });
            }
        }
        let mut sources = self.holds.members(stored);
        while let Some(source) = sources.next_in(&self.holds) {
            if is_unlisted {
                self.add_fate(source, unknown, place);
            }
            for &target in &targets {
                self.stores.push(Store {
                    source,
                    target,
                    key,
                    creation_operand,
                    is_at_creation: is_in_result,
                    is_sure_of_target,
                    place,
                });
                self.departures.push((source, place));
            }
        }
    }

    // `{ a: p, n: 2 }`: a member of a literal that is no operand of NewObject is defined behind it.
    fn as_done_to(
        &self,
        subject: u16,
        opcode: Opcode,
        has_key: bool,
        fate: ValueFate,
    ) -> ValueFate {
        let is_own = self.subjects[subject as usize].kind == RelationSubjectKind::Allocation;
        if opcode == Opcode::PropDefine
            && has_key
            && is_own
            && fate.contains(ValueFate::HAS_MEMBERS_DELETED_OR_DEFINED)
        {
            return fate.without(ValueFate::HAS_MEMBERS_DELETED_OR_DEFINED)
                | ValueFate::HAS_MEMBERS_WRITTEN;
        }
        fate
    }

    // A built-in object and what an operator hands out are there for everybody: what is stored into them is stored into an unknown object.
    fn find_holders(&self, value: ValueId) -> (Subjects, bool) {
        let mut holders = Subjects::new();
        let mut holds_others = false;
        let mut held = self.holds.members(value);
        while let Some(subject) = held.next_in(&self.holds) {
            match self.subjects[subject as usize].kind {
                RelationSubjectKind::Constant | RelationSubjectKind::Computed => {
                    holds_others = true
                }
                RelationSubjectKind::Parameter
                | RelationSubjectKind::Allocation
                | RelationSubjectKind::CallResult
                | RelationSubjectKind::ReadFrom => holders.push(subject),
            }
        }
        (holders, holds_others)
    }

    // What the operation reads out of the object goes where nobody follows it.
    fn note_contents_retained(&mut self, value: ValueId, object: ValueId) {
        let mut sources = self.holds.members(object);
        while let Some(source) = sources.next_in(&self.holds) {
            if let Some(contents) = self.read_from(value, source, None) {
                self.subjects[contents as usize].fate |= ValueFate::IS_INCOMPLETE;
            }
        }
    }

    // A copy is born with what the original holds.
    fn note_contents_copied(&mut self, value: ValueId, original: ValueId, copy: u16, place: Place) {
        let mut has_unlisted = self.is_unlisted[original.index()] || self.holds.is_empty(original);
        let store = |walk: &mut Walk<'_, W>, source: u16| {
            walk.stores.push(Store {
                source,
                target: copy,
                key: None,
                creation_operand: None,
                is_at_creation: true,
                is_sure_of_target: true,
                place,
            });
        };
        let mut sources = self.holds.members(original);
        while let Some(source) = sources.next_in(&self.holds) {
            match self.read_from(value, source, None) {
                Some(contents) => {
                    store(self, contents);
                    self.departures.push((contents, place));
                }
                None => has_unlisted = true,
            }
        }
        if has_unlisted {
            store(self, NO_SUBJECT);
        }
    }

    fn note_uses_of(&mut self, value: ValueId, place: Place) {
        let Some(operation) = self.operations.get(value) else {
            return;
        };
        let opcode = operation.opcode;
        let infos = operand_infos_of(opcode);
        let origin = origin_of(opcode);
        let number = self.number_of(value);
        // Whose operands the operands are: the result of an operator, and what is read under a key that is computed.
        let mut users = Subjects::new();
        match origin {
            ResultOrigin::Computed if self.subject_of_value[value.index()] != NO_SUBJECT => {
                users.push(self.subject_of_value[value.index()]);
            }
            ResultOrigin::Read { .. } => {
                let mut reads = self.holds.members(value);
                while let Some(read) = reads.next_in(&self.holds) {
                    let record = &self.subjects[read as usize];
                    if record.kind == RelationSubjectKind::ReadFrom
                        && record.index == value.index() as u32
                    {
                        users.push(read);
                    }
                }
            }
            _ => {}
        }
        // What a literal of constants holds stands in the data of the program, and no operand is any of it.
        let made = self.subject_of_value[value.index()];
        if is_made_from_payload(opcode) && made != NO_SUBJECT {
            self.stores.push(Store {
                source: NO_SUBJECT,
                target: made,
                key: None,
                creation_operand: None,
                is_at_creation: true,
                is_sure_of_target: true,
                place,
            });
        }
        // The method that says what an instance is gets the value that is asked about.
        let asks_an_operand = operation.operands.iter().any(|&(index, _)| {
            info_of(infos, index)
                .is_some_and(|info| info.protocols.contains(Protocol::HAS_INSTANCE))
        });
        for &(index, operand) in operation.operands {
            let Some(info) = info_of(infos, index) else {
                let mut held = self.holds.members(operand);
                while let Some(subject) = held.next_in(&self.holds) {
                    self.subjects[subject as usize].fate |= ValueFate::IS_INCOMPLETE;
                }
                continue;
            };
            // Beside its subjects.
            let may_be_unlisted =
                self.is_unlisted[operand.index()] && !self.holds.is_empty(operand);
            let mut fate = Self::fate_of_uses(info);
            if origin
                == (ResultOrigin::Read {
                    receiver: index as u8,
                })
                && opcode != Opcode::GetEnvironmentField
            {
                fate |= ValueFate::HAS_MEMBERS_READ;
            }
            if compares_identity(opcode) {
                fate |= ValueFate::IS_COMPARED;
            }
            if asks_an_operand && !info.protocols.contains(Protocol::HAS_INSTANCE) {
                fate |= ValueFate::IS_HANDED_TO_UNKNOWN_CODE;
            }
            // Nobody but its own function reads what a closure has captured: the operands are the first entry parameters of that function.
            if origin == ResultOrigin::Call || opcode == Opcode::NewClosure {
                if self.subject_of_value[value.index()] == NO_SUBJECT {
                    fate |= ValueFate::IS_INCOMPLETE;
                }
                if fate.contains(ValueFate::IS_CALLED) && is_construction(opcode) {
                    fate = fate.without(ValueFate::IS_CALLED) | ValueFate::IS_CONSTRUCTED;
                }
                let mut held = self.holds.members(operand);
                while let Some(source) = held.next_in(&self.holds) {
                    self.handed.push(HandedTo {
                        source: u32::from(source),
                        call: number,
                        argument: index,
                    });
                    self.departures.push((source, place));
                }
                if may_be_unlisted {
                    self.handed.push(HandedTo {
                        source: UNLISTED,
                        call: number,
                        argument: index,
                    });
                }
            } else {
                if info.uses.contains(OperandUse::RETAINS) && opcode != Opcode::IteratorOpen {
                    self.note_retained(value, &operation, info, (index, operand), place);
                }
                // What comes out of an operation whose result nobody follows may have come out of any of its operands.
                let may_be_read_out =
                    origin == ResultOrigin::Other && !info.uses.contains(OperandUse::RETURNS);
                if may_be_read_out {
                    fate |= ValueFate::HAS_MEMBERS_READ;
                }
                let made = self.subject_of_value[value.index()];
                let retains_contents = info.uses.contains(OperandUse::RETAINS_CONTENTS);
                if retains_contents && origin == ResultOrigin::Allocation && made != NO_SUBJECT {
                    self.note_contents_copied(value, operand, made, place);
                } else if may_be_read_out || retains_contents {
                    self.note_contents_retained(value, operand);
                }
                let is_written = fate.intersects(
                    ValueFate::HAS_MEMBERS_WRITTEN | ValueFate::HAS_MEMBERS_DELETED_OR_DEFINED,
                );
                if is_written && !retains_an_operand(infos, &operation, index) {
                    let is_sure_of_target =
                        !self.is_unlisted[operand.index()] && self.holds.is_single(operand);
                    let mut held = self.holds.members(operand);
                    while let Some(target) = held.next_in(&self.holds) {
                        self.stores.push(Store {
                            source: NO_SUBJECT,
                            target,
                            key: operation.key,
                            creation_operand: None,
                            is_at_creation: false,
                            is_sure_of_target,
                            place,
                        });
                    }
                }
            }
            let is_receiver = origin
                == (ResultOrigin::Read {
                    receiver: index as u8,
                });
            let users_of_operand: &[u16] = if is_receiver { &[] } else { users.as_slice() };
            let add_operand = |walk: &mut Walk<'_, W>, source: u32| {
                for &user in users_of_operand {
                    walk.operands.push(OperandOf {
                        source,
                        user: u32::from(user),
                        position: index,
                    });
                }
            };
            let mut held = self.holds.members(operand);
            while let Some(subject) = held.next_in(&self.holds) {
                let fate = self.as_done_to(subject, opcode, operation.key.is_some(), fate);
                self.add_fate(subject, fate, place);
                add_operand(self, u32::from(subject));
            }
            if may_be_unlisted {
                add_operand(self, UNLISTED);
            }
        }
    }

    fn note_terminator(&mut self, kind: TerminatorKind, operand: Option<ValueId>, place: Place) {
        let every_result = self.results_mask();
        match kind {
            TerminatorKind::Return | TerminatorKind::ReturnCall => {
                self.returns.push(place);
                let undefined = match operand {
                    Some(_) => None,
                    None => self.undefined_result(),
                };
                let is_listed = match operand {
                    Some(operand) => !self.is_unlisted[operand.index()],
                    None => undefined.is_some(),
                };
                if !is_listed || self.function.result_count != 1 {
                    self.results_fully_listed = 0;
                }
                let fate = match self.is_coroutine() {
                    true => {
                        ValueFate::IS_RETURNED
                            | ValueFate::IS_STORED_IN_UNKNOWN_OBJECT
                            | ValueFate::HAS_MEMBERS_READ
                    }
                    false => ValueFate::IS_RETURNED,
                };
                let note_returned = |walk: &mut Walk<'_, W>, subject: u16| {
                    walk.subjects[subject as usize].results |= every_result;
                    walk.add_fate(subject, fate, place);
                };
                if let Some(operand) = operand {
                    let mut returned = self.holds.members(operand);
                    while let Some(subject) = returned.next_in(&self.holds) {
                        note_returned(self, subject);
                    }
                }
                if let Some(undefined) = undefined {
                    note_returned(self, undefined);
                }
            }
            TerminatorKind::Throw | TerminatorKind::Rethrow => {
                let Some(operand) = operand else {
                    return;
                };
                let mut thrown = self.holds.members(operand);
                while let Some(subject) = thrown.next_in(&self.holds) {
                    self.add_fate(subject, ValueFate::IS_THROWN, place);
                }
            }
            TerminatorKind::Jump
            | TerminatorKind::Branch
            | TerminatorKind::Switch
            | TerminatorKind::SwitchString
            | TerminatorKind::Unreachable => {}
        }
    }

    fn undefined_result(&mut self) -> Option<u16> {
        if self.undefined_result == NO_SUBJECT {
            self.undefined_result = self.add_subject(RelationSubjectKind::Constant, UNLISTED)?;
        }
        Some(self.undefined_result)
    }

    fn is_coroutine(&self) -> bool {
        self.function
            .flags
            .intersects(FunctionFlags::IS_ASYNC | FunctionFlags::IS_GENERATOR)
    }

    fn results_mask(&self) -> u32 {
        (1u64 << self.function.result_count.min(32)).wrapping_sub(1) as u32
    }

    fn shown_index(&self, subject: &Subject) -> u32 {
        match subject.kind {
            RelationSubjectKind::Parameter => subject.index,
            _ if subject.index == UNLISTED => UNLISTED,
            _ => self.number_of(ValueId::new(subject.index as usize)),
        }
    }

    fn number_of(&self, value: ValueId) -> u32 {
        let number = self.function.value_numbers[value.index()];
        number
            .expect("a value of a reached block has a number")
            .to_word()
    }

    fn note_uses(&mut self) {
        let function = self.function;
        for (number, &id) in (0u32..).zip(function.order) {
            let block = &function.blocks[id.index()];
            for (position, &value) in (0u32..).zip(&block.values) {
                self.places[value.index()] = Place {
                    block: number,
                    position,
                };
            }
            for (position, &value) in (0u32..).zip(&block.values) {
                self.note_uses_of(
                    value,
                    Place {
                        block: number,
                        position,
                    },
                );
            }
            let position = block.values.len() as u32;
            let operand = self.operations.terminator_operands[id.index()];
            self.note_terminator(
                terminator_of(block).kind,
                operand,
                Place {
                    block: number,
                    position,
                },
            );
        }
    }
}

struct Dominators {
    // By the number of the block. The entry block is its own.
    immediate: Vec<u32>,
    leaves_early: Vec<bool>,
    // The block lies between the target of an edge that goes back and the block the edge comes from.
    may_run_again: Vec<bool>,
}

impl Dominators {
    fn new(function: &WalkedFunction<'_>) -> Dominators {
        let count = function.order.len();
        let number_of = |block: BlockId| {
            function.block_numbers[block.index()].map(|number| number.index() as u32)
        };
        let mut predecessors: Vec<SmallVec<[u32; 4]>> = vec![SmallVec::new(); count];
        let mut leaves_early = vec![false; count];
        let mut may_run_again = vec![false; count];
        for (number, &block) in (0u32..).zip(function.order) {
            let block = &function.blocks[block.index()];
            leaves_early[number as usize] = block.handler.is_some();
            for target in terminator_of(block).targets.iter().chain(&block.handler) {
                if let Some(target) = number_of(target.block) {
                    predecessors[target as usize].push(number);
                    if target <= number {
                        may_run_again[target as usize..=number as usize].fill(true);
                    }
                }
            }
        }
        const UNKNOWN: u32 = u32::MAX;
        let mut immediate = vec![UNKNOWN; count];
        immediate[0] = 0;
        let intersect = |immediate: &[u32], mut left: u32, mut right: u32| {
            while left != right {
                while left > right {
                    left = immediate[left as usize];
                }
                while right > left {
                    right = immediate[right as usize];
                }
            }
            left
        };
        loop {
            let mut has_changed = false;
            for block in 1..count {
                let known = predecessors[block]
                    .iter()
                    .copied()
                    .filter(|&it| immediate[it as usize] != UNKNOWN);
                let Some(new) = known.reduce(|left, right| intersect(&immediate, left, right))
                else {
                    continue;
                };
                has_changed |= core::mem::replace(&mut immediate[block], new) != new;
            }
            if !has_changed {
                return Dominators {
                    immediate,
                    leaves_early,
                    may_run_again,
                };
            }
        }
    }

    // Whoever gets to `later` has been through `earlier`. A block with a handler may be left in front of any of its operations.
    fn comes_first(&self, earlier: Place, later: Place) -> bool {
        if earlier.block == later.block {
            return earlier.position < later.position;
        }
        if self.leaves_early[earlier.block as usize] {
            return false;
        }
        let mut block = later.block;
        while block > earlier.block {
            block = self.immediate[block as usize];
        }
        block == earlier.block
    }
}

impl<const W: usize> Walk<'_, W> {
    fn is_left_out(&self, subject: u32) -> bool {
        self.subjects[subject as usize].is_left_out
    }

    // A literal, the result of an operator and the result of a call say something only where they go somewhere.
    fn leave_out_unused_values(&mut self) {
        let mut is_used = core::mem::take(&mut self.is_used);
        is_used.resize(self.subjects.len(), false);
        for (subject, record) in self.subjects.iter().enumerate() {
            is_used[subject] |= match record.kind {
                RelationSubjectKind::Parameter
                | RelationSubjectKind::Allocation
                | RelationSubjectKind::ReadFrom => true,
                RelationSubjectKind::CallResult => !record.fate.is_empty(),
                RelationSubjectKind::Constant | RelationSubjectKind::Computed => {
                    record.fate.intersects(KEEPS)
                }
            };
            if record.source != NO_SUBJECT {
                is_used[record.source as usize] = true;
            }
        }
        for store in &self.stores {
            if store.source != NO_SUBJECT {
                is_used[store.source as usize] = true;
            }
        }
        for handed in &self.handed {
            if handed.source != UNLISTED {
                is_used[handed.source as usize] = true;
            }
        }
        let listed = || {
            self.operands
                .iter()
                .filter(|operand| operand.source != UNLISTED)
        };
        // From the last row to the first: an operand comes in front of its user but where a loop carries it round.
        loop {
            let mut has_changed = false;
            for operand in listed().rev() {
                let is_needed = is_used[operand.user as usize];
                has_changed |=
                    is_needed && !core::mem::replace(&mut is_used[operand.source as usize], true);
            }
            if !has_changed {
                break;
            }
        }
        for (subject, &is_used) in is_used.iter().enumerate() {
            let kind = self.subjects[subject].kind;
            let is_value = matches!(
                kind,
                RelationSubjectKind::CallResult
                    | RelationSubjectKind::Constant
                    | RelationSubjectKind::Computed
            );
            self.subjects[subject].is_left_out |= is_value && !is_used;
        }
        self.is_used = is_used;
        // The row of a store goes with its target, and then the flag says what the row said.
        for index in 0..self.stores.len() {
            let Store { source, target, .. } = self.stores[index];
            if source != NO_SUBJECT && self.subjects[target as usize].is_left_out {
                self.subjects[source as usize].fate |= ValueFate::IS_STORED_IN_UNKNOWN_OBJECT;
            }
        }
    }

    // By the place of the kind, the length of the path, the index that is shown, the source.
    fn sort_key_of(&self, record: &Subject) -> u64 {
        (u64::from(place_of(record.kind)) << 56)
            | (u64::from(record.path_length) << 48)
            | (u64::from(self.shown_index(record)) << 16)
            | u64::from(record.source)
    }

    fn order_subjects(&mut self) {
        let mut order = core::mem::take(&mut self.order);
        for (subject, record) in (0u16..).zip(&self.subjects) {
            if !record.is_left_out {
                order.push((self.sort_key_of(record), subject));
            }
        }
        order.sort_unstable_by_key(|&(key, _)| key);
        self.order = order;
    }

    // Asked when the departures are in the order of their subjects.
    fn departures_of(&self, subject: u16) -> impl Iterator<Item = Place> {
        let first = self
            .departures
            .partition_point(|&(other, _)| other < subject);
        let departures = self.departures[first..].iter();
        departures
            .take_while(move |&&(other, _)| other == subject)
            .map(|&(_, place)| place)
    }

    fn apply_rules_of_whole_function(&mut self) {
        let is_coroutine = self.is_coroutine();
        for subject in &mut self.subjects {
            // The activation outlives the call.
            if is_coroutine && subject.kind == RelationSubjectKind::Parameter {
                subject.fate |= ValueFate::IS_STORED_IN_UNKNOWN_OBJECT;
            }
            if self.hides_uses_of_parameters {
                subject.fate |= ValueFate::IS_INCOMPLETE;
            }
        }
        if self.hides_uses_of_parameters {
            self.results_fully_listed = 0;
        }
    }

    fn finish(mut self) -> (FunctionRelations, RelationsScratch) {
        self.apply_rules_of_whole_function();
        self.leave_out_unused_values();
        self.order_subjects();
        self.final_numbers.resize(self.subjects.len(), u32::MAX);
        for (number, &(_, subject)) in (0u32..).zip(&self.order) {
            self.final_numbers[subject as usize] = number;
        }

        let question_count = self.stores.len() * (self.returns.len() + self.departures.len());
        // Of no other store is it asked what comes first.
        let asks_for_order = self
            .stores
            .iter()
            .any(|store| store.is_sure_of_target && !store.is_at_creation);
        let dominators = (asks_for_order && question_count <= MAX_ORDER_QUESTIONS)
            .then(|| Dominators::new(self.function));
        if asks_for_order {
            self.departures
                .sort_unstable_by_key(|&(subject, _)| subject);
        }
        let mut stores: Vec<StoredInto> = Vec::with_capacity(self.stores.len());
        for store in &self.stores {
            if self.is_left_out(u32::from(store.target)) {
                continue;
            }
            let is_source_listed =
                store.source != NO_SUBJECT && !self.is_left_out(u32::from(store.source));
            // What an object holds from its creation it holds wherever it gets to.
            let comes_first = |later: Place| {
                store.is_at_creation
                    || dominators
                        .as_ref()
                        .is_some_and(|dominators| dominators.comes_first(store.place, later))
            };
            // A subject stands for every object that its operation makes: one that is made again behind the store has not been through it.
            let target = &self.subjects[store.target as usize];
            let is_one_object = store.is_sure_of_target
                && (target.kind == RelationSubjectKind::Parameter
                    || store.is_at_creation
                    || dominators.as_ref().is_some_and(|dominators| {
                        let made = self.places[target.index as usize];
                        let is_made_once = !dominators.may_run_again[made.block as usize];
                        (is_made_once || made.block == store.place.block)
                            && dominators.comes_first(made, store.place)
                    }));
            stores.push(StoredInto {
                source: match is_source_listed {
                    true => self.final_numbers[store.source as usize],
                    false => UNLISTED,
                },
                target: self.final_numbers[store.target as usize],
                key: store.key,
                creation_operand: store.creation_operand,
                is_on_every_path: is_one_object
                    && (store.is_at_creation
                        || self.returns.iter().all(|&place| comes_first(place))),
                is_before_target_leaves: is_one_object
                    && (store.is_at_creation || self.departures_of(store.target).all(&comes_first)),
            });
        }
        let key_of = |store: &StoredInto| {
            (
                store.source,
                store.target,
                store.key.map(PropertyKeyId::to_word),
                store.creation_operand,
            )
        };
        stores.sort_unstable_by_key(key_of);
        stores.dedup_by(|next, kept| {
            let is_same = key_of(next) == key_of(kept);
            if is_same {
                kept.is_on_every_path |= next.is_on_every_path;
                kept.is_before_target_leaves |= next.is_before_target_leaves;
            }
            is_same
        });

        for handed in &mut self.handed {
            if handed.source != UNLISTED {
                handed.source = self.final_numbers[handed.source as usize];
            }
        }
        self.handed
            .sort_unstable_by_key(|handed| (handed.call, handed.argument, handed.source));
        self.handed.dedup();

        let subjects = &self.subjects;
        self.operands
            .retain(|operand| !subjects[operand.user as usize].is_left_out);
        for operand in &mut self.operands {
            if operand.source != UNLISTED {
                operand.source = self.final_numbers[operand.source as usize];
            }
            operand.user = self.final_numbers[operand.user as usize];
        }
        self.operands
            .sort_unstable_by_key(|operand| (operand.user, operand.position, operand.source));
        self.operands.dedup();

        let subjects = self.order.iter().map(|&(_, subject)| {
            let record = &self.subjects[subject as usize];
            RelationSubject {
                kind: record.kind,
                index: self.shown_index(record),
                source: match record.source {
                    NO_SUBJECT => 0,
                    source => self.final_numbers[source as usize],
                },
                key: record.key,
                fate: record.fate,
                results: record.results,
            }
        });
        let relations = FunctionRelations {
            subjects: subjects.collect(),
            stores,
            handed: self.handed.clone(),
            operands: self.operands.clone(),
            results_fully_listed: self.results_fully_listed,
        };
        (relations, self.into_scratch())
    }
}

// What the function does with what it is handed and with what it makes, in terms of its own values: no type, no callee's body.
pub(super) fn relate(
    function: &WalkedFunction<'_>,
    operations: &Operations,
    scratch: &mut RelationsScratch,
) -> FunctionRelations {
    // A subject is a value, or a read out of one of several sources. A function that has more of them than its sets have room for says of the rest that it does not know.
    match function.values.len() {
        0..=48 => relate_with::<1>(function, operations, scratch),
        49..=200 => relate_with::<4>(function, operations, scratch),
        201..=800 => relate_with::<16>(function, operations, scratch),
        _ => relate_with::<64>(function, operations, scratch),
    }
}

fn relate_with<const W: usize>(
    function: &WalkedFunction<'_>,
    operations: &Operations,
    scratch: &mut RelationsScratch,
) -> FunctionRelations {
    let mut walk = Walk::<W>::new(function, operations, core::mem::take(scratch));
    walk.add_parameters();
    walk.add_allocations_and_calls();
    walk.follow_values();
    walk.note_uses();
    let (relations, recycled) = walk.finish();
    *scratch = recycled;
    relations
}
