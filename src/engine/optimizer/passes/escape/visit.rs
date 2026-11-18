//! What each instruction does to the picture. What is not named here wants to see the objects among its operands.

use bun_engine_asm::Cond;
use bun_engine_codegen::ir::{Binary, Heap, Load, Op, Store, Type, Value as Ssa};
use bun_engine_vm::CellType;

use super::make::Run;
use super::objects::{EXECUTABLE, MOST_WORDS, Object, Part, is_made_by};
use super::picture::{Entry, Id, MOST_ENTRIES, Picture, Word};
use super::{Meaning, Sinking, answers};
use crate::graph::{Kind, ModeSet, ShapeSet, Transition, TypeName};

impl Sinking<'_> {
    pub(super) fn visit(&mut self, value: Ssa) {
        let node = self.graph.node(value);
        if self.now.entries.is_empty() && !node.is_some_and(|it| is_made_by(it.0)) {
            return;
        }
        self.before = value;
        if node.is_some_and(|it| it.0.can_collect()) {
            self.run = Run::None;
        }
        let is_done = match node {
            Some((kind, data)) => self.visit_node(value, kind, data),
            None => self.visit_instruction(value),
        };
        if is_done.is_none() {
            self.keep(value, node.map(|it| it.0));
        }
    }

    fn keep(&mut self, value: Ssa, kind: Option<Kind>) {
        let operands = self.graph.function.operands(value);
        let checked =
            (kind.filter(|&it| it.gives_operand())).and_then(|_| self.word_for(operands[0]));
        for position in 0..operands.len() {
            let operand = self.graph.function.operands(value)[position];
            let real = match self.meaning(operand) {
                Meaning::Object(id) => self.make(id),
                Meaning::StorageOf(id) => self.make_with_storage(id),
                _ => continue,
            };
            if !self.is_on_trial() {
                self.graph.function.operands_mut(value)[position] = real;
            }
        }
        if let Some(id) = checked.and_then(Word::as_object) {
            self.set_meaning(value, Meaning::Checked(id));
        }
        self.update_state(value, kind);
        self.extend_run(value, kind);
    }

    fn visit_instruction(&mut self, value: Ssa) -> Option<()> {
        let function = &self.graph.function;
        match *function.op(value) {
            Op::Load {
                kind: Load::Full,
                address,
                offset,
                ..
            } if function.type_of(value) == Type::I64 => self.load(value, address, offset),
            Op::Store {
                kind: Store::Full,
                args: [stored, address],
                offset,
                access,
            } if function.type_of(stored) == Type::I64 => {
                self.store(stored, (address, offset), access.heap())?;
                self.drop_instruction(value)
            }
            Op::Compare(cond @ (Cond::Eq | Cond::Ne), operands) => {
                let is_same = self.is_same_object(operands).or_else(|| {
                    let [first, second] = self.constants(operands)?;
                    Some(first == second)
                });
                self.answer(value, is_same? == (cond == Cond::Eq))
            }
            Op::Binary(Binary::Xor, [boolean, one]) if function.is_int_constant(one, 1) => {
                let is_narrow = function.type_of(value) == Type::I32;
                let found = self.found_integer(boolean).filter(|_| is_narrow)?;
                let negated = self.graph.function.const32(found as i32 ^ 1);
                self.replace(value, Word::value(negated))
            }
            _ => None,
        }
    }

    fn visit_node(&mut self, value: Ssa, kind: Kind, data: u32) -> Option<()> {
        if is_made_by(kind) {
            return self.put_off(value, kind, data);
        }
        let operands = self.graph.function.operands(value);
        let (first, second) = (*operands.first()?, operands.get(1).copied());
        match kind {
            Kind::StrictEqual => {
                let operands = [first, second?];
                let is_equal = self.is_same_object(operands).or_else(|| {
                    let constants = self.constants(operands)?.map(|it| it as u64);
                    answers::are_strictly_equal(self.graph, constants)
                });
                return self.answer(value, is_equal?);
            }
            Kind::LooseEqual => {
                let operands = [first, second?];
                let are_objects = operands.iter().all(|&it| self.object_behind(it).is_some());
                let is_same = self.is_same_object(operands).filter(|_| are_objects);
                return self.answer(value, is_same?);
            }
            Kind::CheckIdentical if self.word_for(first)? == self.word_for(second?)? => {
                return self.replace(value, Word::value(second?));
            }
            Kind::Verify if operands.iter().any(|&it| self.is_put_off(it)) => {
                return self.drop_instruction(value);
            }
            Kind::StoreBarrier if self.is_put_off(first) => return self.drop_instruction(value),
            Kind::ToObject | Kind::ToThis => {
                let id = self.word_for(first)?.as_object()?;
                let made = self.graph.allocations[self.object(id).allocation as usize];
                (answers::ORDINARY.contains(self.graph.shapes[made.shape].ty)).then_some(())?;
                return self.replace(value, Word::object(id));
            }
            _ => {}
        }
        match self.virtual_object(first) {
            Some(position) => self.look_at(value, (kind, data), position, second),
            None if answers::is_test(kind) => self.test_found(value, (kind, data), first),
            None => None,
        }
    }

    /// The first operand is the object at the position.
    fn look_at(
        &mut self,
        value: Ssa,
        (kind, data): (Kind, u32),
        position: usize,
        second: Option<Ssa>,
    ) -> Option<()> {
        let Entry { id, shape, .. } = self.now.entries[position];
        let facts = self.graph.shapes[shape];
        let is_function = self.object(id).kind == Kind::NewFunction;
        let executable = is_function.then(|| self.now.words_at(position)[EXECUTABLE]);
        let has_modes = || {
            let wanted = self.graph.mode_check_at(data).wanted;
            wanted.contains(ModeSet::single(facts.indexing_mode))
        };
        let passes = match kind {
            Kind::Refine | Kind::Assume | Kind::RefineShape => true,
            Kind::CheckType => self.graph.interned_type(data).contains(facts.ty),
            Kind::CheckShape => {
                (self.graph.shapes).is_subset(ShapeSet::single(shape), ShapeSet(data))
            }
            Kind::CheckModes => has_modes(),
            Kind::HasModes => return self.answer(value, has_modes()),
            Kind::CheckExecutable => Some(executable?) == self.word_for(second?),
            Kind::LoadExecutable => return self.replace(value, executable?),
            Kind::LoadShapeId => {
                let id = self.graph.function.const32(facts.id.bits() as i32);
                return self.replace(value, Word::value(id));
            }
            Kind::PlainTypeof | Kind::GenericTypeof => {
                let name = self.graph.type_names[TypeName::of(facts.ty)? as usize];
                let name = self.graph.function.const64(name as i64);
                return self.replace(value, Word::value(name));
            }
            Kind::IsCellOfType => {
                return self.answer(value, facts.cell_type == CellType(data as u8));
            }
            Kind::SetShape => {
                self.change_shape(position, data)?;
                return self.drop_instruction(value);
            }
            Kind::GrowSlots => {
                self.change_shape(position, data)?;
                self.set_meaning(value, Meaning::StorageOf(id));
                return self.drop_instruction(value);
            }
            _ => {
                let answer = answers::from_type(self.graph, (kind, data), facts.ty)?;
                return self.answer(value, answer);
            }
        };
        passes.then_some(())?;
        self.replace(value, Word::object(id))
    }

    /// Of what has been taken from an object.
    fn test_found(&mut self, value: Ssa, node: (Kind, u32), tested: Ssa) -> Option<()> {
        let Meaning::Value(found) = self.meaning(self.without_checks(tested)) else {
            return None;
        };
        let answer = match self.graph.constant(found) {
            Some(bits) => answers::from_constant(self.graph, node, bits),
            // Trials do not have what is added.
            None if self.meanings.get(found).is_none() => None,
            None => answers::from_type(self.graph, node, self.graph.inherent_type(found)),
        };
        self.answer(value, answer?)
    }

    fn put_off(&mut self, value: Ssa, kind: Kind, allocation: u32) -> Option<()> {
        let id = self.pointers.number(value)?;
        let graph = &*self.graph;
        let object = self.objects[id.index()]
            .get_or_insert_with(|| Object::new(graph, value, kind, allocation));
        let (count, fixed) = (object.inline_words, object.fixed_words());
        self.find_room(count)?;
        let first_word = self.now.words.len();
        self.now.words.resize(first_word + count, self.empty);
        for (position, &word) in fixed.iter().enumerate() {
            let operand = self.graph.function.operands(value)[position];
            self.now.words[first_word + word] = self.word_for(operand)?;
        }
        debug_assert!(self.now.entries.iter().all(|it| it.id != id));
        let stamp = self.new_stamp();
        self.now.entries.push(Entry {
            id,
            made: Ssa::NONE,
            shape: self.graph.allocations[allocation as usize].shape,
            stamp,
            first_word: first_word as u32,
            word_count: count as u8,
        });
        self.run = Run::Filling(id);
        self.replace(value, Word::object(id))
    }

    /// For one more object. Positions may change.
    fn find_room(&mut self, words: usize) -> Option<()> {
        let most_words = self.most_words;
        let has_room = |picture: &Picture| {
            picture.entries.len() < MOST_ENTRIES && picture.words.len() + words <= most_words
        };
        if !has_room(&self.now) {
            self.forget_what_is_dead();
        }
        has_room(&self.now).then_some(())
    }

    fn forget_what_is_dead(&mut self) {
        let function = &self.graph.function;
        let rest = core::iter::successors(Some(self.before), |&it| function.next(it).expand());
        let used = rest.flat_map(|it| {
            let states = self.graph.states_for(it).into_iter();
            let held = states.flat_map(|it| function.state(it));
            function.operands(it).iter().chain(held).copied()
        });
        let edges = function.successors(function.block_of(self.before));
        let roots = edges.fold(self.pointed_to_by(used), |all, edge| {
            all | self.pointed_to_along(edge)
        });
        let mut picture = self.spare.pop().unwrap_or_default();
        (self.now).copy_part(self.now.reachable_from(roots), &mut picture);
        core::mem::swap(&mut self.now, &mut picture);
        self.recycle(picture);
    }

    /// Nothing looks between the growing of the storage and the new shape, so they are taken for one step.
    fn change_shape(&mut self, position: usize, transition: u32) -> Option<()> {
        let Transition { from, to } = self.graph.transitions[transition as usize];
        let entry = self.now.entries[position];
        let object = self.object(entry.id);
        let count = object.inline_words + self.graph.shapes[to].out_of_line_capacity as usize;
        let old = usize::from(entry.word_count);
        let fits = old == count
            || old < count
                && count <= MOST_WORDS
                && self.now.words.len() + count <= self.most_words;
        (object.kind == Kind::NewObject && [from, to].contains(&entry.shape) && fits)
            .then_some(())?;
        let mut first_word = entry.first_word as usize;
        if old != count {
            let words = &mut self.now.words;
            let moved = first_word..first_word + old;
            first_word = words.len();
            words.extend_from_within(moved);
            words.resize(first_word + count, self.empty);
        }
        self.now.entries[position] = Entry {
            shape: to,
            stamp: self.new_stamp(),
            first_word: first_word as u32,
            word_count: count as u8,
            ..entry
        };
        self.run = Run::None;
        Some(())
    }

    fn part_at(&self, address: Ssa, offset: i32) -> Option<(usize, Part)> {
        let id = self.object_behind(address)?;
        let position = self.now.position(id);
        let entry = Some(&self.now.entries[position]).filter(|it| it.is_virtual())?;
        let part = match self.meaning(address) {
            Meaning::StorageOf(_) => {
                (self.object(id)).part_in_storage(offset, entry.word_count.into())
            }
            _ => self.object(id).part_in_cell(offset),
        };
        Some((position, part?))
    }

    fn load(&mut self, value: Ssa, address: Ssa, offset: i32) -> Option<()> {
        let (position, part) = self.part_at(address, offset)?;
        let Part::Word(word) = part else {
            let id = self.now.entries[position].id;
            self.pointers.number(value)?;
            self.set_meaning(value, Meaning::StorageOf(id));
            return self.drop_instruction(value);
        };
        let word = self.now.words_at(position)[word];
        if let Some(found) = word.as_value()
            && !self.is_on_trial()
            && self.graph.prediction(found).is_empty()
            && !matches!(self.graph.function.op(found), Op::Param(_))
            && self.graph.kind(found).is_none()
        {
            self.graph.predict(found, self.graph.prediction(value));
        }
        self.replace(value, word)
    }

    fn store(&mut self, stored: Ssa, (address, offset): (Ssa, i32), heap: Heap) -> Option<()> {
        let (position, Part::Word(word)) = self.part_at(address, offset)? else {
            return None;
        };
        let (id, stored) = (self.now.entries[position].id, self.word_for(stored)?);
        let object = self.objects[id.index()].as_mut()?;
        (!object.fixed_words().contains(&word)).then_some(())?;
        object.note_store(word, heap);
        self.end_run_unless_filling(id);
        if core::mem::replace(&mut self.now.words_at_mut(position)[word], stored) != stored {
            self.now.entries[position].stamp = self.new_stamp();
        }
        Some(())
    }

    // Helpers

    fn virtual_object(&self, value: Ssa) -> Option<usize> {
        let Meaning::Object(id) = self.meaning(value) else {
            return None;
        };
        let position = self.now.position(id);
        self.now.entries[position].is_virtual().then_some(position)
    }

    fn is_put_off(&self, value: Ssa) -> bool {
        (self.object_behind(value)).is_some_and(|id| self.now.entry(id).is_virtual())
    }

    /// All that points to an object that has not been made is known to.
    fn is_same_object(&self, operands: [Ssa; 2]) -> Option<bool> {
        let [first, second] = operands.map(|it| self.word_for(it));
        let [first, second] = [first?.as_object(), second?.as_object()];
        let is_virtual = |id: Option<Id>| id.is_some_and(|id| self.now.entry(id).is_virtual());
        (is_virtual(first) || is_virtual(second)).then_some(first == second)
    }

    /// If it is thanks to this pass.
    fn constants(&self, operands: [Ssa; 2]) -> Option<[i64; 2]> {
        let found = operands.map(|it| self.found_integer(self.without_checks(it)));
        found.iter().any(Option::is_some).then_some(())?;
        let constant = |position: usize| {
            found[position].or_else(|| self.graph.function.int_constant(operands[position]))
        };
        Some([constant(0)?, constant(1)?])
    }

    /// Unlike the root, the same on trial and afterwards.
    fn without_checks(&self, mut value: Ssa) -> Ssa {
        while self.graph.kind(value).is_some_and(Kind::gives_operand) {
            value = self.graph.function.operands(value)[0];
        }
        value
    }

    fn answer(&mut self, value: Ssa, answer: bool) -> Option<()> {
        let constant = self.graph.function.const32(answer.into());
        self.replace(value, Word::value(constant))
    }

    fn drop_instruction(&mut self, value: Ssa) -> Option<()> {
        if !self.is_on_trial() {
            self.graph.function.remove(value);
        }
        Some(())
    }

    fn replace(&mut self, value: Ssa, mut word: Word) -> Option<()> {
        if let Some(id) = word.as_object() {
            if self.pointers.number(value).is_some() {
                self.set_meaning(value, Meaning::Object(id));
                return self.drop_instruction(value);
            }
            let made = self.make(id);
            word = match self.is_on_trial() {
                true => Word::UNKNOWN,
                false => Word::value(made),
            };
        }
        if let Some(other) = word.as_value() {
            self.set_meaning(value, Meaning::Value(other));
            if !self.is_on_trial() {
                self.graph.function.replace(value, other);
            }
        }
        Some(())
    }
}
