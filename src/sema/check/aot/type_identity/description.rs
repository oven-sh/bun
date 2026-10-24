use super::lanes::Lanes;
use crate::atom::Atom;
use crate::check::aot::answers::{
    ClassRef, MemberName, ObjectMemberKind, SchemaConstraint, SchemaDefault,
};
use crate::check::aot::program_symbols::SchemaAlias;
use crate::check::aot::queries::Queries;
use crate::program::{FileId, Sym};
use std::hash::Hasher;

pub(super) type Key = [u64; 2];

#[derive(Copy, Clone)]
#[repr(u8)]
pub(super) enum Tag {
    Anything,
    TypeVariable,
    Never,
    Undefined,
    Null,
    Boolean,
    BooleanLiteral,
    Number,
    NumberLiteral,
    NumericEnumMember,
    BigInt,
    BigIntLiteral,
    String,
    StringLiteral,
    TemplateLiteral,
    Symbol,
    AnyObject,
    Function,
    ClassConstructor,
    Array,
    Tuple,
    Builtin,
    Class,
    Object,
    Union,
    Constrained,
    NamedObject,
    TypeLiteral,
    MappedType,
    ObjectLiteral,
    Intersection,
    Untrusted,
    BackReference,
    Cyclic,
}

#[derive(Copy, Clone, PartialEq, Eq, PartialOrd, Ord)]
pub(super) enum NameKey<'a> {
    String(&'a [u8]),
    Symbol(&'a [u8]),
    Private(&'a [u8]),
}

pub(super) struct Description {
    lanes: Lanes,
}

impl Description {
    pub(super) fn new(tag: Tag) -> Description {
        let mut description = Description {
            lanes: Lanes::START,
        };
        description.word(tag as u64);
        description
    }

    #[inline]
    pub(super) fn word(&mut self, word: u64) {
        self.lanes.add(word);
    }

    pub(super) fn bytes(&mut self, bytes: &[u8]) {
        self.word(bytes.len() as u64);
        self.lanes.write(bytes);
    }

    pub(super) fn key(&mut self, key: Key) {
        self.word(key[0]);
        self.word(key[1]);
    }

    pub(super) fn keys(&mut self, keys: &[Key]) {
        self.word(keys.len() as u64);
        for &key in keys {
            self.key(key);
        }
    }

    pub(super) fn file(&mut self, queries: &Queries<'_, '_, '_>, file: FileId) {
        use std::hash::Hasher;
        let mut hasher = crate::util::FxHasher::default();
        hasher.write(queries.files().module(file).file_name());
        self.word(hasher.finish());
    }

    pub(super) fn symbol(&mut self, queries: &Queries<'_, '_, '_>, symbol: Sym) {
        let symbol = queries.files().canonical(symbol);
        let symbol = queries
            .files()
            .parts(symbol)
            .first()
            .copied()
            .unwrap_or(symbol);
        self.file(queries, symbol.file);
        self.word(u64::from(symbol.id.0));
    }

    pub(super) fn written(&mut self, written: Option<Key>) {
        match written {
            None => self.word(0),
            Some(key) => {
                self.word(1);
                self.key(key);
            }
        }
    }

    pub(super) fn name(&mut self, name: NameKey<'_>) {
        match name {
            NameKey::String(bytes) => {
                self.word(0);
                self.bytes(bytes);
            }
            NameKey::Symbol(bytes) => {
                self.word(1);
                self.bytes(bytes);
            }
            NameKey::Private(bytes) => {
                self.word(2);
                self.bytes(bytes);
            }
        }
    }

    pub(super) fn member(
        &mut self,
        name: NameKey<'_>,
        kind: ObjectMemberKind,
        is_optional: bool,
        written: Option<Key>,
    ) {
        self.name(name);
        self.word(kind as u64);
        self.word(is_optional as u64);
        self.written(written);
    }

    pub(super) fn finish(self) -> Key {
        self.lanes.0
    }
}

pub(super) fn leaf(tag: Tag) -> Key {
    Description::new(tag).finish()
}

pub(super) fn leaf_word(tag: Tag, word: u64) -> Key {
    let mut description = Description::new(tag);
    description.word(word);
    description.finish()
}

pub(super) fn leaf_bytes(tag: Tag, bytes: &[u8]) -> Key {
    let mut description = Description::new(tag);
    description.bytes(bytes);
    description.finish()
}

pub(super) fn class_description(
    queries: &Queries<'_, '_, '_>,
    tag: Tag,
    class: ClassRef,
) -> Description {
    let mut description = Description::new(tag);
    description.file(queries, class.file);
    description.word(u64::from(class.class.0));
    description
}

pub(super) fn member_name_key<'p>(queries: &Queries<'_, 'p, '_>, name: MemberName) -> NameKey<'p> {
    match name {
        MemberName::String(atom) => NameKey::String(queries.atom_bytes(atom)),
        MemberName::Symbol(atom) => NameKey::Symbol(queries.atom_bytes(atom)),
        MemberName::Private(atom) => {
            debug_assert!(false, "an Object shape has no private member");
            NameKey::Private(queries.atom_bytes(atom))
        }
    }
}

