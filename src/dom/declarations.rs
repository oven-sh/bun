//! <https://drafts.csswg.org/cssom/#css-declaration-blocks>

use core::cell::{Cell, OnceCell, RefCell};
use core::hash::{Hash, Hasher};
use std::borrow::Cow;
use std::rc::{Rc, Weak};
use std::sync::LazyLock;

use smallvec::SmallVec;

use crate::custom::{Text, remember, spelling};
use crate::forecast::{prefetch, prefetch_shared};
use crate::grammar::{Mode, definition};
use crate::name::{FastHasher, Map};
use crate::properties::{Id, Prop, logical_props};
use crate::scan;
use crate::sheet::{self, AtKind, Block, Declaration, Declared, Wide, Within};
use crate::shorthand;
use crate::values::{Flow, Out, eq, text, write_ident};

#[derive(Clone, Copy, PartialEq, Eq, Hash)]
pub(crate) enum Key {
    Property(Prop),
    Descriptor(&'static str),
}

impl Key {
    /// Empty if it is not a shorthand.
    fn longhands(self) -> &'static [Prop] {
        static ALL: LazyLock<Vec<Prop>> = LazyLock::new(|| {
            Id::ALL
                .iter()
                .filter(|it| it.is_in_all())
                .map(|it| Prop::Long(*it))
                .chain(logical_props())
                .collect()
        });
        match self {
            Key::Property(Prop::Short(index)) => shorthand::get(index).longhands(),
            Key::Property(Prop::All) => &ALL,
            _ => &[],
        }
    }

    /// The lowest bits tell the kind. It is all there is to a property that is not custom.
    fn code(self) -> u32 {
        match self {
            Key::Property(Prop::Long(id)) => (id as u32) << 2 | 1,
            Key::Property(Prop::Logical(id)) => (id as u32) << 2 | 2,
            Key::Property(Prop::Custom(name)) => name.bits() as u32,
            Key::Descriptor(name) => (name.len() as u32) << 2,
            Key::Property(_) => 3,
        }
    }

    /// Whether removing this removes an entry.
    fn covers(self) -> impl Fn(&Entry) -> bool {
        let bit = |code: u32| 1u64 << ((code >> 2) % 64);
        let (code, is_all) = (self.code(), self == Key::Property(Prop::All));
        let (longhands, filter) = match self {
            Key::Property(Prop::Short(index)) => shorthand::get(index).longhands_with_filter(),
            _ => (&[][..], 0),
        };
        #[inline(always)]
        move |entry| match entry.code == code
            || entry.code & 3 != 0 && (is_all || filter & bit(entry.code) != 0)
        {
            true if is_all => {
                matches!(entry.key(), Key::Property(Prop::Long(it) | Prop::Logical(it)) if it.is_in_all())
            }
            true => {
                entry.key() == self
                    || matches!(entry.key(), Key::Property(it) if longhands.contains(&it))
            }
            false => false,
        }
    }

    fn entries(self) -> impl Iterator<Item = Key> {
        let longhands = self.longhands();
        longhands
            .iter()
            .map(|it| Key::Property(*it))
            .chain(longhands.is_empty().then_some(self))
    }

    pub(crate) fn name(self) -> Cow<'static, str> {
        match self {
            Key::Property(Prop::Custom(name)) => spelling(name).to_string().into(),
            Key::Property(prop) => prop.name().into(),
            Key::Descriptor(name) => name.into(),
        }
    }

    /// Whether their order decides which of them sets a side.
    fn competes_with(self, other: Key) -> bool {
        match (self, other) {
            (Key::Property(Prop::Long(a)), Key::Property(Prop::Logical(b)))
            | (Key::Property(Prop::Logical(a)), Key::Property(Prop::Long(b))) => {
                a.logical_group() == b.logical_group()
            }
            _ => false,
        }
    }
}

/// Those that set the most properties come first.
fn shorthands_of(longhand: Key) -> &'static [Prop] {
    static ALL: LazyLock<Map<Prop, Vec<Prop>>> = LazyLock::new(|| {
        let named = (0..)
            .zip(shorthand::definitions())
            .filter(|it| it.1.name != "-webkit-border-radius");
        let mut shorthands: Vec<_> = named
            .map(|it| (it.0, shorthand::get(it.0).longhands()))
            .filter(|it| it.1.len() > 1)
            .collect();
        bun_collections::index_sort::sort_slice_by_key(&mut shorthands, |it| {
            core::cmp::Reverse(it.1.len())
        });
        let mut all = Map::<_, Vec<_>>::default();
        for (index, longhands) in shorthands {
            longhands
                .iter()
                .for_each(|it| all.entry(*it).or_default().push(Prop::Short(index)));
        }
        all
    });
    let Key::Property(longhand) = longhand else {
        return &[];
    };
    ALL.get(&longhand).map_or(&[], Vec::as_slice)
}

