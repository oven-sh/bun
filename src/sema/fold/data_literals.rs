use super::evaluate::Value;
use super::folder::{Effects, Folder};
use super::{Constant, Decision, Decisions, FoldedData, FoldedValue, slice_in};
use crate::atom::{Atom, Interner, known, number_to_string};
use crate::hir::{
    ExprId, ExprKind, File, IdList, PropId, PropKey, PropKind, Span, is_proto_setter,
};
use crate::hir_from_data::DataValue;
use crate::session::Arena;
use crate::util::FxHashMap;

const MAX_LINEAR_SEARCH_KEYS: usize = 8;

impl<'s> Folder<'_, 's> {
    pub(super) fn note_array_literal(&mut self, e: ExprId, items: IdList<ExprId>) {
        let hir = self.hir;
        if hir.ids(items).all(|item| self.is_data_part(item)) {
            self.data_literals.insert(e.idx());
        }
    }

    pub(super) fn note_object_literal(&mut self, e: ExprId, props: Span<PropId>) {
        if props.iter().all(|prop| self.is_data_property(prop)) {
            self.data_literals.insert(e.idx());
        }
    }

    fn is_data_part(&self, e: ExprId) -> bool {
        let is_literal = e.idx() < self.hir.exprs.len() && self.data_literals.contains(e.idx());
        is_literal || self.is_pure_constant(e)
    }

    fn is_data_property(&self, prop: PropId) -> bool {
        let has_constant_key = match find_data_key(self.hir, prop) {
            DataKey::Unknown => false,
            DataKey::Name(_) => true,
            DataKey::Computed(key) => self.is_pure_constant(key),
        };
        has_constant_key && self.is_data_part(self.hir[prop].value)
    }

    fn is_pure_constant(&self, e: ExprId) -> bool {
        let folded = self.folded(e);
        match (folded.value, folded.effects) {
            (Value::Known(_), Effects::None) => true,
            (Value::Known(_), Effects::Unknown | Effects::DeadZoneCheck) | (Value::Unknown, _) => {
                false
            }
        }
    }
}

#[derive(Copy, Clone)]
enum DataKey {
    Unknown,
    Name(Atom),
    Computed(ExprId),
}

fn find_data_key(hir: &File<'_>, prop: PropId) -> DataKey {
    let property = &hir[prop];
    match property.kind {
        PropKind::Init | PropKind::Shorthand => {}
        PropKind::Spread | PropKind::Method | PropKind::Getter | PropKind::Setter => {
            return DataKey::Unknown;
        }
    }
    match hir.runtime_property_key(prop) {
        PropKey::Name(_) if is_proto_setter(property) => DataKey::Unknown,
        PropKey::Name(name) => DataKey::Name(name),
        PropKey::Computed(key) => DataKey::Computed(key),
        PropKey::None | PropKey::Private(_) => DataKey::Unknown,
    }
}

fn constant_to_key(constant: Constant, atoms: &Interner<'_>) -> Atom {
    match constant {
        Constant::Undefined => known::undefined,
        Constant::Null => atoms.intern(b"null"),
        Constant::Boolean(true) => atoms.intern(b"true"),
        Constant::Boolean(false) => atoms.intern(b"false"),
        Constant::Number(number) => atoms.intern(&number_to_string(number)),
        Constant::String(text) | Constant::BigInt(text) => text,
    }
}

#[derive(Copy, Clone)]
enum Composite {
    Array(IdList<ExprId>),
    Object(Span<PropId>),
}

struct Frame {
    composite: Composite,
    next_child: usize,
    values_start: usize,
}

impl Frame {
    fn new(composite: Composite, values_start: usize) -> Frame {
        Frame {
            composite,
            next_child: 0,
            values_start,
        }
    }

    fn take_child(&mut self, hir: &File<'_>) -> Option<ExprId> {
        let index = self.next_child;
        self.next_child += 1;
        match self.composite {
            Composite::Array(items) => (index < items.len()).then(|| hir.id_at(items, index)),
            Composite::Object(props) => (index < props.len()).then(|| hir[props.at(index)].value),
        }
    }
}

enum Visited<'s> {
    Value(DataValue<'s>),
    Composite(Composite),
}

struct DataReader<'a, 'h, 's> {
    hir: &'a File<'h>,
    decisions: &'a Decisions<'s>,
    atoms: &'a Interner<'s>,
    arena: &'s Arena,
}

