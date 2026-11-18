//! Where the steps of each kind of access start.

use core::mem::offset_of;

use bun_engine_asm::prelude::*;
use bun_engine_exec_memory::NativeFrames;
use bun_engine_vm::caches::StoreEntry;
use bun_engine_vm::code::metadata::{ArrayAccess, GetPrivateName, PutPrivateName};
use bun_engine_vm::ic::{
    AccessKind, BOOLEAN_SHAPE, InlineCase, InlineKey, Key, LoadCache, LookupEpoch, NUMBER_SHAPE,
    StoreCache, operations,
};
use bun_engine_vm::{CellType, CellTypeRange, JsSymbol, MappedArguments, Shape, TypeFlags, Vm};

use super::abi::*;
use super::search::EPOCH;
use super::{Emitter, load_array_length};
use crate::emit::{Emit, FALSE, at, shape_id};
use crate::registers::VM;

const fn inline_case(field: usize) -> Address {
    at(ENTRY, field)
}

const _: () = assert!(LoadCache::OFFSET_OF_INLINE == 0 && StoreCache::OFFSET_OF_INLINE == 0);

/// Of an access.
#[derive(Clone, Copy)]
pub struct Steps<T> {
    pub first: T,
    pub second: T,
}

macro_rules! entries {
    ($($(#[$doc:meta])* $name:ident,)*) => {
        pub struct Entries<T> {
            $($(#[$doc])* pub $name: Steps<T>,)*
            /// By kind: a first step of `get_by_id`, for where the first case is likely to be of it.
            pub load_first_case: [Option<T>; AccessKind::ALL.len()],
            /// First steps of `get_by_val`, `put_by_val`, `put_by_val_direct` and `in_by_val`, for where the key is likely
            /// to be an index.
            pub by_index: [T; 4],
            /// First steps of `get_by_id`, `put_by_id` and `put_by_id_direct`, for where the site is likely to be megamorphic.
            pub megamorphic: [T; 3],
        }

        impl<T> Entries<T> {
            pub(crate) fn map<U>(self, mut map: impl FnMut(T) -> U) -> Entries<U> {
                Entries {
                    $($name: Steps { first: map(self.$name.first), second: map(self.$name.second) },)*
                    load_first_case: self.load_first_case.map(|it| it.map(&mut map)),
                    by_index: self.by_index.map(&mut map),
                    megamorphic: self.megamorphic.map(map),
                }
            }
        }
    };
}

entries! {
    /// From a `LoadCache`. The first step does without the key.
    get_by_id,
    get_by_id_direct,
    get_length,
    /// From a `StoreCache`.
    put_by_id,
    put_by_id_strict,
    put_by_id_direct,
    /// From `AccessCases`.
    get_by_id_with_this,
    in_by_id,
    delete_by_id,
    delete_by_id_strict,
    delete_by_val,
    delete_by_val_strict,
    has_private_name,
    /// With the prototype for the key.
    instance_of,
    /// From an `ArrayAccess`.
    get_by_val,
    get_by_val_with_this,
    put_by_val,
    put_by_val_strict,
    put_by_val_direct,
    in_by_val,
    /// From the entry in the metadata.
    get_private_name,
    put_private_name,
    define_private_name,
    set_private_brand,
    check_private_brand,
}

/// What comes before the call of the case.
#[derive(Clone, Copy, PartialEq, Eq)]
enum Receiver {
    IsBase,
    IsInPlace,
}

#[derive(Clone, Copy, PartialEq, Eq)]
pub(super) enum Store {
    Set,
    Define,
}

macro_rules! address {
    ($operation:ident $(::<$flag:literal>)?) => {
        (stringify!($operation), operations::$operation $(::<$flag>)? as *const () as usize)
    };
}

impl Entries<Label> {
    /// With a name for each routine.
    pub(crate) fn emit(
        m: &mut MacroAssembler,
        frames: &mut NativeFrames,
        write_barrier: Label,
    ) -> (Entries<Label>, Vec<(Label, &'static str)>) {
        let (miss, defer) = (m.here(), m.new_label());
        m.move32(CASE, 0);
        m.bind(defer);
        m.move32(RESULT, 0);
        m.ret();
        let mut e = Emitter {
            m,
            frames,
            miss,
            defer,
            write_barrier,
            names: vec![(miss, "miss")],
        };
        let by_kind = e.routine("by_kind", Emitter::by_kind);
        let renew = e.routine("renew", |e| e.miss_if_out_of_date(by_kind));
        let operation = e.routine("call_operation", Emitter::call_operation);
        let call_case = e.routine("call_case", |e| e.call_case(operation));

        let get_by_id = e.routine("load", |e| {
            e.load(renew, |e| e.load_megamorphic(Key::Fixed, miss));
        });
        let load_own = e.routine("load_own", |e| {
            e.load(renew, |e| e.load_own_megamorphic(Key::Fixed));
        });
        let get_length = e.routine("load_length", |e| e.load_length(get_by_id));
        let load_first_case = AccessKind::ALL.map(|kind| {
            let otherwise = match kind {
                AccessKind::TypedArrayByteLength
                | AccessKind::TypedArrayByteOffset
                | AccessKind::DataViewByteLength
                | AccessKind::ResizableTypedArrayByteLength
                | AccessKind::ResizableTypedArrayByteOffset
                | AccessKind::CollectionSize
                | AccessKind::RegExpFlag
                | AccessKind::LoadModuleBinding
                | AccessKind::ThroughGlobalProxy => get_by_id,
                _ => return None,
            };
            Some(e.routine("load_first_case", |e| {
                e.check_first_case(at(ENTRY, LoadCache::OFFSET_OF_CASES), kind, otherwise);
                e.handle(kind);
            }))
        });
        let load_with_this = e.routine("load_with_this", |e| {
            e.load_shape_of_cell();
            e.load_from(at(ENTRY, 0), Key::Fixed, miss, by_kind);
        });
        let load_megamorphic = e.routine("load_megamorphic", |e| {
            e.load_hash(LoadCache::OFFSET_OF_CASES, get_by_id);
            e.m.load64(KEY, inline_case(InlineCase::OFFSET_OF_OPERAND));
            e.load_megamorphic(Key::Fixed, miss);
        });
        let mut by_index = [miss; 4];
        let load_by_value = e.routine("load_by_value", |e| by_index[0] = e.load_by_value(by_kind));
        let load_by_value_with_this = e.routine("load_by_value_with_this", |e| {
            let proxy = e.m.new_label();
            let cases = at(ENTRY, offset_of!(ArrayAccess, cases));
            e.load_shape_of_cell();
            e.load_name(proxy);
            e.load_from(cases, Key::Variable, proxy, by_kind);
            e.m.bind(proxy);
            e.find_case_for_proxy(cases);
        });
        let store = e.routine("store", |e| e.store(Store::Set, renew));
        let define = e.routine("define", |e| e.store(Store::Define, renew));
        let [store_megamorphic, define_megamorphic] =
            [(Store::Set, store), (Store::Define, define)].map(|(mode, otherwise)| {
                e.routine("store_megamorphic", |e| {
                    e.load_hash(StoreCache::OFFSET_OF_CASES, otherwise);
                    e.store_megamorphic_as(mode, Key::Fixed, miss);
                })
            });
        let store_by_value = e.routine("store_by_value", |e| {
            by_index[1] = e.store_by_value(Store::Set, by_kind);
        });
        let define_by_value = e.routine("define_by_value", |e| {
            by_index[2] = e.store_by_value(Store::Define, by_kind);
        });
        let has = e.routine("has", |e| {
            e.load_shape_of_cell();
            e.has_from(at(ENTRY, 0), Key::Fixed, miss, by_kind);
        });
        let has_by_value = e.routine("has_by_value", |e| by_index[3] = e.has_by_value(by_kind));
        let delete = e.routine("delete", |e| {
            e.load_shape_of_cell();
            e.load_list(at(ENTRY, 0), miss);
            e.search_and_answer(Key::Fixed, miss, by_kind);
        });
        let delete_by_value = e.routine("delete_by_value", |e| e.delete_by_value(by_kind));
        let instance_of = e.routine("find_prototype", Emitter::instance_of);

        let load_private = e.routine("load_private", |e| {
            let cases = offset_of!(GetPrivateName, cache) + LoadCache::OFFSET_OF_CASES;
            let no_list = e.load_private_cases(cases);
            e.search_and_load(Key::Variable, miss, miss);
            e.megamorphic_only(no_list);
            e.load_own_megamorphic(Key::Variable);
        });
        let cases_for_store = offset_of!(PutPrivateName, cache) + StoreCache::OFFSET_OF_CASES;
        let [store_private, define_private] = [Store::Set, Store::Define].map(|mode| {
            e.routine("store_private", |e| {
                let no_list = e.load_private_cases(cases_for_store);
                e.search_and_store(Key::Variable, miss, by_kind);
                e.megamorphic_only(no_list);
                e.store_megamorphic_as(mode, Key::Variable, miss);
            })
        });
        let has_private = e.routine("has_private", |e| {
            let no_list = e.load_private_cases(0);
            e.search_and_answer(Key::Variable, miss, miss);
            e.megamorphic_only(no_list);
            e.has_megamorphic(Key::Variable, miss);
        });
        let check_private = e.routine("check_private", |e| {
            let no_list = e.load_private_cases(cases_for_store);
            e.search_and_answer(Key::Variable, miss, miss);
            e.megamorphic_only(no_list);
            e.load_own_megamorphic(Key::Variable);
        });

        let mut calling = |first, (name, function): (_, usize), key, receiver| Steps {
            first,
            second: e.routine(name, |e| {
                e.m.move64(OPERATION, function);
                if key == Key::Fixed {
                    e.m.move64(NAME, KEY);
                }
                if receiver == Receiver::IsBase {
                    e.m.move64(VALUE, BASE);
                }
                e.m.jump(call_case);
            }),
        };
        use Key::{Fixed, Variable};
        use Receiver::{IsBase, IsInPlace};
        let with_calls = [
            calling(get_by_id, address!(get_by_id), Fixed, IsBase),
            calling(load_own, address!(get_by_id_direct), Fixed, IsBase),
            calling(get_length, address!(get_length), Fixed, IsBase),
            calling(
                load_with_this,
                address!(get_by_id_with_this),
                Fixed,
                IsInPlace,
            ),
            calling(load_by_value, address!(get_by_val), Variable, IsBase),
            calling(
                load_by_value_with_this,
                address!(get_by_val_with_this),
                Variable,
                IsInPlace,
            ),
            calling(store, address!(put_by_id::<false>), Fixed, IsInPlace),
            calling(store, address!(put_by_id::<true>), Fixed, IsInPlace),
            calling(
                store_by_value,
                address!(put_by_val::<false>),
                Variable,
                IsInPlace,
            ),
            calling(
                store_by_value,
                address!(put_by_val::<true>),
                Variable,
                IsInPlace,
            ),
            calling(has, address!(in_by_id), Fixed, IsInPlace),
            calling(has_by_value, address!(in_by_val), Variable, IsInPlace),
        ];
        let mut plain = |first, (name, function): (_, usize)| Steps {
            first,
            second: e.routine(name, |e| {
                e.m.move64(OPERATION, function);
                e.m.jump(operation);
            }),
        };
        let [
            get_by_id,
            get_by_id_direct,
            get_length,
            get_by_id_with_this,
            get_by_val,
            get_by_val_with_this,
            put_by_id,
            put_by_id_strict,
            put_by_val,
            put_by_val_strict,
            in_by_id,
            in_by_val,
        ] = with_calls;
        let entries = Entries {
            load_first_case,
            by_index,
            megamorphic: [load_megamorphic, store_megamorphic, define_megamorphic],
            get_by_id,
            get_by_id_direct,
            get_length,
            get_by_id_with_this,
            get_by_val,
            get_by_val_with_this,
            put_by_id,
            put_by_id_strict,
            put_by_val,
            put_by_val_strict,
            in_by_id,
            in_by_val,
            put_by_id_direct: plain(define, address!(put_by_id_direct)),
            put_by_val_direct: plain(define_by_value, address!(put_by_val_direct)),
            delete_by_id: plain(delete, address!(delete_by_id::<false>)),
            delete_by_id_strict: plain(delete, address!(delete_by_id::<true>)),
            delete_by_val: plain(delete_by_value, address!(delete_by_val::<false>)),
            delete_by_val_strict: plain(delete_by_value, address!(delete_by_val::<true>)),
            has_private_name: plain(has_private, address!(has_private_name)),
            instance_of: plain(instance_of, address!(instance_of)),
            get_private_name: plain(load_private, address!(get_private_name)),
            put_private_name: plain(store_private, address!(put_private_name)),
            define_private_name: plain(define_private, address!(define_private_name)),
            set_private_brand: plain(define_private, address!(set_private_brand)),
            check_private_brand: plain(check_private, address!(check_private_brand)),
        };
        (entries, e.names)
    }
}

impl Emitter<'_> {
    /// And the shape.
    fn load_hash(&mut self, cases: usize, otherwise: Label) {
        self.m.load64(CASE, at(ENTRY, cases));
        self.branch_unless_megamorphic(otherwise);
        self.m.branch_if_not_cell(BASE, otherwise);
        self.m.load32(SHAPE, shape_id(BASE));
    }

    fn megamorphic_only(&mut self, no_list: Label) {
        self.m.bind(no_list);
        self.branch_unless_megamorphic(self.miss);
    }

    pub(super) fn load_from(&mut self, cases: Address, key: Key, none: Label, by_kind: Label) {
        let no_list = self.m.new_label();
        self.load_list(cases, no_list);
        if key == Key::Variable {
            self.count_turn();
        }
        self.search_and_load(key, none, by_kind);
        self.megamorphic_only(no_list);
        self.load_megamorphic(key, none);
    }

    pub(super) fn has_from(&mut self, cases: Address, key: Key, none: Label, by_kind: Label) {
        let no_list = self.m.new_label();
        self.load_list(cases, no_list);
        if key == Key::Variable {
            self.count_turn();
        }
        self.search_and_answer(key, none, by_kind);
        self.megamorphic_only(no_list);
        self.has_megamorphic(key, none);
    }

    pub(super) fn store_megamorphic_as(&mut self, mode: Store, key: Key, none: Label) {
        if mode == Store::Define {
            self.m.xor32(SHAPE, SHAPE, StoreEntry::DEFINES);
        }
        self.store_megamorphic(key, none);
    }

    /// Returns where to go on if they are no list.
    fn load_private_cases(&mut self, offset: usize) -> Label {
        let no_list = self.m.new_label();
        self.load_shape_of_cell();
        self.m.load64(NAME, at(KEY, JsSymbol::OFFSET_OF_NAME));
        self.load_list(at(ENTRY, offset), no_list);
        no_list
    }

    /// Goes on if the inline case is for the shape, with its kind in `RESULT`.
    fn check_inline_shape(&mut self, key: Address) {
        self.m.xor32(RESULT, SHAPE, key);
        (self.m).branch32(Cond::Above, RESULT, InlineKey::TAG_MASK, self.miss);
    }

    /// The slow path renews the inline case, which would have applied.
    fn miss_if_out_of_date(&mut self, otherwise: Label) {
        let (key, first_checked) = (InlineCase::OFFSET_OF_KEY, InlineKey::FIRST_CHECKED_TAG);
        self.m.xor32(RESULT, SHAPE, inline_case(key));
        self.m.sub32(RESULT, RESULT, first_checked);
        let last = InlineKey::TAG_MASK - first_checked;
        self.m.branch32(Cond::Above, RESULT, last, otherwise);
        let to_record = Vm::OFFSET_OF_LOOKUP_EPOCH + LookupEpoch::OFFSET_OF_TO_RECORD;
        self.m.load32(RESULT, at(VM, to_record));
        let epoch = inline_case(key + size_of::<u32>());
        self.m.branch32(Cond::Eq, RESULT, epoch, otherwise);
        self.m.jump(self.miss);
    }

    fn miss_unless_current(&mut self, key: Address) {
        self.m.load32(NAME, EPOCH);
        let epoch = key.plus(size_of::<u32>() as i32);
        self.m.branch32(Cond::Ne, NAME, epoch, self.miss);
    }

    fn load(&mut self, by_kind: Label, megamorphic: impl FnOnce(&mut Self)) {
        let [primitive, has_shape, no_list, inline, checked] = self.labels();
        self.m.branch_if_not_cell(BASE, primitive);
        self.m.load32(SHAPE, shape_id(BASE));
        self.m.bind(has_shape);
        self.load_list(at(ENTRY, LoadCache::OFFSET_OF_CASES), no_list);
        self.count_turn();
        self.search_and_load(Key::Fixed, self.miss, by_kind);

        self.m.bind(no_list);
        self.branch_unless_megamorphic(inline);
        self.m
            .load64(KEY, inline_case(InlineCase::OFFSET_OF_OPERAND));
        megamorphic(self);

        self.m.bind(inline);
        self.check_inline_shape(inline_case(InlineCase::OFFSET_OF_KEY));
        let first_checked = InlineKey::FIRST_CHECKED_TAG;
        self.m
            .branch32(Cond::AboveEq, RESULT, first_checked, checked);
        (self.m).load32_signed64(SHAPE, inline_case(InlineCase::OFFSET_OF_LOADED_SLOT));
        self.m.slot_base(RESULT, BASE, SHAPE);
        (self.m).load64(RESULT, Address::indexed(RESULT, SHAPE, Scale::One, 0));
        self.m.move32(CASE, 0);
        self.m.ret();
        self.m.bind(checked);
        self.miss_unless_current(inline_case(InlineCase::OFFSET_OF_KEY));
        self.m
            .load64(RESULT, inline_case(InlineCase::OFFSET_OF_OPERAND));
        self.m.ret();

        self.m.bind(primitive);
        self.m.move32(SHAPE, NUMBER_SHAPE.bits());
        self.m.branch_if_number(BASE, has_shape);
        self.m.move32(SHAPE, BOOLEAN_SHAPE.bits());
        self.m.branch_if_boolean(BASE, RESULT, has_shape);
        self.m.jump(self.miss);
    }

    /// The base is a cell.
    fn load_length(&mut self, as_property: Label) {
        let [no_array, no_string, found] = self.labels();
        let m = &mut *self.m;
        load_array_length(m, no_array);
        m.bind(found);
        m.box_int32(RESULT, RESULT);
        m.ret();
        m.bind(no_array);
        m.branch_if_not_type(BASE, CellType::String, no_string);
        m.load_string_length(RESULT, BASE);
        m.jump(found);
        m.bind(no_string);
        let mapped = CellTypeRange::new(CellType::DirectArguments, CellType::ScopedArguments);
        m.branch_unless_type_in(BASE, mapped, RESULT, as_property);
        m.branch_if_flag(BASE, TypeFlags::PER_CELL_BIT, as_property);
        m.load32(RESULT, at(BASE, MappedArguments::OFFSET_OF_LENGTH));
        m.jump(found);
    }

    fn store(&mut self, mode: Store, by_kind: Label) {
        let [no_list, inline, store] = self.labels();
        self.load_shape_of_cell();
        self.load_list(at(ENTRY, StoreCache::OFFSET_OF_CASES), no_list);
        self.count_turn();
        self.search_and_store(Key::Fixed, self.miss, by_kind);

        self.m.bind(no_list);
        self.branch_unless_megamorphic(inline);
        self.store_megamorphic_as(mode, Key::Fixed, self.miss);

        self.m.bind(inline);
        self.check_inline_shape(inline_case(InlineCase::OFFSET_OF_KEY));
        let first_checked = InlineKey::FIRST_CHECKED_TAG;
        self.m.branch32(Cond::Below, RESULT, first_checked, store);
        self.miss_unless_current(inline_case(InlineCase::OFFSET_OF_KEY));
        self.m
            .load32(SHAPE, inline_case(InlineCase::OFFSET_OF_NEW_SHAPE));
        self.m.bind(store);
        (self.m).load32_signed64(NAME, inline_case(InlineCase::OFFSET_OF_STORED_SLOT));
        self.m.slot_base(RESULT, BASE, NAME);
        (self.m).store64(Address::indexed(RESULT, NAME, Scale::One, 0), VALUE);
        self.m.store32(shape_id(BASE), SHAPE);
        self.return_from_store();
    }

    /// The base is an object.
    fn instance_of(&mut self) {
        let [no_list, done] = self.labels();
        self.m.branch_if_not_cell(KEY, self.miss);
        self.m.load32(SHAPE, shape_id(BASE));
        self.m.move64(NAME, KEY);
        self.load_list(at(ENTRY, 0), no_list);
        self.search_and_answer(Key::Variable, self.miss, self.miss);
        self.megamorphic_only(no_list);
        let (m, miss) = (&mut *self.m, self.miss);
        m.branch_if_cell_is_no_object(KEY, miss);
        m.move64(RESULT, BASE);
        let next = m.here();
        m.branch_if_flag(RESULT, TypeFlags::OVERRIDES_GET_PROTOTYPE, miss);
        m.load32(RESULT, shape_id(RESULT));
        m.decode_shape(RESULT, RESULT);
        m.load64(RESULT, at(RESULT, Shape::OFFSET_OF_PROTOTYPE));
        m.branch64(Cond::Eq, RESULT, KEY, done);
        m.branch_if_cell(RESULT, next);
        m.bind(done);
        m.compare64(Cond::Eq, RESULT, RESULT, KEY);
        m.or32(RESULT, RESULT, FALSE);
        m.ret();
    }
}
