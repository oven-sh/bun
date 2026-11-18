use bun_engine_asm::abi;
use bun_engine_date::DateFields;
use bun_engine_text::Text;

use super::{Gives, Kind, Operand, Outcome};
use crate::{
    Cx, DateInstance, Gc, GlobalObject, RealmSlot, RealmWatchpoint, SpeculatedType as T, Vm,
};

/// What goes in the first argument register.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Context {
    /// The first operand.
    None,
    Vm,
    /// The global object of the realm of the callee.
    Realm,
}

/// Neither runs a script.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Reach {
    /// Does not allocate in the heap, throw or look at the stack.
    Leaf,
    /// May collect and invalidate code, so the frame and the call site have to be known. No object that exists changes
    /// its shape, unless it throws.
    Allocates,
}

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Throws {
    Never,
    /// Of memory or stack, or to end execution. A call whose result is not used need not be made for that.
    ForLackOfRoom,
    Errors,
}

bitflags::bitflags! {
    /// What can make two calls with the same operands differ.
    #[derive(Clone, Copy, PartialEq, Eq, Debug)]
    pub struct State: u16 {
        /// Which shape an object has.
        const SHAPE = 1 << 0;
        /// The first slot of RegExp objects, which is also reached as the property `lastIndex`.
        const LAST_INDEX = 1 << 1;
        /// Which `RegExp` an object has.
        const PATTERN = 1 << 2;
        /// The `RegExpGlobalState` of the realm.
        const LAST_MATCH = 1 << 3;
        /// The time values of dates. To fill in their cached fields is no write.
        const DATE = 1 << 4;
        const TIME_ZONE = 1 << 5;
        const CLOCK = 1 << 6;
        const RANDOM = 1 << 7;
        const LOCALE = 1 << 8;
        /// The fields of iterators over strings and matches.
        const ITERATOR = 1 << 9;
        /// Whether any object has left a shape. Only new ones do, but that fires watchpoints.
        const TRANSITIONS = 1 << 10;
    }
}

/// One way to call a built-in with operands of known types.
pub struct DirectForm {
    pub context: Context,
    pub reach: Reach,
    pub takes_this: bool,
    /// `this` first if it is taken, then the arguments. Those that are passed take the argument registers in order.
    pub operands: &'static [Operand],
    pub gives: Gives,
    pub throws: Throws,
    /// With what the kinds of the operands depend on, and with `writes`, since a write may not happen.
    pub reads: State,
    pub writes: State,
    /// May put a rope together. The fiber of a string that is no rope stays.
    pub resolves_ropes: bool,
    /// If it gives an object or a symbol, that is a new one. It may have been through a collection.
    pub is_distinct: bool,
    /// Of the realm of the callee.
    pub needs: &'static [RealmWatchpoint],
    makes: &'static [RealmSlot],
    entry: *const (),
}

// SAFETY: the pointer is to code.
unsafe impl Sync for DirectForm {}

pub(super) const MAX_INTEGERS: usize = 6;
pub(super) const MAX_DOUBLES: usize = 8;

const _: () = {
    assert!(MAX_INTEGERS <= abi::ARGUMENT_GPRS.len() && MAX_DOUBLES <= abi::ARGUMENT_FPRS.len());
};

/// What `#[direct_form]` reads from the text of a function.
pub(super) struct Declaration {
    pub(super) takes_this: bool,
    pub(super) operands: &'static [Operand],
    pub(super) reads: State,
    pub(super) writes: State,
    pub(super) needs: &'static [RealmWatchpoint],
    pub(super) makes: &'static [RealmSlot],
    pub(super) only_lacks_room: bool,
    pub(super) gives_new: bool,
    pub(super) gives_the_same: bool,
    pub(super) entry: *const (),
}

impl DirectForm {
    pub(super) const fn new<C: FirstParameter, R: Outcome>(declared: &Declaration) -> DirectForm {
        let is_leaf = matches!(C::REACH, Reach::Leaf);
        let (mut integers, mut doubles) = (!matches!(C::CONTEXT, Context::None) as usize, 0);
        let (mut reads, mut takes_ropes) = (declared.reads.union(declared.writes), false);
        let mut index = 0;
        while index < declared.operands.len() {
            let Operand { kind, is_passed } = declared.operands[index];
            doubles += (is_passed && kind.is_double()) as usize;
            integers += (is_passed && !kind.is_double()) as usize;
            reads = reads.union(kind.reads());
            takes_ropes |= kind.can_lead_to_rope();
            assert!(is_leaf || !matches!(kind, Kind::Characters));
            index += 1;
        }
        assert!(integers <= MAX_INTEGERS && doubles <= MAX_DOUBLES);
        assert!(R::GIVES.needs_call() != declared.entry.is_null());
        assert!(R::THROWS || !declared.only_lacks_room);
        assert!(declared.needs.is_empty() || !reads.is_empty());
        assert!(!is_leaf || (!R::THROWS && !declared.gives_new && declared.makes.is_empty()));
        let has_identity = matches!(R::GIVES, Gives::Value { types, .. } if types.intersects(T::OBJECT.union(T::SYMBOL)));
        assert!(declared.gives_new as u8 + declared.gives_the_same as u8 == has_identity as u8);
        DirectForm {
            context: C::CONTEXT,
            reach: C::REACH,
            takes_this: declared.takes_this,
            operands: declared.operands,
            gives: R::GIVES,
            throws: match (R::THROWS, declared.only_lacks_room) {
                (false, _) => Throws::Never,
                (true, true) => Throws::ForLackOfRoom,
                (true, false) => Throws::Errors,
            },
            reads,
            writes: declared.writes,
            resolves_ropes: takes_ropes && !is_leaf,
            is_distinct: declared.gives_new,
            needs: declared.needs,
            makes: declared.makes,
            entry: declared.entry,
        }
    }

