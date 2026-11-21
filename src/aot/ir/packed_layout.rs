use super::generated::{
    DeclaredType, Field, FieldFlags, FieldForm, Layout, LayoutFlags, LayoutKind, PositionFlags,
    StaticField,
};
use super::ids::{Id, optional_id_from_word, optional_id_to_word, optional_word};
use super::packed_body::{pack_words, unpack_words, unpacked_count};
use super::{LayoutId, StringId, TypeId, TypeSiteId};

const SAYS_TYPE: u32 = 1 << 0;
const HAS_SITE: u32 = 1 << 1;
const HAS_COMPUTED_KEY: u32 = 1 << 2;
const HAS_ORIGIN_LAYOUT: u32 = 1 << 3;
const HAS_ORIGIN_FIELD: u32 = 1 << 4;
const HAS_VARIABLE_NAME: u32 = 1 << 5;
const FORM_AT: u32 = 6;
const POSITION_AT: u32 = FORM_AT + width(FieldForm::ALL.0);
const FLAGS_AT: u32 = POSITION_AT + width(PositionFlags::ALL.0);

const _: () = assert!(FLAGS_AT + width(FieldFlags::ALL.0) <= u32::BITS);

const fn width(all: u32) -> u32 {
    u32::BITS - all.leading_zeros()
}

#[derive(Default)]
pub struct PackScratch {
    pub bytes: Vec<u8>,
    pub(super) words: Vec<u32>,
}

impl PackScratch {
    pub(super) fn unpack(&mut self, packed: &[u32]) -> WordReader<'_> {
        let count = unpacked_count(packed);
        self.words.clear();
        self.words.reserve(count);
        let room = &mut self.words.spare_capacity_mut()[..count];
        WordReader(unpack_words(packed, room).iter())
    }
}

pub(super) struct WordReader<'a>(core::slice::Iter<'a, u32>);

impl WordReader<'_> {
    pub(super) fn next(&mut self) -> u32 {
        *self.0.next().expect("a packed record has its words")
    }

    pub(super) fn next_optional(&mut self) -> Option<u32> {
        let word = self.next();
        (word != optional_word(None)).then_some(word)
    }

    pub(super) fn next_id<I: Id>(&mut self) -> I {
        I::from_word(self.next())
    }

    pub(super) fn next_optional_id<I: Id>(&mut self) -> Option<I> {
        optional_id_from_word(self.next())
    }

    pub(super) fn next_list<T>(
        &mut self,
        count: u32,
        mut read: impl FnMut(&mut Self) -> T,
    ) -> Vec<T> {
        (0..count).map(|_| read(self)).collect()
    }
}

pub(super) fn count_of<T>(list: &[T]) -> u32 {
    u32::try_from(list.len()).expect("a record fits 32 bits")
}

#[derive(Default)]
struct Before {
    key: u32,
    ty: u32,
    description: u32,
}

const MOST_WORDS_OF_FIELD: usize = 8;

fn push_field(field: &Field, before: &mut Before, words: &mut Vec<u32>) {
    let Field {
        key,
        computed_key,
        declared:
            DeclaredType {
                ty,
                site,
                flags: position_flags,
            },
        flags,
        form,
        origin_layout,
        origin_field,
        variable_name,
    } = *field;
    let mut description = form.0 << FORM_AT | position_flags.0 << POSITION_AT | flags.0 << FLAGS_AT;
    let mut describe = |part: u32, is_there: bool| description |= if is_there { part } else { 0 };
    describe(SAYS_TYPE, ty != DeclaredType::unsaid().ty);
    describe(HAS_SITE, site.is_some());
    describe(HAS_COMPUTED_KEY, computed_key.is_some());
    describe(HAS_ORIGIN_LAYOUT, origin_layout.is_some());
    describe(HAS_ORIGIN_FIELD, origin_field.is_some());
    describe(HAS_VARIABLE_NAME, variable_name.is_some());
    let key = optional_id_to_word(key);
    let mut of_field = [0; MOST_WORDS_OF_FIELD];
    of_field[0] = key.wrapping_sub(before.key);
    of_field[1] = description ^ before.description;
    let mut count = 2;
    let mut add = |word: u32| {
        of_field[count] = word;
        count += 1;
    };
    (before.key, before.description) = (key, description);
    if description & SAYS_TYPE != 0 {
        let ty = ty.to_word();
        add(ty.wrapping_sub(before.ty));
        before.ty = ty;
    }
    const RARE: u32 =
        HAS_SITE | HAS_COMPUTED_KEY | HAS_ORIGIN_LAYOUT | HAS_ORIGIN_FIELD | HAS_VARIABLE_NAME;
    if description & RARE != 0 {
        let rare = [
            site.map(TypeSiteId::to_word),
            computed_key,
            origin_layout.map(LayoutId::to_word),
            origin_field,
            variable_name.map(StringId::to_word),
        ];
        rare.into_iter().flatten().for_each(add);
    }
    words.extend_from_slice(&of_field[..count]);
}

