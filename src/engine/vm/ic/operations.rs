//! The slow paths, for compiled code that has the operands in registers and has made its frame known. They take the
//! realm, the code block that has the entry, the entry and then, as far as there are such, the base, the key and one
//! more operand. Zero means that an exception is pending.

use bun_engine_bytecode::Unresolved;
use bun_engine_macros::native_abi;
use bun_engine_text::{PropertyName, names};

use super::{AccessCases, Key, LoadCache, StoreCache, StoreMode};
use crate::code::metadata::{ArrayAccess, GetPrivateName, GlobalAccess, PutPrivateName};
use crate::{CodeBlock, Cx, Gc, JsObject, JsResult, JsSymbol, Value, errors};

macro_rules! operations {
    ($(fn $name:ident$(<const $flag:ident: bool>)?(
        $cx:ident, $owner:ident, $entry:ident: $Entry:ty, $($operand:ident: $type:ty),*
    ) $body:block)*) => {$(
        #[native_abi]
        pub fn $name$(<const $flag: bool>)?(
            $cx: &mut Cx,
            $owner: &CodeBlock,
            $entry: &$Entry,
            $($operand: $type),*
        ) -> JsResult<Value> {
            debug_assert!($cx.global() == $owner.global());
            $body
        }
    )*};
}

fn done(result: JsResult<()>) -> JsResult<Value> {
    result.map(|()| Value::UNDEFINED)
}

#[inline(always)]
pub fn right_side_of_in(cx: &Cx, base: Value) -> JsResult<Gc<JsObject>> {
    (base.as_object()).ok_or_else(|| errors::throw_invalid_in_parameter(cx, base))
}

operations! {
    fn get_by_id(cx, owner, cache: LoadCache, base: Value, name: PropertyName<'_>) {
        cache.get_slow(cx, owner, base, name)
    }

    fn get_by_id_direct(cx, owner, cache: LoadCache, base: Value, name: PropertyName<'_>) {
        let object = base.to_object(cx)?;
        cache.get_own_slow(cx, owner, object, name)
    }

    fn get_length(cx, owner, cache: LoadCache, base: Value) {
        if let Some(string) = base.as_string() {
            Ok(string.len().into())
        } else if let Some(array) = base.as_exact_array() {
            Ok(array.length().into())
        } else {
            cache.get_slow(cx, owner, base, names::length)
        }
    }

    fn get_by_id_with_this(cx, owner, cases: AccessCases, base: Value, name: PropertyName<'_>, this: Value) {
        super::get_by_key(cx, owner, cases, base, Some(this), name, Key::Fixed)
    }

    fn get_by_val(cx, owner, entry: ArrayAccess, base: Value, key: Value) {
        super::get_by_value(cx, owner, entry, base, key)
    }

    fn get_by_val_with_this(cx, owner, entry: ArrayAccess, base: Value, key: Value, this: Value) {
        super::get_by_value_with_this(cx, owner, &entry.cases, base, this, key)
    }

    fn put_by_id<const IS_STRICT: bool>(cx, owner, cache: StoreCache, base: Value, name: PropertyName<'_>, value: Value) {
        done(cache.put_slow(cx, owner, base, name, value, StoreMode::Set { is_strict: IS_STRICT }))
    }

    fn put_by_id_direct(cx, owner, cache: StoreCache, base: Value, name: PropertyName<'_>, value: Value) {
        done(cache.put_slow(cx, owner, base, name, value, StoreMode::Define { is_strict: true }))
    }

    fn put_by_val<const IS_STRICT: bool>(cx, owner, entry: ArrayAccess, base: Value, key: Value, value: Value) {
        done(super::put_by_value(cx, owner, entry, base, key, value, StoreMode::Set { is_strict: IS_STRICT }))
    }

    fn put_by_val_direct(cx, owner, entry: ArrayAccess, base: Value, key: Value, value: Value) {
        done(super::put_by_value(cx, owner, entry, base, key, value, StoreMode::Define { is_strict: true }))
    }

    fn in_by_id(cx, owner, cases: AccessCases, base: Value, name: PropertyName<'_>) {
        let object = right_side_of_in(cx, base)?;
        super::has_by_key(cx, owner, cases, object, name, Key::Fixed).map(Into::into)
    }

    fn in_by_val(cx, owner, entry: ArrayAccess, base: Value, key: Value) {
        let object = right_side_of_in(cx, base)?;
        super::has_by_value(cx, owner, entry, object, key).map(Into::into)
    }

    fn delete_by_id<const IS_STRICT: bool>(cx, owner, cases: AccessCases, base: Value, name: PropertyName<'_>) {
        let object = base.to_object(cx)?;
        super::delete_by_key(cx, owner, cases, object, name, Key::Fixed, IS_STRICT).map(Into::into)
    }

    fn delete_by_val<const IS_STRICT: bool>(cx, owner, cases: AccessCases, base: Value, key: Value) {
        let object = base.to_object(cx)?;
        super::delete_by_value(cx, owner, cases, object, key, IS_STRICT).map(Into::into)
    }

    fn instance_of(cx, owner, cases: AccessCases, value: Value, prototype: Value) {
        super::instance_of(cx, owner, cases, value, prototype).map(Into::into)
    }

    fn get_global<const THROWS: bool>(cx, owner, access: GlobalAccess, name: PropertyName<'_>) {
        access.get_slow(cx, owner, name, if THROWS { Unresolved::Throw } else { Unresolved::Undefined })
    }

    fn get_private_name(cx, owner, entry: GetPrivateName, base: Value, name: Gc<JsSymbol>) {
        entry.get_slow(cx, owner, base, name)
    }

    fn put_private_name(cx, owner, entry: PutPrivateName, base: Value, name: Gc<JsSymbol>, value: Value) {
        done(entry.set_slow(cx, owner, base, name, value))
    }

    fn define_private_name(cx, owner, entry: PutPrivateName, base: Value, name: Gc<JsSymbol>, value: Value) {
        done(entry.define_slow(cx, owner, base.cast(), name, value))
    }

    fn set_private_brand(cx, owner, entry: PutPrivateName, base: Value, brand: Gc<JsSymbol>) {
        done(entry.set_brand_slow(cx, owner, base.cast(), brand))
    }

    fn check_private_brand(cx, owner, entry: PutPrivateName, base: Value, brand: Gc<JsSymbol>) {
        done(entry.check_brand_slow(cx, owner, base, brand))
    }

    fn has_private_name(cx, owner, cases: AccessCases, base: Value, name: Gc<JsSymbol>) {
        let object = right_side_of_in(cx, base)?;
        super::has_by_key(cx, owner, cases, object, name.anchor().name(), Key::Variable).map(Into::into)
    }
}
