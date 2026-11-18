use std::borrow::Cow;
use std::sync::OnceLock;

use bun_engine_unicode::{IgnoreCase, MAX_CODE_POINT, Property};

use super::{CharRange, Latin1Set, LookupTable, Set, SetBuilder, ranges};

/// A set that the process builds once, along with what is derived from it.
pub struct SharedSet {
    latin1: Latin1Set,
    above: Cow<'static, [CharRange]>,
    table: OnceLock<LookupTable>,
    complement: Complement,
    /// Nothing if it is the set itself.
    closure: OnceLock<Option<Box<SharedSet>>>,
}

enum Complement {
    Derived(OnceLock<Box<SharedSet>>),
    Origin(&'static SharedSet),
}

const FIXED_SIZE: &str = "memory for character data";

static SPACE: SharedSet = SharedSet::new(
    Latin1Set::of(b"\t\n\x0b\x0c\r \xa0"),
    Cow::Borrowed(&[
        CharRange::single(0x1680),
        CharRange::new(0x2000, 0x200a),
        CharRange::new(0x2028, 0x2029),
        CharRange::single(0x202f),
        CharRange::single(0x205f),
        CharRange::single(0x3000),
        CharRange::single(0xfeff),
    ]),
);

static PROPERTIES: [OnceLock<Box<SharedSet>>; Property::COUNT] =
    [const { OnceLock::new() }; Property::COUNT];

impl SharedSet {
    const fn new(latin1: Latin1Set, above: Cow<'static, [CharRange]>) -> SharedSet {
        SharedSet {
            latin1,
            above,
            table: OnceLock::new(),
            complement: Complement::Derived(OnceLock::new()),
            closure: OnceLock::new(),
        }
    }

    fn from_set(set: &Set) -> Box<SharedSet> {
        Box::new(SharedSet::new(set.latin1, set.above().to_vec().into()))
    }

    #[inline]
    pub fn space() -> &'static SharedSet {
        &SPACE
    }

    /// The members that are single characters.
    pub fn of_property(property: Property) -> &'static SharedSet {
        PROPERTIES[property.index()].get_or_init(|| {
            let mut builder = SetBuilder::default();
            for range in property.ranges() {
                let (first, last) = range.into_inner();
                builder.add_range(first, last).expect(FIXED_SIZE);
            }
            SharedSet::from_set(&builder.finish(None).expect(FIXED_SIZE))
        })
    }

    pub fn complement(&'static self) -> &'static SharedSet {
        match &self.complement {
            Complement::Origin(origin) => origin,
            Complement::Derived(derived) => derived.get_or_init(|| {
                let above = ranges::complement(&self.above).expect(FIXED_SIZE);
                Box::new(SharedSet {
                    complement: Complement::Origin(self),
                    ..SharedSet::new(!self.latin1, above.to_vec().into())
                })
            }),
        }
    }

    pub(super) fn is_complement_of(&self, other: &SharedSet) -> bool {
        let is_origin_of = |a: &SharedSet, b: &SharedSet| matches!(b.complement, Complement::Origin(origin) if core::ptr::eq(origin, a));
        is_origin_of(self, other) || is_origin_of(other, self)
    }

    /// With all that simple case folding makes equal to a member.
    pub fn closed_over_case(&'static self) -> &'static SharedSet {
        let closure = self.closure.get_or_init(|| {
            let mut builder = SetBuilder::default();
            for range in self.to_set().ranges() {
                builder
                    .add_range(range.first, range.last)
                    .expect(FIXED_SIZE);
            }
            let closed = builder
                .finish(Some(IgnoreCase::CodePoints))
                .expect(FIXED_SIZE);
            (closed != self.to_set()).then(|| SharedSet::from_set(&closed))
        });
        closure.as_deref().unwrap_or(self)
    }

    #[inline]
    pub fn to_set(&'static self) -> Set {
        Set::with_shared(self.latin1, self)
    }

    #[inline]
    pub fn latin1(&self) -> &Latin1Set {
        &self.latin1
    }

    #[inline]
    pub(super) fn above(&self) -> &[CharRange] {
        &self.above
    }

    pub fn table(&self) -> &LookupTable {
        self.table.get_or_init(|| {
            LookupTable::new(&self.latin1, &self.above, MAX_CODE_POINT).expect(FIXED_SIZE)
        })
    }
}