/// What a block can declare.
#[derive(Clone, Copy, PartialEq)]
pub(crate) enum Accepts {
    Properties(Within),
    Descriptors(AtKind),
}

impl Accepts {
    pub(crate) fn key(self, name: &[u8]) -> Option<Key> {
        let prop = if name.starts_with(b"--") {
            (name.len() > 2).then(|| Prop::Custom(remember(name)))
        } else {
            Prop::from_name(name)
        };
        match (self, prop) {
            (Accepts::Properties(_), _)
            | (Accepts::Descriptors(AtKind::Function), Some(Prop::Custom(_))) => {
                prop.map(Key::Property)
            }
            (Accepts::Descriptors(AtKind::Function), _) => {
                eq(name, "result").then_some(Key::Descriptor("result"))
            }
            (Accepts::Descriptors(AtKind::Property), _) if eq(name, "initial-value") => {
                Some(Key::Descriptor("initial-value"))
            }
            (_, Some(Prop::Custom(_))) => None,
            (Accepts::Descriptors(rule), _) => {
                let name = prop.map_or_else(|| name.to_ascii_lowercase(), |it| it.name().into());
                definition(&format!("@{}/{}", rule.name(), text(&name)))
                    .map(|it| Key::Descriptor(&it.name[rule.name().len() + 2..]))
            }
        }
    }
}

struct Part {
    source: Text,
    written: Text,
}

/// A valid declaration.
pub(crate) struct Specified {
    key: Key,
    important: bool,
    source: Text,
    /// `None` for a descriptor.
    declaration: Option<Rc<Declaration>>,
    /// The values of the longhands are only known once it applies to an element.
    is_pending: bool,
    parts: OnceCell<Box<[Part]>>,
    /// 0 until it is asked for.
    hash: Cell<u64>,
}

fn is_system_font(key: Key, source: &[u8]) -> bool {
    const NAMES: [&str; 9] = [
        "caption",
        "icon",
        "menu",
        "message-box",
        "small-caption",
        "status-bar",
        "-webkit-control",
        "-webkit-small-control",
        "-webkit-mini-control",
    ];
    matches!(key, Key::Property(it @ Prop::Short(_)) if it.name() == "font")
        && NAMES.iter().any(|it| eq(source, it))
}

fn hash_of(key: Key, important: bool, source: &[u8]) -> u64 {
    let mut hasher = FastHasher::default();
    (key, important).hash(&mut hasher);
    bun_wyhash::hash_with_seed(hasher.finish(), source)
}

impl Specified {
    pub(crate) fn parse(
        accepts: Accepts,
        key: Key,
        source: &[u8],
        important: bool,
    ) -> Option<Specified> {
        let source = scan::trim(source);
        let written = match (accepts, key) {
            (Accepts::Properties(within), Key::Property(prop)) => {
                let value = within
                    .allows(prop, important)
                    .then(|| Declared::parse_within(prop, source, within))??;
                return Some(Specified::of(
                    Rc::new(Declaration::new(prop, important, value, None)),
                    source,
                ));
            }
            (Accepts::Properties(_), _) => return None,
            _ if important => return None,
            (Accepts::Descriptors(AtKind::Function), _) => {
                Declared::custom(source).map(|_| source.to_vec())?
            }
            (_, Key::Descriptor("initial-value")) => source.to_vec(),
            (Accepts::Descriptors(rule), _) => {
                sheet::descriptor(rule.name(), key.name().as_bytes(), source)?
            }
        };
        let source = Text::from(source);
        let parts: Box<[Part]> = Box::new([Part {
            source: Rc::clone(&source),
            written: written.into(),
        }]);
        Some(Specified {
            key,
            important,
            source,
            declaration: None,
            is_pending: false,
            parts: parts.into(),
            hash: Cell::new(0),
        })
    }

    fn of(declaration: Rc<Declaration>, source: &[u8]) -> Specified {
        let (key, important) = (Key::Property(declaration.prop), declaration.important);
        let is_pending = !key.longhands().is_empty()
            && matches!(declaration.value, Declared::Template(_))
            || is_system_font(key, source);
        let shared = match &declaration.value {
            Declared::Text(it) if **it == *source => Rc::clone(it),
            _ => source.into(),
        };
        Specified {
            key,
            important,
            source: shared,
            declaration: Some(declaration),
            is_pending,
            parts: OnceCell::new(),
            hash: Cell::new(0),
        }
    }

    fn hash(&self) -> u64 {
        if self.hash.get() == 0 {
            self.hash
                .set(hash_of(self.key, self.important, &self.source));
        }
        self.hash.get()
    }

