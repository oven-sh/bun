//! Entries of payloads, and the code of the functions in them once it is asked for.

use core::any::Any;
use core::cell::{OnceCell, RefCell};
use core::ops::Range;
use std::rc::{Rc, Weak};
use std::sync::OnceLock;

use bun_engine_syntax::LineTable;
use bun_engine_text::{Identifier, PropertyName, StringRef, Text, names};
use hashbrown::HashTable;

use super::format::{name, signature, spread};
use super::records::Decoder;
use super::strings::StringTable;
use super::{FunctionKey, Goal, Key, Payload};
use crate::bytes::Reader;
use crate::code::{Code, CodeKind, Module, Script};
use crate::function::{FunctionInfo, Origin, Specialization};
use crate::host::Host;
use crate::scope::{ScopeKind, SlotKind, StaticScope};

#[derive(Clone, Copy, PartialEq, Eq, Hash, Debug)]
pub struct EntryId {
    /// The address of its first byte.
    pub payload: usize,
    pub offset: u32,
}

/// Learns what is read of embedded payloads, on the thread that reads it.
pub trait Observer: Any + Sync {
    fn entry_read(&self, entry: EntryId, is_usable: bool);
    /// `record` is where the code is in the payload.
    fn function_read(&self, entry: EntryId, key: Option<FunctionKey>, record: Range<u32>);
    /// May come more than once for a string, and only if [`Embedding::is_recorded`].
    fn shared_string_read(&self, text: Text<'_>);
}

/// What the payloads of an executable have in common.
pub struct Embedding {
    /// From [`super::StringTableBuilder::finish`].
    pub strings: &'static [u8],
    pub observer: Option<&'static dyn Observer>,
    pub is_recorded: bool,
}

static EMBEDDING: OnceLock<Embedding> = OnceLock::new();

impl Embedding {
    /// For the loaders that are made from now on. The first stays.
    pub fn install(self) {
        EMBEDDING.get_or_init(|| self);
    }
}

/// One for each thread that runs code.
pub struct Loader {
    shared_strings: Option<StringTable>,
    observer: Option<&'static dyn Observer>,
    is_recorded: bool,
    pub(super) no_functions: Rc<[FunctionInfo]>,
    /// An entry is loaded once for each scope that it is put in. From the first such scope on, code that has neither
    /// scopes nor functions serves all. By the address of the record.
    leaves: OnceCell<RefCell<HashTable<(usize, Weak<Code>)>>>,
}

impl Default for Loader {
    fn default() -> Loader {
        Loader::new(EMBEDDING.get())
    }
}

pub struct Loaded<T> {
    pub root: T,
    pub lines: Option<CachedLines>,
}

/// Where the lines of the source start, for when that is asked.
pub struct CachedLines {
    payload: Payload,
    at: u32,
}

impl CachedLines {
    pub(super) fn bytes(&self) -> Option<&[u8]> {
        self.payload.blob(self.at)
    }

    pub fn table(&self) -> Option<LineTable<'_>> {
        LineTable::read(self.bytes()?)
    }
}

/// What the code of one entry shares.
pub(crate) struct Unit {
    pub(super) loader: Rc<Loader>,
    pub(super) payload: Payload,
    entry: u32,
    pub(super) source: StringRef,
    own_strings: Option<StringTable>,
    /// Of the functions that have a source.
    pub(super) origin: Origin,
    /// The code was generated without it, and so holds unless it names what is in there.
    outer: Option<Rc<StaticScope>>,
}

impl Unit {
    pub(super) fn strings(&self) -> Option<&StringTable> {
        (self.own_strings.as_ref()).or(self.loader.shared_strings.as_ref())
    }

    #[inline]
    pub(super) fn note_string(&self, text: Text<'_>) {
        if self.loader.is_recorded
            && self.own_strings.is_none()
            && let Some(observer) = self.loader.observer
        {
            observer.shared_string_read(text);
        }
    }

    /// Whether code with these names means in `outer` what it means without.
    #[inline]
    pub(super) fn suits(&self, names: &[Identifier]) -> bool {
        let outer = self.outer.as_ref();
        outer.is_none() || !names.iter().any(|it| binds(outer, it.name()))
    }

