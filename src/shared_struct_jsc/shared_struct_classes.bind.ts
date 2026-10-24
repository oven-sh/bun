import * as b from "../codegen/bindgen-lib.ts";

export default b.module({ rustPath: "crate::shared_struct_classes" });

const heap = { capability: "heap", throws: true } as const;
const js = { capability: "js", throws: true } as const;

/** A lock that any worker holding it can take. Blocking, and aborted when the worker is asked to terminate. */
export const Mutex = b.class({
  rustPath: "crate::shared_struct_classes::MutexObject",
  refCounted: true,
  construct: {},
  proto: {
    /** `true` once held, `false` if `timeout` milliseconds passed first or the worker was asked to terminate. */
    lock: { ...heap, args: { timeout: b.f64.loose.optional }, returns: b.bool },
    tryLock: { returns: b.bool },
    unlock: heap,
  },
});

export const Condition = b.class({
  rustPath: "crate::shared_struct_classes::ConditionObject",
  refCounted: true,
  construct: {},
  proto: {
    /** Releases `mutex`, which this thread holds, waits to be notified, and takes it again. `false` on timeout or termination. */
    wait: { ...heap, args: { mutex: Mutex, timeout: b.f64.loose.optional }, returns: b.bool },
    /** How many waiters were woken. */
    notify: { args: { count: b.f64.loose.optional }, returns: b.f64 },
  },
});

/** `{ Mutex, Condition, SharedArray, SharedStruct }`, the constructors of this realm. `SharedArray` and `SharedStruct` are made by hand-written C++. */
export const classes = b.fn({ returns: b.any, capability: "js" });

/** Whether a value can be stored in a slot of a SharedStruct or SharedArray. */
export const canBeShared = b.fn({ args: { value: b.any }, returns: b.bool });

/** The sequentially consistent operations of `Atomics`, on a slot of a SharedStruct (`key` is a field name) or a SharedArray (`key` is an index). */
export const atomicLoad = b.fn({ ...js, args: { target: b.any, key: b.any }, returns: b.any });
export const atomicStore = b.fn({ ...js, args: { target: b.any, key: b.any, value: b.any }, returns: b.any });
export const atomicExchange = b.fn({ ...js, args: { target: b.any, key: b.any, value: b.any }, returns: b.any });
export const atomicCompareExchange = b.fn({
  ...js,
  args: { target: b.any, key: b.any, expected: b.any, replacement: b.any },
  returns: b.any,
});
