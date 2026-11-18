use bun_engine_codegen::ir::{State, Value as Ssa};
use bun_engine_vm::{CellType, SpeculatedType as T, Storage};
use smallvec::SmallVec;

use super::Specializer;
use crate::graph::probes::Claim;
use crate::graph::{
    Conversion, ExitKind, Kind, Known, ModeSet, ShapeSet, TypeCheck, TypeName, heaps,
};

impl Specializer<'_> {
    pub(super) fn type_of(&self, value: Ssa) -> T {
        self.knowledge.type_of(self.graph, value)
    }

    pub(super) fn is(&self, value: Ssa, ty: T) -> bool {
        self.knowledge.is(self.graph, value, ty)
    }

    pub(super) fn expected(&self, value: Ssa) -> T {
        let (root, known) = (self.graph.root(value), self.type_of(value));
        let expected = self.graph.prediction(root) & (known | T::INT52);
        if expected.is_empty() { known } else { expected }
    }

    pub(super) fn alias(&mut self, value: Ssa) -> Ssa {
        let root = self.graph.root(value);
        let Some(&Known { alias, ty, .. }) = self.knowledge.get(root) else {
            return root;
        };
        alias.expand().unwrap_or_else(|| {
            let data = self.graph.intern_type(ty);
            let alias = self.ir().node(
                Kind::Refine.id(),
                bun_engine_codegen::ir::Type::I64,
                &[root],
                data,
                State::NONE,
            );
            self.knowledge.entry(self.graph, root).alias = alias;
            alias
        })
    }

    pub(super) fn check_type(&mut self, value: Ssa, ty: T, failure: ExitKind) -> Ssa {
        let (alias, known) = (self.alias(value), self.type_of(value));
        if ty.contains(known) {
            self.verify(Claim::Type(known), &[alias]);
            return alias;
        }
        let data = self.graph.type_check(TypeCheck {
            wanted: ty,
            known,
            failure,
        });
        let checked = self.node(Kind::CheckType, &[alias], data);
        self.knowledge.learn_type(self.graph, value, ty, checked);
        checked
    }

    /// That takes no longer than to check for all that would do, and tells more.
    fn check_for_what_is_expected(&mut self, value: Ssa, wanted: T) {
        let expected = self.expected(value);
        let mut narrower = [T::INT32, T::BOXED_NUMBER, T::STRING, T::SYMBOL].into_iter();
        if !self.is(value, wanted)
            && !self.has_exited(ExitKind::BadType)
            && let Some(ty) = narrower.find(|&it| it.contains(expected) && wanted.contains(it))
        {
            self.check_type(value, ty, ExitKind::BadType);
        }
    }

    /// For a node that goes by what is expected and known of an operand, which is not empty.
    pub(super) fn description_of(&self, value: Ssa) -> TypeCheck {
        TypeCheck::describing(
            self.expected(value).boxed(),
            self.type_of(value) & T::HEAP_TOP,
        )
    }

    pub(super) fn inspect(&mut self, kind: Kind, operands: &[Ssa]) -> Ssa {
        let data = self.graph.type_check(self.description_of(operands[0]));
        let operands: SmallVec<[Ssa; 2]> = operands.iter().map(|&it| self.alias(it)).collect();
        self.node(kind, &operands, data)
    }

    fn set_data(&mut self, data: u32) {
        if let Some((_, own)) = self.graph.function.op_mut(self.at).node_mut() {
            *own = data;
        }
    }

    fn describe_operand(&mut self, kind: Kind, value: Ssa) {
        self.keep_check(value);
        let data = self.graph.type_check(self.description_of(value));
        self.set_data(data);
        (self.knowledge).note_effects(self.graph, kind.effects(), kind.can_collect());
    }

    fn fold_test(&mut self, always: bool, never: bool) {
        if always || never {
            let constant = self.graph.function.const32(always.into());
            self.graph.function.replace(self.at, constant);
        }
    }

    /// Ties the check to the latest form of its operand.
    fn keep_check(&mut self, value: Ssa) {
        if self.knowledge.get(self.graph.root(value)).is_some() {
            let alias = self.alias(value);
            self.graph.function.operands_mut(self.at)[0] = alias;
        }
    }

    fn narrow_mode_check(&mut self, cell: Ssa, data: u32) {
        self.keep_check(cell);
        let mut check = self.graph.mode_check_at(data);
        check.known = self.knowledge.modes_of(self.graph, cell);
        let data = self.graph.mode_check(check);
        if let Some((_, own)) = self.graph.function.op_mut(self.at).node_mut() {
            *own = data;
        }
    }

    fn drop_check(&mut self, value: Ssa) {
        let alias = self.alias(value);
        self.graph.function.replace(self.at, alias);
    }

    pub(super) fn refine(&mut self, kind: Kind, data: u32, first: Ssa, second: Ssa) {
        match kind {
            Kind::CheckType => {
                let check = self.graph.type_check_at(data);
                if check.failure == ExitKind::Inconvertible {
                    self.check_for_what_is_expected(first, check.wanted);
                }
                let checked = (self.check_shape_instead(first, check))
                    .unwrap_or_else(|| self.check_type(first, check.wanted, check.failure));
                self.graph.function.replace(self.at, checked);
            }
            Kind::CheckShape => {
                let known = self.knowledge.shapes_of(self.graph, first);
                if self.graph.shapes.is_subset(known, ShapeSet(data)) {
                    self.verify(Claim::Shapes(known), &[first]);
                    return self.drop_check(first);
                }
                self.keep_check(first);
                let narrowed = self.graph.shapes.intersection(known, ShapeSet(data));
                self.knowledge
                    .learn_shapes(self.graph, first, narrowed, self.at);
            }
            Kind::CheckModes => {
                let wanted = self.graph.mode_check_at(data).wanted;
                if self.knowledge.has_modes(self.graph, first, wanted) {
                    self.verify(Claim::Modes(wanted), &[first]);
                    return self.drop_check(first);
                }
                self.narrow_mode_check(first, data);
                (self.knowledge).learn_modes(self.graph, first, wanted, self.at);
            }
            Kind::HasModes => {
                let wanted = self.graph.mode_check_at(data).wanted;
                let [always, never] = [wanted, ModeSet::ANY.without(wanted)]
                    .map(|modes| self.knowledge.has_modes(self.graph, first, modes));
                if always || never {
                    return self.fold_test(always, never);
                }
                self.narrow_mode_check(first, data);
            }
            Kind::CheckIdentical => {
                if self.graph.root(first) == second {
                    return self.drop_check(first);
                }
                self.knowledge.learn_type(
                    self.graph,
                    first,
                    self.graph.inherent_type(second),
                    self.at,
                );
            }
            Kind::CheckExecutable => {
                self.knowledge
                    .learn_type(self.graph, first, T::FUNCTION, self.at)
            }
            Kind::Refine | Kind::Assume => self.knowledge.learn_type(
                self.graph,
                first,
                self.graph.interned_type(data),
                self.at,
            ),
            Kind::RefineShape => {
                let known = self.knowledge.shapes_of(self.graph, first);
                let narrowed = self.graph.shapes.intersection(known, ShapeSet(data));
                (self.knowledge).learn_shapes(self.graph, first, narrowed, self.at);
            }
            Kind::LoadShapeId => match self.knowledge.shapes_of(self.graph, first).only() {
                Some(only) => {
                    let id = self.graph.shapes[only].id.bits() as i32;
                    let id = self.graph.function.const32(id);
                    self.graph.function.replace(self.at, id);
                }
                None => self.keep_check(first),
            },
            Kind::ResolveRope => {
                let resolved = T::ATOM_STRING | T::RESOLVED_STRING;
                if self.is(first, resolved) {
                    return self.drop_check(first);
                }
                (self.knowledge).note_effects(self.graph, kind.effects(), kind.can_collect());
                let known = self.knowledge.entry(self.graph, self.graph.root(first));
                (known.ty, known.alias) = (resolved, self.at);
            }
            Kind::IsType => {
                let (known, wanted) = (self.type_of(first), self.graph.type_check_at(data).wanted);
                if wanted.contains(known) || !wanted.intersects(known) {
                    return self.fold_test(wanted.contains(known), true);
                }
                self.keep_check(first);
                let data = self.graph.type_check(TypeCheck::describing(wanted, known));
                self.set_data(data);
            }
            Kind::IsCallable => {
                let known = self.type_of(first) & T::HEAP_TOP;
                if T::FUNCTION.contains(known) || !known.intersects(TypeName::MAY_BE_CALLABLE) {
                    return self.fold_test(T::FUNCTION.contains(known), true);
                }
                self.describe_operand(kind, first);
            }
            Kind::HasObjectTypeName if self.is(first, !T::OTHER_OBJECT - T::PROXY) => {
                let answer = self.is_type(first, TypeName::Object.types());
                self.graph.function.replace(self.at, answer);
            }
            Kind::PlainTypeof | Kind::GenericTypeof => {
                match TypeName::of(self.type_of(first) & T::HEAP_TOP) {
                    Some(name) => {
                        let string = self.graph.type_names[name as usize];
                        let string = self.graph.function.const64(string as i64);
                        self.graph.function.replace(self.at, string);
                    }
                    None => self.describe_operand(kind, first),
                }
            }
            Kind::ExactInt32 if self.is(first, T::INT32) => {
                let int32 = self.as_int32(first, ExitKind::BadType);
                let wide = self.ir().sign_extend(int32);
                self.graph.function.replace(self.at, wide);
            }
            Kind::HasObjectTypeName
            | Kind::OnlyUnit
            | Kind::ExistingAtom
            | Kind::ExactInt32
            | Kind::Await => {
                self.describe_operand(kind, first);
            }
            Kind::Concatenate => {
                let data = self.describe_fibers();
                self.set_data(data);
                (self.knowledge).note_effects(self.graph, kind.effects(), kind.can_collect());
            }
            Kind::Convert if self.is(first, Conversion::from_data(data).fixed()) => {
                self.drop_check(first);
            }
            Kind::ToObject if self.is(first, T::OBJECT) => self.drop_check(first),
            Kind::ToThis if self.is(first, T::OBJECT - T::OTHER_OBJECT) => self.drop_check(first),
            Kind::IsCellOfType => {
                let (known, wanted) = (self.type_of(first), T::of_cell_type(CellType(data as u8)));
                let is_exact = !wanted.intersects(T::OTHER_OBJECT | T::OTHER_CELL);
                self.fold_test(
                    is_exact && wanted.contains(known),
                    !wanted.intersects(known),
                );
            }
            Kind::SetShape => self.knowledge.note_transition(
                self.graph,
                first,
                self.graph.transitions[data as usize],
            ),
            Kind::StoreBarrier => {
                let owner = self.graph.root(first);
                if self.knowledge.is_young(owner) {
                    self.verify(Claim::NeedsNoBarrier, &[owner]);
                    self.graph.function.remove(self.at);
                    return;
                }
                let stored: SmallVec<[Ssa; 4]> = self.graph.function.operands(self.at)[1..].into();
                if !stored.is_empty() && stored.iter().all(|&it| self.is(it, !T::CELL)) {
                    for value in stored {
                        self.graph.note_as_no_cell(value, self.origin);
                        self.verify(Claim::Type(!T::CELL), &[value]);
                    }
                    self.graph.function.remove(self.at);
                }
            }
            Kind::CheckOriginalArray => {
                self.keep_check(first);
                (self.knowledge).learn_type(self.graph, first, T::ARRAY, self.at);
            }
            _ if kind.allocates() => {
                self.knowledge
                    .note_effects(self.graph, kind.effects(), true);
                self.knowledge.learn_young(self.at);
                let shapes = ShapeSet::single(self.graph.allocations[data as usize].shape);
                self.knowledge
                    .learn_shapes(self.graph, self.at, shapes, self.at);
                let length = match kind {
                    Kind::NewArray => {
                        let length = self.graph.allocations[data as usize].vector.length;
                        self.graph.function.const32(length as i32)
                    }
                    Kind::NewArrayOfHoles => first,
                    Kind::NewArrayFromFrame | Kind::CopyElements => second,
                    _ => return,
                };
                let offset = Storage::OFFSET_OF_PUBLIC_LENGTH as i32;
                (self.knowledge).learn_field(self.at, offset, heaps::PUBLIC_LENGTH, length);
            }
            _ => self
                .knowledge
                .note_effects(self.graph, kind.effects(), kind.can_collect()),
        }
    }
}
