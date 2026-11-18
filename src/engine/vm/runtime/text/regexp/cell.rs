use core::cell::{Cell, OnceCell};
use core::mem::offset_of;
use core::sync::atomic::{AtomicU32, Ordering};

use bun_engine_macros::cell;
use bun_engine_regexp::{
    Error, ErrorKind, Flags, Form, GroupNames, Pattern, escape_pattern, may_be_near_limits,
    summarize,
};
use bun_engine_text::{AllocError, Atom, Identifier, StringImpl, StringRef, Text};

use super::code::{Code, Entries};
use crate::heap::Held;
use crate::{Cx, Gc, JsCell, JsResult, JsString, Shape, Thrown, TypeFlags, Visitor, Vm, WeakField};

/// A pattern with its flags, and what it has been compiled to. All objects with the same two share it.
#[cell(name = "RegExp", cell_type = RegExp, export = "engine_class_RegExp", flags = TypeFlags::SHAPE_IS_IMMORTAL,
    visit_children, estimated_size)]
pub struct RegExp {
    base: JsCell,
    pub(super) entries: Entries,
    pattern: StringRef,
    analysis: OnceCell<Box<Analysis>>,
    pub(super) groups_shape: WeakField<Option<Gc<Shape>>>,
    /// The bytes of the code.
    pub(super) code_size: AtomicU32,
    group_count: Cell<u16>,
    flags: Flags,
    has_named_groups: Cell<bool>,
    /// False before it has been asked for.
    is_pattern_its_source: Cell<bool>,
    /// Only a literal can have one: evaluating it throws.
    error: Option<Error>,
}

/// What the first search finds out.
pub(super) struct Analysis {
    /// Takes the place of code.
    pub(super) form: Option<Form>,
    pub(super) names: GroupNames,
    /// In the order of `names`.
    pub(super) identifiers: Box<[Identifier]>,
    pub(super) code: Code,
}

fn check(pattern: Text<'_>, flags: Flags) -> Result<(), Error> {
    if summarize(pattern, flags)?.is_near_limits() {
        Pattern::new(pattern, flags)?;
    }
    Ok(())
}

impl RegExp {
    /// Four words: see `Entries`. Anything that can collect or search can change them and free the code, so one is
    /// loaded for each search. If it gives a negative start other than −1, the search is for `find` or `exec` to do.
    pub const OFFSET_OF_ENTRIES: usize = offset_of!(RegExp, entries);
    /// A byte that never changes.
    pub const OFFSET_OF_FLAGS: usize = offset_of!(RegExp, flags);

    fn allocate(vm: &Vm, pattern: &StringImpl, flags: Flags, error: Option<Error>) -> Gc<RegExp> {
        vm.allocate::<RegExp>(RegExpInit {
            base: vm.shapes.regexp(),
            entries: Entries::default(),
            pattern: StringRef::retain(pattern),
            analysis: OnceCell::new(),
            groups_shape: None,
            code_size: AtomicU32::new(0),
            group_count: Cell::new(0),
            flags,
            has_named_groups: Cell::new(false),
            is_pattern_its_source: Cell::new(false),
            error,
        })
    }

    #[inline]
    fn find_or_create(
        vm: &Vm,
        pattern: &StringImpl,
        flags: Flags,
        check: impl FnOnce() -> Result<(), Error>,
    ) -> Result<Gc<RegExp>, Error> {
        let cache = &vm.regexps().cache;
        if let Some(regexp) = cache.get(vm, pattern, flags) {
            return Ok(regexp);
        }
        check()?;
        let regexp = Self::allocate(vm, pattern, flags, None);
        cache.insert(regexp);
        Ok(regexp)
    }

    pub fn try_create(vm: &Vm, pattern: &StringImpl, flags: Flags) -> Result<Gc<RegExp>, Error> {
        Self::find_or_create(vm, pattern, flags, || check(pattern.text(), flags))
    }

    pub fn create(cx: &Cx, pattern: &StringImpl, flags: Flags) -> JsResult<Gc<RegExp>> {
        Self::try_create(cx, pattern, flags).map_err(|error| Self::throw(cx, error))
    }

    /// The parser has seen to the early errors.
    pub fn for_literal(vm: &Vm, pattern: &StringImpl, flags: Text<'_>) -> Gc<RegExp> {
        let Some(flags) = Flags::parse(flags) else {
            return Self::allocate(vm, pattern, Flags::empty(), Some(Error::InvalidFlags));
        };
        let check = || match may_be_near_limits(pattern.text()) {
            true => check(pattern.text(), flags),
            false => Ok(()),
        };
        Self::find_or_create(vm, pattern, flags, check).unwrap_or_else(|error| {
            let lasting = (error != Error::OutOfMemory).then_some(error);
            Self::allocate(vm, pattern, flags, lasting)
        })
    }