pub fn data_value_of<'s>(
    hir: &File<'_>,
    decisions: &Decisions<'s>,
    root: ExprId,
    atoms: &Interner<'s>,
    arena: &'s Arena,
) -> FoldedData<'s> {
    let reader = DataReader {
        hir,
        decisions,
        atoms,
        arena,
    };
    let value = reader.read(root);
    value.map_or(FoldedData::Unknown, FoldedData::Known)
}

impl<'s> DataReader<'_, '_, 's> {
    fn read(&self, root: ExprId) -> Option<DataValue<'s>> {
        let mut frames: Vec<Frame> = Vec::new();
        let mut values: Vec<DataValue<'s>> = Vec::new();
        let mut part = root;
        loop {
            match self.visit(part)? {
                Visited::Value(value) => values.push(value),
                Visited::Composite(composite) => frames.push(Frame::new(composite, values.len())),
            }
            part = loop {
                let Some(frame) = frames.last_mut() else {
                    return values.pop();
                };
                if let Some(child) = frame.take_child(self.hir) {
                    break child;
                }
                let (composite, start) = (frame.composite, frame.values_start);
                frames.pop();
                let value = self.finish(composite, &values[start..])?;
                values.truncate(start);
                values.push(value);
            };
        }
    }

    fn visit(&self, part: ExprId) -> Option<Visited<'s>> {
        let mut e = part;
        loop {
            match self.decisions.decision(e) {
                Decision::Constant(constant) => {
                    return Some(Visited::Value(constant.to_data_value()));
                }
                Decision::Data(data) => return Some(Visited::Value(*data)),
                Decision::GlobalPath(_) | Decision::DeferredData => return None,
                Decision::Unknown => {}
            }
            match self.decisions.constant(self.hir, e) {
                FoldedValue::Constant(constant)
                | FoldedValue::ConstantOutsideDeadZone(constant) => {
                    return Some(Visited::Value(constant.to_data_value()));
                }
                FoldedValue::Unknown => {}
            }
            match self.hir.exprs.get(e.idx())?.kind {
                ExprKind::As { expr, .. }
                | ExprKind::Satisfies { expr, .. }
                | ExprKind::AsConst(expr)
                | ExprKind::NonNull(expr)
                | ExprKind::Instantiation { expr, .. } => e = expr,
                ExprKind::Array(items) => return Some(Visited::Composite(Composite::Array(items))),
                ExprKind::Object(props) => return self.visit_object(props),
                _ => return None,
            }
        }
    }

    fn visit_object(&self, props: Span<PropId>) -> Option<Visited<'s>> {
        let has_data_keys = props
            .iter()
            .all(|prop| match find_data_key(self.hir, prop) {
                DataKey::Unknown => false,
                DataKey::Name(_) | DataKey::Computed(_) => true,
            });
        has_data_keys.then_some(Visited::Composite(Composite::Object(props)))
    }

    fn finish(&self, composite: Composite, values: &[DataValue<'s>]) -> Option<DataValue<'s>> {
        match composite {
            Composite::Array(_) => Some(DataValue::Array(slice_in(values, self.arena))),
            Composite::Object(props) => self.finish_object(props, values),
        }
    }

    fn finish_object(
        &self,
        props: Span<PropId>,
        values: &[DataValue<'s>],
    ) -> Option<DataValue<'s>> {
        let searches_linearly = props.len() <= MAX_LINEAR_SEARCH_KEYS;
        let mut entries: Vec<(Atom, DataValue<'s>)> = Vec::with_capacity(props.len());
        let mut entry_indexes: FxHashMap<Atom, usize> = FxHashMap::default();
        for (prop, &value) in props.iter().zip(values) {
            let key = match find_data_key(self.hir, prop) {
                DataKey::Unknown => return None,
                DataKey::Name(name) => name,
                DataKey::Computed(key) => match self.find_key_constant(key) {
                    FoldedValue::Unknown => return None,
                    FoldedValue::Constant(constant)
                    | FoldedValue::ConstantOutsideDeadZone(constant) => {
                        constant_to_key(constant, self.atoms)
                    }
                },
            };
            let next_index = entries.len();
            let index = if searches_linearly {
                let found = entries.iter().position(|entry| entry.0 == key);
                found.unwrap_or(next_index)
            } else {
                *entry_indexes.entry(key).or_insert(next_index)
            };
            match entries.get_mut(index) {
                Some(entry) => entry.1 = value,
                None => entries.push((key, value)),
            }
        }
        Some(DataValue::Object(slice_in(&entries, self.arena)))
    }

    fn find_key_constant(&self, key: ExprId) -> FoldedValue {
        let key = self.hir.skip_type_assertions(key);
        self.decisions.constant(self.hir, key)
    }
}