    /// Empty if there is none.
    pub(crate) fn text(&self, reference: u32) -> Text<'_> {
        let text = || (self.strings()?).text(reference.checked_sub(name::FIRST_ORDINAL)?);
        text()
            .inspect(|&text| self.note_string(text))
            .unwrap_or(Text::EMPTY)
    }
}

pub(crate) struct CachedCode {
    pub(super) unit: Rc<Unit>,
    /// For [`FunctionInfo::likely_specialization`], or zero.
    pub(super) record: u32,
}

impl CachedCode {
    pub(crate) fn text(&self, reference: u32) -> Text<'_> {
        self.unit.text(reference)
    }

    pub(crate) fn exists(&self) -> bool {
        self.record != 0
    }

    /// The function that it is decoded for holds on to it.
    pub(crate) fn load(&self, function: &FunctionInfo, host: &dyn Host) -> Option<Rc<Code>> {
        let (unit, at) = (&self.unit, self.record);
        let record = unit.payload.blob(at).filter(|_| at != 0)?;
        let Some(leaves) = (unit.loader.leaves.get()).filter(|_| unit.payload.is_embedded()) else {
            return self.decode(record, function, host);
        };
        let (address, mut leaves) = (record.as_ptr().addr(), leaves.borrow_mut());
        let hash = |address: usize| spread(address as u64);
        let known = leaves.find_mut(hash(address), |it| it.0 == address);
        if let Some(code) = known.as_ref().and_then(|it| it.1.upgrade()) {
            return unit.suits(&code.identifiers).then_some(code);
        }
        let code = self.decode(record, function, host)?;
        match known {
            Some(known) => known.1 = Rc::downgrade(&code),
            None if code.scopes.is_empty() && code.functions.is_empty() => {
                if leaves.len() == leaves.capacity() {
                    leaves.retain(|it| it.1.strong_count() != 0);
                    let alive = leaves.len();
                    leaves.reserve(alive, |it| hash(it.0));
                }
                let leaf = (address, Rc::downgrade(&code));
                leaves.insert_unique(hash(address), leaf, |it| hash(it.0));
            }
            None => {}
        }
        Some(code)
    }

    fn decode(&self, record: &[u8], function: &FunctionInfo, host: &dyn Host) -> Option<Rc<Code>> {
        let (unit, at) = (&self.unit, self.record);
        unit.loader.tell(&unit.payload, |observer| {
            let (entry, key) = (unit.payload.entry(unit.entry), FunctionKey::of(function));
            observer.function_read(entry, key, at..at + record.len() as u32);
        });
        let mut decoder = Decoder::new(unit, function.scope.as_ref(), host)?;
        decoder.function = Some(function);
        let kind = match function.likely_specialization() {
            Specialization::Call => CodeKind::Call,
            Specialization::Construct => CodeKind::Construct,
        };
        let reader = &mut Reader::new(record);
        (reader.byte()? == signature(function)).then_some(())?;
        let code = decoder.code(reader, kind)?;
        function.set_code(function.likely_specialization(), Some(Rc::clone(&code)));
        Some(code)
    }
}

impl Payload {
    fn entry(&self, offset: u32) -> EntryId {
        let payload = self.bytes().as_ptr().addr();
        EntryId { payload, offset }
    }
}

pub(super) type Outer<'a> = Option<&'a Rc<StaticScope>>;

fn binds(outer: Outer<'_>, name: PropertyName<'_>) -> bool {
    core::iter::successors(outer, |scope| scope.parent()).any(|scope| scope.find(name).is_some())
}

/// Whether the scopes make a difference to no code but what looks up one of their variables by name.
fn has_only_variables(outer: Outer<'_>) -> bool {
    let is_plain = |scope: &Rc<StaticScope>| {
        scope.kind == ScopeKind::Block
            && scope.eval_variables_slot.is_none()
            && (scope.slots.iter()).all(|slot| slot.kind == SlotKind::Variable)
    };
    let constants = [names::undefined, names::NaN, names::Infinity];
    core::iter::successors(outer, |scope| scope.parent()).all(is_plain)
        && !constants.into_iter().any(|name| binds(outer, name))
}