    /// Gives another value that is valid to `declaration`, which is its own, if nothing else has that.
    fn rewrite(&mut self, declaration: &mut Rc<Declaration>, source: &[u8]) -> bool {
        if Rc::strong_count(declaration) != 2 {
            return false;
        }
        self.declaration = None;
        let is_unique = Rc::get_mut(declaration).map(|own| {
            own.value = Declared::Wide(Wide::Unset);
            match Rc::get_mut(&mut self.source).filter(|it| it.len() == source.len()) {
                Some(room) => room.copy_from_slice(source),
                None => self.source = source.into(),
            }
            (
                own.value,
                *own.cached.get_mut(),
                self.parts,
                *self.hash.get_mut(),
            ) = (
                Declared::Text(Rc::clone(&self.source)),
                None,
                OnceCell::new(),
                0,
            );
        });
        self.declaration = Some(Rc::clone(declaration));
        is_unique.is_some()
    }

    /// Of the first longhand.
    pub(crate) fn written(&self) -> &[u8] {
        self.part(0)[1]
    }

    fn is(&self, key: Key, source: &[u8], important: bool) -> bool {
        (self.key, self.important) == (key, important) && *self.source == *source
    }

    fn parts(&self, prop: Prop, value: &Text) -> &[Part] {
        let part = |id: Option<Id>, source: Text| {
            let written = id.map_or_else(
                || Rc::clone(&source),
                |id| {
                    id.syntax()
                        .write(&source, Mode::Specified)
                        .unwrap_or_default()
                        .into()
                },
            );
            Part { source, written }
        };
        self.parts.get_or_init(|| match prop {
            Prop::Short(index) => {
                let shorthand = shorthand::get(index);
                let all = shorthand
                    .ids(Flow::DEFAULT)
                    .iter()
                    .zip(shorthand.expand(value).unwrap_or_default());
                all.map(|(id, it)| {
                    part(
                        Some(*id),
                        it.as_deref()
                            .unwrap_or_else(|| id.initial_source().as_bytes())
                            .into(),
                    )
                })
                .collect()
            }
            _ => Box::new([part(prop.id(Flow::DEFAULT), Rc::clone(value))]),
        })
    }

    /// The source and the serialization.
    fn part(&self, index: u16) -> [&[u8]; 2] {
        let parts = match self.declaration.as_deref() {
            Some(Declaration {
                value: Declared::Wide(wide),
                ..
            }) => return [wide.name().as_bytes(); 2],
            Some(Declaration {
                value: Declared::Template(_),
                ..
            }) => return [&self.source; 2],
            Some(Declaration {
                value: Declared::Text(value),
                prop,
                ..
            }) => self.parts(*prop, value),
            None => self.parts.get().map_or(&[][..], |it| it),
        };
        parts
            .get(usize::from(index))
            .map_or([b""; 2], |it| [&it.source, &it.written])
    }

    fn only_for(&self, longhand: Prop) -> Option<Declaration> {
        let whole = self.declaration.as_deref()?;
        let value = match &whole.value {
            Declared::Wide(wide) => Declared::Wide(*wide),
            Declared::Text(value) => Declared::Text(Rc::clone(value)),
            Declared::Template(_) => Declared::parse(whole.prop, &self.source)?,
        };
        Some(Declaration::new(
            whole.prop,
            whole.important,
            value,
            Some(longhand),
        ))
    }
}

#[derive(Clone)]
struct Entry {
    /// `Key::code`
    code: u32,
    /// Which of the longhands it is.
    part: u16,
    of: Rc<Specified>,
}

impl PartialEq for Entry {
    fn eq(&self, other: &Entry) -> bool {
        self.part == other.part
            && (Rc::ptr_eq(&self.of, &other.of)
                || self
                    .of
                    .is(other.of.key, &other.of.source, other.of.important))
    }
}

impl Entry {
    fn key(&self) -> Key {
        match self.code & 3 {
            1 => Key::Property(Prop::Long(Id::ALL[self.code as usize >> 2])),
            2 => Key::Property(Prop::Logical(Id::ALL[self.code as usize >> 2])),
            _ => self.of.key,
        }
    }

    fn value(&self) -> &[u8] {
        if self.of.is_pending {
            b""
        } else {
            self.of.part(self.part)[1]
        }
    }

    fn source(&self) -> &[u8] {
        match self.of.declaration.as_deref() {
            Some(Declaration {
                value: Declared::Text(value),
                prop: Prop::Long(_) | Prop::Logical(_) | Prop::Custom(_),
                ..
            }) => value,
            _ => self.of.part(self.part)[0],
        }
    }

    fn is_same(&self, other: &Entry) -> bool {
        Rc::ptr_eq(&self.of, &other.of)
            || (self.of.important, self.of.is_pending) == (other.of.important, other.of.is_pending)
                && self.source() == other.source()
    }
}