fn read_field(before: &mut Before, words: &mut WordReader<'_>) -> Field {
    let key = words.next().wrapping_add(before.key);
    let description = words.next() ^ before.description;
    (before.key, before.description) = (key, description);
    let has = |part: u32| description & part != 0;
    let part = |at: u32, all: u32| description >> at & all;
    let ty = match has(SAYS_TYPE) {
        true => {
            before.ty = words.next().wrapping_add(before.ty);
            TypeId::from_word(before.ty)
        }
        false => DeclaredType::unsaid().ty,
    };
    Field {
        key: optional_id_from_word(key),
        declared: DeclaredType {
            ty,
            site: has(HAS_SITE).then(|| words.next_id()),
            flags: PositionFlags::from_wire(part(POSITION_AT, PositionFlags::ALL.0))
                .expect("a packed field has the flags of its position"),
        },
        computed_key: has(HAS_COMPUTED_KEY).then(|| words.next()),
        flags: FieldFlags::from_wire(part(FLAGS_AT, FieldFlags::ALL.0))
            .expect("a packed field has its flags"),
        form: FieldForm::from_wire(part(FORM_AT, FieldForm::ALL.0))
            .expect("a packed field has its form"),
        origin_layout: has(HAS_ORIGIN_LAYOUT).then(|| words.next_id()),
        origin_field: has(HAS_ORIGIN_FIELD).then(|| words.next()),
        variable_name: has(HAS_VARIABLE_NAME).then(|| words.next_id()),
    }
}

const POSITION: usize = 0;
const MODULE: usize = 1;
const BASE: usize = 2;
const PLAIN_WORDS: usize = 3;

#[derive(Clone, Default)]
pub struct PackedLayout(Box<[u32]>);

impl PackedLayout {
    pub fn new(layout: &Layout, scratch: &mut PackScratch) -> PackedLayout {
        let Layout {
            kind,
            name,
            module,
            position,
            base,
            constructor,
            ref fields,
            ref static_fields,
            ref supertypes,
            computed_key_count,
            flags,
            ref declared_order,
            place,
        } = *layout;
        let words = &mut scratch.words;
        words.clear();
        words.extend([
            kind.to_wire(),
            optional_id_to_word(name),
            optional_id_to_word(constructor),
            computed_key_count,
            flags.to_wire(),
            optional_word(place),
            count_of(fields),
            count_of(static_fields),
            count_of(supertypes),
            count_of(declared_order),
        ]);
        let mut before = Before::default();
        words.reserve(fields.len() * MOST_WORDS_OF_FIELD);
        for field in fields {
            push_field(field, &mut before, words);
        }
        for &StaticField { key, variable } in static_fields {
            words.extend([key.to_word(), variable.to_word()]);
        }
        words.extend(supertypes.iter().map(|id| id.to_word()));
        words.extend_from_slice(declared_order);
        let mut plain = [0; PLAIN_WORDS];
        plain[POSITION] = position;
        plain[MODULE] = optional_id_to_word(module);
        plain[BASE] = optional_id_to_word(base);
        PackedLayout(pack_words(&plain, words, &mut scratch.bytes).into_boxed_slice())
    }

    pub fn position(&self) -> u32 {
        self.0[POSITION]
    }

    pub fn has_module(&self) -> bool {
        self.0[MODULE] != optional_word(None)
    }

    pub fn base(&self) -> Option<LayoutId> {
        optional_id_from_word(self.0[BASE])
    }

    pub fn set_base(&mut self, base: Option<LayoutId>) {
        self.0[BASE] = optional_id_to_word(base);
    }