fn constraint_description(alias: Option<SchemaAlias>) -> Description {
    let mut description = Description::new(Tag::Constrained);
    match alias {
        None => description.word(0),
        Some(alias) => {
            description.word(1);
            description.word(alias as u64);
        }
    }
    description
}

fn default_description(queries: &Queries<'_, '_, '_>, default: SchemaDefault) -> Description {
    let mut description = constraint_description(Some(SchemaAlias::Default));
    match default {
        SchemaDefault::Null => description.word(0),
        SchemaDefault::Boolean(value) => {
            description.word(1);
            description.word(value as u64);
        }
        SchemaDefault::Number(value) => {
            description.word(2);
            description.word(value.to_bits());
        }
        SchemaDefault::String(atom) => {
            description.word(3);
            description.bytes(queries.atom_bytes(atom));
        }
    }
    description
}

pub(super) fn constraint_key(queries: &Queries<'_, '_, '_>, constraint: SchemaConstraint) -> Key {
    let with_word = |alias: SchemaAlias, word: u64| {
        let mut description = constraint_description(Some(alias));
        description.word(word);
        description
    };
    let with_text = |alias: SchemaAlias, text: Atom| {
        let mut description = constraint_description(Some(alias));
        description.bytes(queries.atom_bytes(text));
        description
    };
    let description = match constraint {
        SchemaConstraint::Int32 => constraint_description(None),
        SchemaConstraint::Int => constraint_description(Some(SchemaAlias::Int)),
        SchemaConstraint::Min(value) => with_word(SchemaAlias::Min, value.to_bits()),
        SchemaConstraint::Max(value) => with_word(SchemaAlias::Max, value.to_bits()),
        SchemaConstraint::Above(value) => with_word(SchemaAlias::Above, value.to_bits()),
        SchemaConstraint::Below(value) => with_word(SchemaAlias::Below, value.to_bits()),
        SchemaConstraint::MultipleOf(value) => with_word(SchemaAlias::MultipleOf, value.to_bits()),
        SchemaConstraint::MinLength(count) => with_word(SchemaAlias::MinLength, u64::from(count)),
        SchemaConstraint::MaxLength(count) => with_word(SchemaAlias::MaxLength, u64::from(count)),
        SchemaConstraint::MinItems(count) => with_word(SchemaAlias::MinItems, u64::from(count)),
        SchemaConstraint::MaxItems(count) => with_word(SchemaAlias::MaxItems, u64::from(count)),
        SchemaConstraint::Pattern(text) => with_text(SchemaAlias::Pattern, text),
        SchemaConstraint::Format(format) => with_word(SchemaAlias::Format, format as u64),
        SchemaConstraint::Message(text) => with_text(SchemaAlias::Message, text),
        SchemaConstraint::Default(default) => default_description(queries, default),
        SchemaConstraint::Strict => constraint_description(Some(SchemaAlias::Strict)),
        SchemaConstraint::DeepStrict => constraint_description(Some(SchemaAlias::DeepStrict)),
    };
    description.finish()
}

pub(super) fn describe_untyped_members<'a>(
    members: impl Iterator<Item = (&'a [u8], ObjectMemberKind)>,
) -> [u64; 2] {
    let mut sorted: Vec<(&'a [u8], ObjectMemberKind)> = members.collect();
    sorted.sort_by(|left, right| left.0.cmp(right.0));
    sorted.dedup_by(|later, earlier| {
        let is_same_name = later.0 == earlier.0;
        if is_same_name {
            *earlier = *later;
        }
        is_same_name
    });
    let mut description = Description::new(Tag::Object);
    description.word(sorted.len() as u64);
    for (name, kind) in sorted {
        description.member(NameKey::String(name), kind, false, None);
    }
    description.word(0);
    description.finish()
}

#[cfg(test)]
mod tests {
    use super::*;

    use ObjectMemberKind::{Field, Getter, Method};

    fn describe(members: &[(&'static str, ObjectMemberKind)]) -> Key {
        describe_untyped_members(members.iter().map(|&(name, kind)| (name.as_bytes(), kind)))
    }

    #[test]
    fn untyped_members_ignore_order() {
        let forward = describe(&[("x", Field), ("y", Method)]);
        let backward = describe(&[("y", Method), ("x", Field)]);
        assert_eq!(forward, backward);
    }

    #[test]
    fn untyped_members_kind_counts() {
        let field = describe(&[("x", Field)]);
        let getter = describe(&[("x", Getter)]);
        assert_ne!(field, getter);
    }

    #[test]
    fn untyped_members_later_entry_stays() {
        let repeated = describe(&[("x", Field), ("x", Method)]);
        assert_eq!(repeated, describe(&[("x", Method)]));
    }

    #[test]
    fn lengths_separate_lists() {
        let one = describe(&[("ab", Field)]);
        let two = describe(&[("a", Field), ("b", Field)]);
        assert_ne!(one, two);
    }

    #[test]
    fn golden_value() {
        let value = describe(&[("y", Method), ("x", Field), ("0", Getter)]);
        let mut expected = Description::new(Tag::Object);
        expected.word(3);
        expected.member(NameKey::String(b"0"), Getter, false, None);
        expected.member(NameKey::String(b"x"), Field, false, None);
        expected.member(NameKey::String(b"y"), Method, false, None);
        expected.word(0);
        assert_eq!(value, expected.finish());
    }
}