fn write_declaration(key: Key, value: &[u8], important: bool, out: &mut Out) {
    if !out.is_empty() {
        out.push(b' ');
    }
    write_ident(key.name().as_bytes(), out);
    out.extend_from_slice(b": ");
    out.extend_from_slice(value);
    out.extend_from_slice(if important { b" !important;" } else { b";" });
}

type Found = SmallVec<[usize; 8]>;

/// Of longhands.
#[derive(Clone, Default)]
pub(crate) struct DeclarationList(Vec<Entry>, Hints);

#[derive(Clone, Default)]
struct Hints {
    /// A bit for each longhand that is in it, once it is long.
    present: Option<Box<[u64; (Id::ALL.len() * 2).div_ceil(64)]>>,
    /// After the one that was found last.
    next: Cell<u32>,
    may_have_logical: bool,
}

impl Hints {
    const LONG: usize = 16;

    fn flip(&mut self, code: u32) {
        if let (Some(present), 1 | 2) = (&mut self.present, code & 3) {
            present[code as usize >> 7] ^= 1 << (code >> 1 & 63);
        }
    }

    #[inline]
    fn has(&self, code: u32) -> Option<bool> {
        self.present
            .as_ref()
            .filter(|_| matches!(code & 3, 1 | 2))
            .map(|it| it[code as usize >> 7] >> (code >> 1 & 63) & 1 != 0)
    }
}

impl PartialEq for DeclarationList {
    fn eq(&self, other: &DeclarationList) -> bool {
        self.0 == other.0
    }
}

impl DeclarationList {
    pub(crate) fn parse(accepts: Accepts, source: &[u8]) -> DeclarationList {
        let mut list = DeclarationList::default();
        sheet::visit_declarations(source, |name, value, important| {
            if let Some(it) = accepts
                .key(name)
                .and_then(|key| Specified::parse(accepts, key, value, important))
            {
                list.put(&Rc::new(it), true);
            }
        });
        list
    }

    pub(crate) fn len(&self) -> usize {
        self.0.len()
    }

    pub(crate) fn is_empty(&self) -> bool {
        self.0.is_empty()
    }

    pub(crate) fn key_at(&self, index: usize) -> Option<Key> {
        self.0.get(index).map(Entry::key)
    }

    fn find(&self, key: Key) -> Option<usize> {
        let code = key.code();
        let Some(is_present) = self.1.has(code) else {
            return self
                .0
                .iter()
                .rposition(|it| it.code == code && (code & 3 != 0 || it.of.key == key));
        };
        let (next, is_at) = (self.1.next.get() as usize, |it: &usize| {
            self.0.get(*it).is_some_and(|it| it.code == code)
        });
        let found = is_present.then(|| {
            [next, next.wrapping_sub(1)]
                .into_iter()
                .find(is_at)
                .or_else(|| self.0.iter().position(|it| it.code == code))
        })??;
        self.1.next.set(found as u32 + 1);
        Some(found)
    }

    /// Whether setting it again moves it to the end.
    fn has_rival_after(&self, index: usize) -> bool {
        let entry = &self.0[index];
        self.1.may_have_logical
            && self.0[index + 1..]
                .iter()
                .any(|it| (it.code ^ entry.code) & 3 == 3 && entry.key().competes_with(it.key()))
    }

    fn is_changed_by(&self, specified: &Rc<Specified>) -> bool {
        (0..).zip(specified.key.entries()).any(|(part, key)| {
            self.find(key).is_none_or(|it| {
                self.has_rival_after(it)
                    || !self.0[it].is_same(&Entry {
                        code: key.code(),
                        part,
                        of: Rc::clone(specified),
                    })
            })
        })
    }

    /// Whether `remove` would find something.
    pub(crate) fn has_some_of(&self, key: Key) -> bool {
        self.0.iter().any(key.covers())
    }

    pub(crate) fn has(&self, key: Key) -> bool {
        self.find(key).is_some()
    }

    /// `None` if one is missing, or if their priorities differ.
    fn find_all(&self, shorthand: Key) -> Option<Found> {
        let longhands = shorthand.longhands();
        (self.0.len() >= longhands.len()).then_some(())?;
        let found: Found = longhands
            .iter()
            .map(|it| self.find(Key::Property(*it)))
            .collect::<Option<_>>()?;
        found
            .iter()
            .all(|it| self.0[*it].of.important == self.0[found[0]].of.important)
            .then_some(found)
    }