    #[cold]
    pub fn throw(cx: &Cx, error: Error) -> Thrown {
        match error.kind() {
            ErrorKind::SyntaxError => cx.throw_syntax_error(error.message()),
            ErrorKind::OutOfMemory => cx.throw_out_of_memory_with(error.message()),
        }
    }

    #[inline(always)]
    pub(super) fn check_literal(&self, cx: &Cx) -> JsResult<()> {
        let Some(error) = self.error else {
            return Ok(());
        };
        let message = error.message();
        Err(cx.throw_syntax_error(message.strip_prefix("Out of memory: ").unwrap_or(message)))
    }

    /// False for a literal that throws when it is evaluated.
    pub fn is_valid(&self) -> bool {
        self.error.is_none()
    }

    #[inline(always)]
    pub fn pattern(&self) -> Held<'_, StringImpl> {
        Held::new(self, &self.pattern)
    }

    #[inline(always)]
    pub fn flags(&self) -> Flags {
        self.flags
    }

    #[inline(always)]
    pub fn is_global(&self) -> bool {
        self.flags.contains(Flags::GLOBAL)
    }

    #[inline(always)]
    pub fn is_sticky(&self) -> bool {
        self.flags.contains(Flags::STICKY)
    }

    #[inline(always)]
    pub fn uses_last_index(&self) -> bool {
        self.flags.intersects(Flags::GLOBAL | Flags::STICKY)
    }

    /// EscapeRegExpPattern
    pub fn source(&self, cx: &Cx) -> JsResult<Gc<JsString>> {
        let pattern = self.pattern();
        if !self.is_pattern_its_source.get() {
            if let Some(escaped) = cx.or_out_of_memory(escape_pattern(pattern.text()))? {
                return Ok(JsString::new(cx, escaped));
            }
            self.is_pattern_its_source.set(true);
        }
        Ok(JsString::from_impl_cached(cx, &pattern))
    }

    /// As it would be written in a script. Empty if there is no memory.
    pub fn to_literal_text(&self) -> StringRef {
        let escaped = escape_pattern(self.pattern.text()).unwrap_or_default();
        let (solidus, flags) = (Text::from_ascii("/"), self.flags.to_text());
        let source = escaped.as_ref().unwrap_or(&self.pattern).text();
        StringRef::try_concat(&[solidus, source, solidus, flags.text()]).unwrap_or_default()
    }

    /// Zero before the first search.
    #[inline(always)]
    pub(super) fn group_count(&self) -> usize {
        self.group_count.get().into()
    }

    /// `None` before the first search.
    pub fn known_group_count(&self) -> Option<usize> {
        self.analysis.get().map(|_| self.group_count())
    }

    #[inline(always)]
    pub(super) fn is_known_to_have_no_groups(&self) -> bool {
        self.group_count() == 0 && self.analysis.get().is_some()
    }

    /// False before the first search.
    #[inline(always)]
    pub(super) fn has_named_groups(&self) -> bool {
        self.has_named_groups.get()
    }

    #[inline(always)]
    pub(super) fn analysis(&self) -> Option<Held<'_, Analysis>> {
        Some(Held::new(self, self.analysis.get()?))
    }

    pub(super) fn parse(&self) -> Result<Pattern, Error> {
        Pattern::new(self.pattern.text(), self.flags)
    }

    pub(super) fn set_analysis(
        &self,
        form: Option<Form>,
        pattern: &mut Pattern,
    ) -> Result<Held<'_, Analysis>, AllocError> {
        let names = pattern.take_group_names();
        let identifiers = names.iter().map(|it| Ok(Atom::try_new(it.0)?.into()));
        let identifiers = identifiers.collect::<Result<_, AllocError>>()?;
        self.group_count.set(pattern.group_count());
        self.has_named_groups.set(!names.is_empty());
        let analysis = self.analysis.get_or_init(|| {
            Box::new(Analysis {
                form,
                identifiers,
                names,
                code: Code::default(),
            })
        });
        Ok(Held::new(self, analysis))
    }

    fn visit_children(&self, visitor: &mut Visitor) {
        visitor.report_extra_memory(self.code_size.load(Ordering::Relaxed) as usize);
    }

    fn estimated_size(&self, _: &Vm) -> usize {
        self.cell_size() + self.code_size.load(Ordering::Relaxed) as usize
    }
}