    pub fn unpack(&self, scratch: &mut PackScratch) -> Layout {
        let mut words = scratch.unpack(&self.0[PLAIN_WORDS..]);
        let words = &mut words;
        let kind = LayoutKind::from_wire(words.next()).expect("a packed layout has a kind");
        let (name, constructor) = (words.next_optional_id(), words.next_optional_id());
        let computed_key_count = words.next();
        let flags = LayoutFlags::from_wire(words.next()).expect("a packed layout has its flags");
        let place = words.next_optional();
        let [
            field_count,
            static_field_count,
            supertype_count,
            order_count,
        ] = core::array::from_fn(|_| words.next());
        let mut before = Before::default();
        Layout {
            kind,
            name,
            module: optional_id_from_word(self.0[MODULE]),
            position: self.position(),
            base: self.base(),
            constructor,
            fields: words.next_list(field_count, |words| read_field(&mut before, words)),
            static_fields: words.next_list(static_field_count, |words| StaticField {
                key: words.next_id(),
                variable: words.next_id(),
            }),
            supertypes: words.next_list(supertype_count, WordReader::next_id),
            computed_key_count,
            flags,
            declared_order: words.next_list(order_count, WordReader::next),
            place,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::ir::{FunctionId, ModuleId, PropertyKeyId, VariableId};

    const IDS: [u32; 8] = [
        0,
        1,
        0x7F,
        0x80,
        0xFFFF,
        0x1_0000,
        0x00FF_FFFF,
        u32::MAX - 1,
    ];

    fn fields_in_all_forms() -> Vec<Field> {
        let mut fields = Vec::new();
        for parts in 0..1 << FORM_AT {
            let id = |at: usize| IDS[(parts as usize + at) % IDS.len()];
            let has = |part: u32| parts & part != 0;
            fields.push(Field {
                key: (parts % 5 != 0).then(|| PropertyKeyId::from_word(id(0))),
                computed_key: has(HAS_COMPUTED_KEY).then(|| id(1)),
                declared: match has(SAYS_TYPE) {
                    true => DeclaredType {
                        ty: TypeId::from_word(id(2)),
                        site: has(HAS_SITE).then(|| TypeSiteId::from_word(id(3))),
                        flags: PositionFlags(parts & PositionFlags::ALL.0),
                    },
                    false => DeclaredType::unsaid(),
                },
                flags: FieldFlags(parts * 37 & FieldFlags::ALL.0),
                form: FieldForm(parts & FieldForm::ALL.0),
                origin_layout: has(HAS_ORIGIN_LAYOUT).then(|| LayoutId::from_word(id(4))),
                origin_field: has(HAS_ORIGIN_FIELD).then(|| id(5)),
                variable_name: has(HAS_VARIABLE_NAME).then(|| StringId::from_word(id(6))),
            });
        }
        fields
    }

    fn layout_of(number: usize, fields: &[Field]) -> Layout {
        let id = |at: usize| IDS[(number + at) % IDS.len()];
        let is_there = |at: usize| number >> at & 1 != 0;
        Layout {
            kind: [LayoutKind::Record, LayoutKind::Environment][number % 2],
            name: is_there(0).then(|| StringId::from_word(id(0))),
            module: is_there(1).then(|| ModuleId::from_word(id(1))),
            position: id(2),
            base: is_there(2).then(|| LayoutId::from_word(id(3))),
            constructor: is_there(3).then(|| FunctionId::from_word(id(4))),
            fields: fields.to_vec(),
            static_fields: (0..number % 3)
                .map(|at| StaticField {
                    key: PropertyKeyId::from_word(id(at)),
                    variable: VariableId::from_word(id(at + 1)),
                })
                .collect(),
            supertypes: (0..number % 4)
                .map(|at| LayoutId::from_word(id(at)))
                .collect(),
            computed_key_count: id(5),
            flags: LayoutFlags(LayoutFlags::ALL.0 & id(6)),
            declared_order: (0..if is_there(4) { fields.len() as u32 } else { 0 })
                .rev()
                .collect(),
            place: is_there(5).then(|| id(7)),
        }
    }

    #[test]
    fn packed_layouts_round_trip() {
        let fields = fields_in_all_forms();
        let mut scratch = PackScratch::default();
        for first in 0..fields.len() {
            for end in [first, first + 1, fields.len()] {
                let layout = layout_of(first * 3 + end, &fields[first..end]);
                let packed = PackedLayout::new(&layout, &mut scratch);
                assert_eq!(packed.position(), layout.position);
                assert_eq!(packed.has_module(), layout.module.is_some());
                assert_eq!(packed.base(), layout.base);
                assert_eq!(packed.unpack(&mut scratch), layout);
            }
        }
    }

    #[test]
    fn base_of_packed_layout_changes() {
        let mut scratch = PackScratch::default();
        let layout = layout_of(63, &fields_in_all_forms());
        let mut packed = PackedLayout::new(&layout, &mut scratch);
        packed.set_base(None);
        let expected = Layout {
            base: None,
            ..layout
        };
        assert_eq!(packed.unpack(&mut scratch), expected);
    }

    #[test]
    fn packed_layouts_are_small() {
        let fields: Vec<Field> = (0..400)
            .map(|at| Field {
                key: Some(PropertyKeyId::from_word(1000 + at * 3)),
                declared: DeclaredType::from_compiler(TypeId::from_word(500 + at % 60)),
                ..Field::default()
            })
            .collect();
        let bytes = size_of_val(&fields[..]);
        let layout = Layout {
            fields,
            ..Layout::default()
        };
        let packed = PackedLayout::new(&layout, &mut PackScratch::default());
        assert!(packed.0.len() * 4 * 10 <= bytes);
    }
}