    fn join(&self, shorthand: Key, found: &[usize]) -> Cow<'_, [u8]> {
        let (entries, first) = (|| found.iter().map(|it| &self.0[*it]), &self.0[found[0]].of);
        let resets_variants = |it: &Specified| {
            is_system_font(it.key, &it.source) && shorthand.name() == "font-variant"
        };
        if entries().any(|it| it.of.is_pending && !resets_variants(&it.of)) {
            let is_whole = entries().all(|it| Rc::ptr_eq(&it.of, first))
                && first.key.longhands() == shorthand.longhands();
            return if is_whole { &first.source[..] } else { b"" }.into();
        }
        if entries().any(|it| {
            it.of
                .declaration
                .as_ref()
                .is_some_and(|it| matches!(it.value, Declared::Template(_)))
        }) {
            return Cow::default();
        }
        let values: SmallVec<[_; 8]> = entries()
            .map(|it| {
                Some(it.value())
                    .filter(|it| !it.is_empty())
                    .unwrap_or(b"normal")
            })
            .collect();
        match shorthand {
            _ if values.iter().any(|it| Wide::from_name(it).is_some()) => {
                if values.iter().all(|it| *it == values[0]) {
                    values[0]
                } else {
                    b""
                }
                .into()
            }
            Key::Property(Prop::Short(index)) => shorthand::get(index).join(&values, None).into(),
            _ => Cow::default(),
        }
    }

    pub(crate) fn get(&self, key: Key) -> Cow<'_, [u8]> {
        match key.longhands().is_empty() {
            true => self
                .find(key)
                .map_or(&b""[..], |it| self.0[it].value())
                .into(),
            false => self
                .find_all(key)
                .map_or_else(Cow::default, |it| self.join(key, &it)),
        }
    }

    /// The serialization, and what it is of.
    pub(crate) fn get_with_source(&self, key: Key) -> Option<[Cow<'_, [u8]>; 2]> {
        match self.find(key) {
            Some(index) => Some([self.0[index].value().into(), self.0[index].source().into()]),
            None => Some(self.get(key))
                .filter(|it| !it.is_empty())
                .map(|it| [it.clone(), it]),
        }
    }

    pub(crate) fn is_important(&self, key: Key) -> bool {
        let found = if key.longhands().is_empty() {
            self.find(key)
        } else {
            self.find_all(key).map(|it| it[0])
        };
        found.is_some_and(|it| self.0[it].of.important)
    }

    /// <https://drafts.csswg.org/cssom/#set-a-css-declaration>. Whether it changes anything.
    pub(crate) fn set(&mut self, specified: &Rc<Specified>) -> bool {
        self.put(specified, false)
    }

    fn put(&mut self, specified: &Rc<Specified>, is_parsing: bool) -> bool {
        let mut has_changed = false;
        for (part, key) in (0..).zip(specified.key.entries()) {
            let entry = Entry {
                code: key.code(),
                part,
                of: Rc::clone(specified),
            };
            match self.find(key) {
                Some(index) if is_parsing && !specified.important && self.0[index].of.important => {
                    continue;
                }
                Some(index) if is_parsing || self.has_rival_after(index) => {
                    _ = self.0.remove(index)
                }
                Some(index) => {
                    has_changed |= !self.0[index].is_same(&entry);
                    self.0[index] = entry;
                    continue;
                }
                None => self.1.flip(entry.code),
            }
            self.1.may_have_logical |= entry.code & 3 == 2;
            self.0.push(entry);
            has_changed = true;
        }
        if self.0.len() > Hints::LONG && self.1.present.is_none() {
            self.1.present = Some(Box::new([0; _]));
            self.0.iter().for_each(|it| self.1.flip(it.code));
        }
        has_changed
    }

    /// Whether it was there.
    pub(crate) fn remove(&mut self, key: Key) -> bool {
        if key.longhands().is_empty() {
            return self
                .find(key)
                .map(|it| self.1.flip(self.0.remove(it).code))
                .is_some();
        }
        let covers = key.covers();
        let Some(first) = self.0.iter().position(&covers) else {
            return false;
        };
        self.0
            .extract_if(first.., |it| covers(it))
            .for_each(|it| self.1.flip(it.code));
        true
    }

    /// <https://drafts.csswg.org/cssom/#serialize-a-css-declaration-block>
    pub(crate) fn serialize(&self) -> Out {
        const ALL: Key = Key::Property(Prop::All);
        let (mut out, mut is_done, everything) =
            (Out::new(), vec![false; self.0.len()], self.find_all(ALL));
        for (index, entry) in self.0.iter().enumerate() {
            if is_done[index] {
                continue;
            }
            let all = everything
                .iter()
                .filter(|it| it.contains(&index))
                .map(|it| (ALL, it.clone()));
            let others = shorthands_of(entry.key())
                .iter()
                .map(|it| Key::Property(*it))
                .filter_map(|it| Some((it, self.find_all(it)?)));
            let unused = all
                .chain(others)
                .filter(|it| !it.1.iter().any(|it| is_done[*it]));
            match unused
                .map(|it| (self.join(it.0, &it.1), it))
                .find(|it| !it.0.is_empty())
            {
                Some((value, (shorthand, found))) => {
                    write_declaration(shorthand, &value, entry.of.important, &mut out);
                    found.into_iter().for_each(|it| is_done[it] = true);
                }
                None => write_declaration(entry.key(), entry.value(), entry.of.important, &mut out),
            }
        }
        out
    }

    pub(crate) fn serialize_in_order(&self, descriptors: &[&'static str]) -> Out {
        let mut out = Out::new();
        for entry in descriptors
            .iter()
            .filter_map(|it| self.find(Key::Descriptor(it)))
            .map(|it| &self.0[it])
        {
            write_declaration(entry.key(), entry.value(), false, &mut out);
        }
        out
    }

    /// With all the digits.
    pub(crate) fn descriptor_sources(&self) -> Out {
        let mut out = Out::new();
        self.0
            .iter()
            .for_each(|it| write_declaration(it.key(), it.source(), false, &mut out));
        out
    }

    pub(crate) fn for_cascade(&self) -> Vec<Rc<Declaration>> {
        let (mut all, mut rest) = (Vec::with_capacity(self.0.len()), &self.0[..]);
        while let [first, ..] = rest {
            let count = first.of.key.longhands().len().max(1);
            let is_whole = rest
                .get(..count)
                .is_some_and(|it| it.iter().all(|it| Rc::ptr_eq(&it.of, &first.of)));
            match (is_whole, first.key()) {
                (true, _) => all.extend(first.of.declaration.clone()),
                (false, Key::Property(longhand)) => {
                    all.extend(first.of.only_for(longhand).map(Rc::new))
                }
                _ => {}
            }
            rest = &rest[if is_whole { count } else { 1 }..];
        }
        all
    }

    fn identity(&self, within: Within) -> u64 {
        let mut hasher = FastHasher::default();
        within.hash(&mut hasher);
        self.0
            .iter()
            .for_each(|it| (it.of.hash(), it.part).hash(&mut hasher));
        hasher.finish()
    }
}

