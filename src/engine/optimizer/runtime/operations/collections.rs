//! For maps and sets. Those that add an entry return zero if they have done nothing.

use bun_engine_macros::native_abi;
use bun_engine_text::StringImpl;
use bun_engine_vm::{
    Cx, Gc, HashedKey, JsMap, JsResult, JsSet, JsWeakMap, JsWeakSet, Value, can_be_held_weakly,
};

use super::{Address, Operation, Returned};

fn is_done(cx: &Cx, result: JsResult<()>) -> u32 {
    (result
        .map_err(|it| cx.discard_unless_termination(it))
        .is_ok())
    .into()
}

operations! {
    // In the lower half, and something in the upper.
    HASH_KEY: fn hash_key(cx: &Cx, key: Value) -> usize {
        let hashed = HashedKey::new(cx, key).map_err(|it| cx.discard_unless_termination(it));
        hashed.map_or(0, |it| 1 << u32::BITS | it.hash() as usize)
    }
    MAP_SET: fn map_set(cx: &Cx, map: Gc<JsMap>, key: Value, hash: u32, value: Value) -> u32 {
        is_done(cx, map.set_hashed(cx, HashedKey::from_parts(key, hash), value))
    }
    SET_ADD: fn set_add(cx: &Cx, set: Gc<JsSet>, key: Value, hash: u32) -> u32 {
        is_done(cx, set.add_hashed(cx, HashedKey::from_parts(key, hash)))
    }
    MAP_DELETE: fn map_delete(cx: &Cx, map: Gc<JsMap>, key: Value, hash: u32) -> u32 {
        map.remove_hashed(cx, HashedKey::from_parts(key, hash)).into()
    }
    SET_DELETE: fn set_delete(cx: &Cx, set: Gc<JsSet>, key: Value, hash: u32) -> u32 {
        set.remove_hashed(cx, HashedKey::from_parts(key, hash)).into()
    }
    WEAK_MAP_SET: fn weak_map_set(_cx: &Cx, map: Gc<JsWeakMap>, key: Value, value: Value) -> u32 {
        (can_be_held_weakly(key) && map.set(key.cast(), value).is_ok()).into()
    }
    WEAK_SET_ADD: fn weak_set_add(_cx: &Cx, set: Gc<JsWeakSet>, key: Value) -> u32 {
        (can_be_held_weakly(key) && set.add(key.cast()).is_ok()).into()
    }
}

leaves! {
    COMPUTE_HASH: fn compute_hash(string: &StringImpl) -> u32 {
        string.hash()
    }
    ARE_ALIKE: fn are_alike(key: Value, stored: Option<Value>) -> u32 {
        HashedKey::have_same_content(key, stored).into()
    }
}