impl Loader {
    pub(crate) fn new(embedding: Option<&Embedding>) -> Loader {
        let strings = embedding.map(|it| Payload::embedded(it.strings));
        Loader {
            shared_strings: strings.and_then(|it| StringTable::new(it, 0)),
            observer: embedding.and_then(|it| it.observer),
            is_recorded: embedding.is_some_and(|it| it.is_recorded),
            no_functions: Rc::default(),
            leaves: OnceCell::new(),
        }
    }

    /// Whether the order in which code is loaded is being written down.
    pub fn is_recorded(&self) -> bool {
        self.is_recorded
    }

    #[inline]
    fn tell(&self, payload: &Payload, news: impl FnOnce(&dyn Observer)) {
        if let Some(observer) = self.observer
            && payload.is_embedded()
        {
            news(observer);
        }
    }

    /// `outer` is what lies between the code and the global scope, here and below.
    pub fn script(
        self: &Rc<Self>,
        payload: &Payload,
        entry: u32,
        key: &Key<'_>,
        host: &dyn Host,
        outer: Outer<'_>,
    ) -> Option<Loaded<Script>> {
        debug_assert!(key.goal == Goal::Script);
        let origin = Origin::empty();
        self.load(payload, entry, key, origin, outer, |unit, reader| {
            let mut decoder = Decoder::new(unit, outer, host)?;
            Some(Script {
                directives: decoder.directives(reader)?,
                declarations: decoder.declarations(reader)?,
                code: decoder.code(reader, CodeKind::Script)?,
                outer: outer.cloned(),
            })
        })
    }

    pub fn module(
        self: &Rc<Self>,
        payload: &Payload,
        entry: u32,
        key: &Key<'_>,
        host: &dyn Host,
        outer: Outer<'_>,
        needs_interface: bool,
    ) -> Option<Loaded<Module>> {
        debug_assert!(key.goal == Goal::Module);
        let origin = Origin::MODULE;
        self.load(payload, entry, key, origin, outer, |unit, reader| {
            Decoder::new(unit, outer, host)?.module(reader, needs_interface)
        })
    }

    /// Gives it the code, and the means to load that again.
    pub fn builtin(
        self: &Rc<Self>,
        payload: &Payload,
        entry: u32,
        key: &Key<'_>,
        host: &dyn Host,
        function: &FunctionInfo,
    ) -> Option<Loaded<()>> {
        debug_assert!(key.goal == Goal::Builtin);
        payload.is_embedded().then_some(())?;
        self.load(
            payload,
            entry,
            key,
            function.origin,
            None,
            |unit, reader| {
                let (unit, record) = (Rc::clone(unit), reader.fixed()?);
                let cached = CachedCode { unit, record };
                cached.load(function, host)?;
                function.code.cached.set(cached).ok()
            },
        )
    }

    fn load<T>(
        self: &Rc<Self>,
        payload: &Payload,
        entry: u32,
        key: &Key<'_>,
        origin: Origin,
        outer: Outer<'_>,
        root: impl FnOnce(&Rc<Unit>, &mut Reader<'_>) -> Option<T>,
    ) -> Option<Loaded<T>> {
        let load = || {
            let bytes = payload.bytes().get(entry as usize..)?;
            let is_identified = key.identity.is_some() || payload.is_embedded();
            (is_identified && key.opens(bytes) && has_only_variables(outer)).then_some(())?;
            if outer.is_some() {
                self.leaves.get_or_init(RefCell::default);
            }
            let mut reader = Reader::new(&bytes[Key::BYTES..]);
            let (strings_at, lines_at) = (reader.fixed()?, reader.fixed()?);
            let unit = Rc::new(Unit {
                loader: Rc::clone(self),
                payload: payload.clone(),
                entry,
                source: key.source.clone(),
                own_strings: match strings_at {
                    0 => payload.is_embedded().then_some(None)?,
                    at => Some(StringTable::new(payload.clone(), at)?),
                },
                origin,
                outer: outer.cloned(),
            });
            let lines = (lines_at != 0).then(|| CachedLines {
                payload: payload.clone(),
                at: lines_at,
            });
            Some(Loaded {
                root: root(&unit, &mut reader.section()?)?,
                lines: lines.filter(|it| payload.is_embedded() || it.table().is_some()),
            })
        };
        let loaded = load();
        self.tell(payload, |observer| {
            observer.entry_read(payload.entry(entry), loaded.is_some());
        });
        loaded
    }
}