/// A value that is in no block.
#[derive(Clone)]
pub(crate) struct Standalone {
    pub(crate) prop: Prop,
    pub(crate) written: Text,
    pub(crate) declaration: Option<Rc<Declaration>>,
}

impl Standalone {
    pub(crate) fn parse(prop: Prop, source: &[u8]) -> Option<Standalone> {
        let (key, mut list) = (Key::Property(prop), DeclarationList::default());
        let specified = Rc::new(Specified::parse(
            Accepts::Properties(Within::Style),
            key,
            source,
            false,
        )?);
        list.set(&specified);
        Some(Standalone {
            prop,
            written: list.get(key).into(),
            declaration: specified.declaration.clone(),
        })
    }

    pub(crate) fn computed(prop: Prop, value: &[u8]) -> Standalone {
        Standalone {
            prop,
            written: value.into(),
            declaration: Declared::parse(prop, value)
                .map(|it| Rc::new(Declaration::new(prop, false, it, None))),
        }
    }
}

enum Edit {
    Set(Rc<Specified>),
    Remove(Key),
}

impl Edit {
    fn changes(&self, list: &DeclarationList) -> bool {
        match self {
            Edit::Set(specified) => list.is_changed_by(specified),
            Edit::Remove(key) => list.has_some_of(*key),
        }
    }

    fn apply(&self, list: &mut DeclarationList) -> bool {
        match self {
            Edit::Set(specified) => list.set(specified),
            Edit::Remove(key) => list.remove(*key),
        }
    }
}

/// What scripts see of a `Block`. If that is shared it does not change: an edit makes another one.
pub(crate) struct Editable {
    pub(crate) list: DeclarationList,
    text: OnceCell<Text>,
    /// The last edit, and what that led to.
    next: RefCell<Option<(Edit, Weak<Block>)>>,
}

impl Editable {
    pub(crate) fn new(list: DeclarationList) -> Editable {
        Editable {
            list,
            text: OnceCell::new(),
            next: RefCell::default(),
        }
    }

    pub(crate) fn text(&self) -> &Text {
        self.text.get_or_init(|| self.list.serialize().into())
    }

    fn after(&self, is_it: impl FnOnce(&Edit) -> bool) -> Option<Rc<Block>> {
        self.next
            .borrow()
            .as_ref()
            .filter(|it| is_it(&it.0))?
            .1
            .upgrade()
    }
}

impl Block {
    pub(crate) fn is_blank(&self) -> bool {
        self.editable
            .get()
            .map_or_else(|| self.has_source(b""), |it| it.list.is_empty())
    }