    /// The address to call. Zero unless `gives.needs_call()`.
    pub fn entry(&self) -> usize {
        self.entry.addr()
    }

    /// Without `this`.
    pub fn arguments(&self) -> &'static [Operand] {
        &self.operands[usize::from(self.takes_this)..]
    }

    /// The result depends on nothing but the operands, and making it is all that happens.
    pub fn is_pure(&self) -> bool {
        self.reads.is_empty() && !self.is_distinct
    }

    /// Of the result, in the representation that `gives` names.
    pub fn result_types(&self) -> T {
        match self.gives {
            Gives::Value {
                types,
                or_first_operand,
                ..
            } if or_first_operand => types | self.operands[0].kind.types(),
            Gives::Value { types, .. } | Gives::Double(types) => types,
            Gives::Int32 { .. } => T::INT32,
            Gives::Boolean => T::BOOLEAN,
            Gives::Operand(index) => match self.operands[usize::from(index)].kind {
                Kind::Integer { .. } => T::INT32,
                kind if kind.is_double() => T::FULL_DOUBLE,
                kind => kind.types(),
            },
            Gives::Constant(bits) => T::of_immediate(bits).unwrap_or(T::HEAP_TOP),
        }
    }

    /// Whether it makes no difference which realm the callee is from.
    pub fn suits_any_realm(&self) -> bool {
        self.context != Context::Realm
            && self.needs.is_empty()
            && (self.operands.iter()).all(|it| it.kind.original_shape().is_none())
    }

    /// The parts of the realm that it uses and that are made when they are first asked for.
    pub(super) fn slots(&self) -> impl Iterator<Item = RealmSlot> {
        let shape = |operand: &Operand| Kind::original_shape(operand.kind);
        (self.makes.iter().copied()).chain(self.operands.iter().filter_map(shape))
    }

    /// Before code that calls it is made, because this can change objects of the library. False if it cannot be used.
    pub fn prepare(&self, vm: &Vm, global: &GlobalObject) -> bool {
        for slot in self.slots() {
            global.slot(vm, slot);
        }
        self.needs.iter().all(|&which| global.holds(vm, which))
    }
}

/// A `Vm` of which only the parts that do not allocate in the heap can be had.
#[derive(Clone, Copy)]
#[repr(transparent)]
pub struct Quiet<'a>(&'a Vm);

impl<'a> From<&'a Vm> for Quiet<'a> {
    #[inline(always)]
    fn from(vm: &'a Vm) -> Quiet<'a> {
        Quiet(vm)
    }
}

impl Quiet<'_> {
    #[inline(always)]
    pub(super) fn local_fields(self, date: &DateInstance) -> Option<DateFields> {
        date.local_fields(self.0)
    }

    #[inline(always)]
    pub(super) fn utc_fields(self, date: &DateInstance) -> Option<DateFields> {
        date.utc_fields(self.0)
    }

    #[inline(always)]
    pub(super) fn utc(self, local_time: f64) -> f64 {
        self.0.date_cache().utc(local_time)
    }

    #[inline(always)]
    pub(super) fn parse_date(self, text: Text<'_>) -> f64 {
        self.0.date_cache().parse(text)
    }
}

pub(super) trait FirstParameter {
    const CONTEXT: Context;
    const REACH: Reach;

    #[cfg(debug_assertions)]
    fn address(&self) -> usize;
}

macro_rules! first_parameters {
    ($($type:ty: $context:ident, $reach:ident, |$it:pat_param| $address:expr;)*) => {$(
        impl FirstParameter for $type {
            const CONTEXT: Context = Context::$context;
            const REACH: Reach = Reach::$reach;

            #[cfg(debug_assertions)]
            fn address(&self) -> usize {
                let $it = self;
                $address
            }
        }
    )*};
}

first_parameters! {
    (): None, Leaf, |_| 0;
    Quiet<'_>: Vm, Leaf, |vm| core::ptr::from_ref(vm.0).expose_provenance();
    Gc<GlobalObject>: Realm, Leaf, |global| Gc::address(*global);
    &Vm: Vm, Allocates, |vm| core::ptr::from_ref(*vm).expose_provenance();
    &Cx: Realm, Allocates, |cx| cx.global().address();
}
