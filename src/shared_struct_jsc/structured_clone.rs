//! Structured clone, `postMessage` and Worker messaging for SharedStruct, SharedArray, Mutex and Condition.
//!
//! They pass by reference: the receiver gets a new view over the same `Arc`, with nothing copied. This follows `BlockList`
//! (src/runtime/node/net/BlockList.rs). Serializing registers a strong count under a nonce and writes the nonce; the
//! `SerializedScriptValue` remembers the nonce and calls [`Bun__SharedRef__onStructuredCloneDestroy`] when it is dropped, which
//! releases the count. Deserializing may run many times for one value (BroadcastChannel), once for each receiver.
//!
//! The C++ side (src/jsc/bindings/webcore/SerializedScriptValue.cpp) chooses the tag from [`Bun__SharedRef__kind`]. The
//! payload is the same for all four tags, so one deserialize hook serves them all.

use bun_io::Write as _;
use bun_jsc::{CloneSerializer, JSGlobalObject, JSValue, to_js_host_call};
use bun_shared_struct::Value;
use bun_threading::Guarded;

use crate::registry::Registry;
use crate::shared_struct_classes::{shared_of, to_js};

/// Entries whose `SerializedScriptValue` is still alive.
static SERIALIZED_REFS: Guarded<Registry<Value>> = Guarded::new(Registry::new());

/// What [`Bun__SharedRef__kind`] returns. C++ maps each to its own `SerializationTag`; keep in step with
/// `SharedRefKind` in SerializedScriptValue.cpp.
const KIND_NONE: u8 = 0;
const KIND_STRUCT: u8 = 1;
const KIND_ARRAY: u8 = 2;
const KIND_MUTEX: u8 = 3;
const KIND_CONDITION: u8 = 4;

fn kind_of(value: &Value) -> u8 {
    match value {
        Value::Struct(block) if block.shape().is_some() => KIND_STRUCT,
        Value::Struct(_) => KIND_ARRAY,
        Value::Mutex(_) => KIND_MUTEX,
        Value::Condition(_) => KIND_CONDITION,
        _ => KIND_NONE,
    }
}

/// Which of the four shared objects `value` is, or zero for any other value.
#[unsafe(no_mangle)]
pub extern "C" fn Bun__SharedRef__kind(value: JSValue) -> u8 {
    shared_of(value).map_or(KIND_NONE, |shared| kind_of(&shared))
}

/// Registers `value`, which [`Bun__SharedRef__kind`] accepted, writes its nonce and returns it. The caller owns the entry
/// until it passes the nonce to [`Bun__SharedRef__onStructuredCloneDestroy`].
#[unsafe(no_mangle)]
pub extern "C" fn Bun__SharedRef__onStructuredCloneSerialize(
    value: JSValue,
    serializer: &mut CloneSerializer,
) -> u64 {
    // A value that is not shared gets nonce zero, which no entry has, so it fails to deserialize.
    let nonce = shared_of(value).map_or(0, |shared| SERIALIZED_REFS.lock().insert(shared));
    _ = serializer.write_int_le(nonce);
    nonce
}

/// `JSValue::ZERO`: the bytes are not a valid record, or the object is gone, or an exception is pending.
///
/// # Safety
/// `[*ptr, end)` is the unread part of the `SerializedScriptValue`'s buffer.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn Bun__SharedRef__onStructuredCloneDeserialize(
    global: &JSGlobalObject,
    ptr: &mut *const u8,
    end: *const u8,
) -> JSValue {
    let start = *ptr;
    let total_length: usize = (end as usize) - (start as usize);
    // SAFETY: `[start, end)` spans `total_length` bytes (fn contract).
    let mut r =
        bun_io::FixedBufferStream::new(unsafe { bun_core::ffi::slice(start, total_length) });

    let Ok(nonce) = r.read_int_le::<u64>() else {
        return JSValue::ZERO;
    };

    // SAFETY: `r.pos <= total_length`, so the advanced cursor stays within `[start, end]`.
    *ptr = unsafe { start.add(r.pos) };

    // The clone is made under the lock, so the destroy hook cannot release the entry's count in between.
    let Some(value) = SERIALIZED_REFS.lock().get(nonce).cloned() else {
        return JSValue::ZERO;
    };
    to_js_host_call(global, || to_js(global, value))
}

/// `~SerializedScriptValue` (or a failed serialize) releases the count that [`Bun__SharedRef__onStructuredCloneSerialize`] took.
#[unsafe(no_mangle)]
pub extern "C" fn Bun__SharedRef__onStructuredCloneDestroy(nonce: u64) {
    let entry = SERIALIZED_REFS.lock().remove(nonce);
    // Dropped here, outside the lock.
    drop(entry);
}