    fn is_in(&self, within: Within, base_url: &Rc<[u8]>) -> bool {
        self.within() == within
            && (Rc::ptr_eq(&self.base_url, base_url) || self.base_url == *base_url)
    }

    /// Of a property whose value can be replaced without anything else noticing.
    pub(crate) fn place_of(&self, property: Prop) -> Option<Place> {
        let (key, list) = (
            Key::Property(property),
            &self.editable.get().filter(|_| self.has_source(b""))?.list,
        );
        let entry = list.find(key).filter(|it| {
            list.0[*it].of.key == key && !list.0[*it].of.important && !list.has_rival_after(*it)
        })?;
        let old = list.0[entry]
            .of
            .declaration
            .as_ref()
            .filter(|it| matches!(it.value, Declared::Text(_)))?;
        let declaration = self
            .declarations()
            .list
            .iter()
            .take(32)
            .position(|it| Rc::ptr_eq(it, old))?;
        Some(Place {
            property,
            entry,
            declaration,
        })
    }

    /// What `amend` is going to need. Each step relies on the one before it.
    #[inline(always)]
    pub(crate) fn prefetch(&self, step: usize) {
        let Some((editable, parsed)) = self.editable.get().zip(self.parsed()) else {
            return;
        };
        match step {
            0 => (prefetch(&**editable), prefetch(&*parsed.list)).0,
            1 => {
                (
                    prefetch(&*editable.list.0),
                    parsed
                        .list
                        .iter()
                        .take(3)
                        .for_each(|it| prefetch_shared(it, 2)),
                )
                    .0
            }
            2 => editable
                .list
                .0
                .iter()
                .take(3)
                .for_each(|it| prefetch_shared(&it.of, 2)),
            _ => editable
                .list
                .0
                .iter()
                .take(3)
                .for_each(|it| prefetch_shared(&it.of.source, 1)),
        }
    }

    pub(crate) fn editable(&self) -> &Editable {
        self.editable.get_or_init(|| {
            let mut list = DeclarationList::default();
            self.visit_sources(|declaration, source| {
                _ = list.put(
                    &Rc::new(Specified::of(Rc::clone(declaration), source)),
                    true,
                )
            });
            Box::new(Editable::new(list))
        })
    }
}

#[derive(Clone, Copy)]
pub(crate) struct Place {
    property: Prop,
    entry: usize,
    pub(crate) declaration: usize,
}

/// Equal inline styles share a block, and so their elements can share a style.
#[derive(Default)]
pub(crate) struct InlineBlocks {
    blocks: Map<u64, Rc<Block>>,
    /// Those that were set more than once.
    specified: Map<u64, Rc<Specified>>,
    /// The last value that was not valid, with its hash.
    refused: (u64, Vec<u8>),
    /// Some bits of the hashes of the last ones that were parsed.
    seen: Vec<u16>,
}

impl InlineBlocks {
    const MAX_SPECIFIED: usize = 4096;

    pub(crate) fn parse(
        &mut self,
        source: &[u8],
        within: Within,
        base_url: &Rc<[u8]>,
    ) -> Rc<Block> {
        let hash = bun_wyhash::hash_with_seed(within as u64, source);
        match self
            .blocks
            .get(&hash)
            .filter(|it| it.has_source(source) && it.is_in(within, base_url))
        {
            Some(known) => Rc::clone(known),
            None => Rc::clone(
                self.blocks
                    .entry(hash)
                    .insert(Rc::new(Block::parse(source, within, base_url)))
                    .get(),
            ),
        }
    }

    pub(crate) fn share(
        &mut self,
        list: DeclarationList,
        within: Within,
        base_url: &Rc<[u8]>,
    ) -> Rc<Block> {
        let hash = list.identity(within);
        match self.blocks.get(&hash).filter(|it| {
            it.has_source(b"") && it.editable().list == list && it.is_in(within, base_url)
        }) {
            Some(known) => Rc::clone(known),
            None => Rc::clone(
                self.blocks
                    .entry(hash)
                    .insert(Rc::new(Block::edited(list, within, base_url)))
                    .get(),
            ),
        }
    }

    /// Whether it changes anything.
    pub(crate) fn set(
        &mut self,
        block: &mut Rc<Block>,
        prop: Prop,
        source: &[u8],
        important: bool,
    ) -> bool {
        let (editable, key, within) = (block.editable(), Key::Property(prop), block.within());
        if let Some(known) =
            editable.after(|it| matches!(it, Edit::Set(it) if it.is(key, source, important)))
        {
            *block = known;
            return true;
        }
        let (source, list) = (scan::trim(source), &editable.list);
        if list
            .find(key)
            .is_some_and(|it| list.0[it].of.is(key, source, important) && !list.has_rival_after(it))
        {
            return false;
        }
        self.specified(key, source, important, within)
            .is_some_and(|(it, is_known)| self.edit(block, Edit::Set(it), is_known))
    }

    /// And whether another block may have it.
    fn specified(
        &mut self,
        key: Key,
        source: &[u8],
        important: bool,
        within: Within,
    ) -> Option<(Rc<Specified>, bool)> {
        let hash = hash_of(key, important, source) ^ within as u64;
        if let Some(known) = self
            .specified
            .get(&hash)
            .filter(|it| it.is(key, source, important))
        {
            return Some((Rc::clone(known), true));
        }
        if self.refused.0 == hash && self.refused.1 == source {
            return None;
        }
        let Some(specified) =
            Specified::parse(Accepts::Properties(within), key, source, important).map(Rc::new)
        else {
            self.refused = (hash, source[..source.len().min(64)].to_vec());
            return None;
        };
        self.seen.resize(Self::MAX_SPECIFIED, 0);
        let is_repeated = core::mem::replace(
            &mut self.seen[hash as usize % Self::MAX_SPECIFIED],
            (hash >> 32) as u16,
        ) == (hash >> 32) as u16;
        if is_repeated {
            if self.specified.len() >= Self::MAX_SPECIFIED {
                self.specified.clear();
            }
            self.specified.insert(hash, Rc::clone(&specified));
        }
        Some((specified, is_repeated))
    }

    /// Leaves all declarations where they are. Whether it changes anything, or `None` if it takes `set`.
    pub(crate) fn amend(
        &mut self,
        block: &mut Rc<Block>,
        place: Place,
        source: &[u8],
        is_plain: bool,
    ) -> Option<bool> {
        let source = scan::trim(source);
        if block.editable().list.0[place.entry].source() == source {
            return Some(false);
        }
        if (is_plain
            || matches!(place.property, Prop::Custom(_)) && crate::custom::is_plain(source))
            && let Some((editable, declaration)) =
                Rc::get_mut(block).and_then(|it| it.editable_with(place.declaration))
            && Rc::get_mut(&mut editable.list.0[place.entry].of)
                .is_some_and(|it| it.rewrite(declaration, source))
        {
            (editable.text, editable.next) = Default::default();
            return Some(true);
        }
        let key = Key::Property(place.property);
        let Some((specified, _)) = self.specified(key, source, false, block.within()) else {
            return Some(false);
        };
        let declaration = Rc::clone(
            specified
                .declaration
                .as_ref()
                .filter(|it| matches!(it.value, Declared::Text(_)))?,
        );
        let entry = Entry {
            code: key.code(),
            part: 0,
            of: specified,
        };
        if block.editable().list.0[place.entry].is_same(&entry) {
            return Some(false);
        }
        if Rc::get_mut(block).is_none() {
            *block = Rc::new(block.copy());
        }
        let (editable, old) = Rc::get_mut(block)?.editable_with(place.declaration)?;
        (editable.list.0[place.entry], *old) = (entry, declaration);
        (editable.text, editable.next) = Default::default();
        Some(true)
    }

    /// Whether it was there.
    pub(crate) fn remove(&mut self, block: &mut Rc<Block>, prop: Prop) -> bool {
        let key = Key::Property(prop);
        if let Some(known) = block
            .editable()
            .after(|it| matches!(it, Edit::Remove(it) if *it == key))
        {
            *block = known;
            return true;
        }
        self.edit(block, Edit::Remove(key), true)
    }

    /// `may_be_known` is false if no other block can be like the result.
    fn edit(&mut self, block: &mut Rc<Block>, edit: Edit, may_be_known: bool) -> bool {
        if let Some(own) = Rc::get_mut(block)
            && let Some(editable) = own.editable.get_mut()
        {
            let has_changed = edit.apply(&mut editable.list);
            if has_changed {
                (editable.text, editable.next) = Default::default();
                own.forget_source();
            }
            return has_changed;
        }
        if !edit.changes(&block.editable().list) {
            return false;
        }
        let mut list = block.editable().list.clone();
        edit.apply(&mut list);
        *block = match may_be_known && list.len() <= 24 {
            true => {
                let edited = self.share(list, block.within(), &block.base_url);
                block
                    .editable()
                    .next
                    .replace(Some((edit, Rc::downgrade(&edited))));
                edited
            }
            false => Rc::new(Block::edited(list, block.within(), &block.base_url)),
        };
        true
    }

    pub(crate) fn len(&self) -> usize {
        self.blocks.len()
    }

    pub(crate) fn forget_unused(&mut self) {
        self.blocks.retain(|_, block| Rc::strong_count(block) > 1);
    }
}
