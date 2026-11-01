// Functions that exist to test `async` Rust on the event loop: test/internal/rust-future.test.ts
import * as b from "../codegen/bindgen-lib.ts";

export default b.module({ rustPath: "crate::future_testing" });

const promised = { returns: b.any.returning("Promise"), capability: "js", throws: true } as const;

export const futures = b.namespace({
  /** How many of the futures below exist. */
  alive: { args: {}, returns: b.usize },
  /** `a + b`, added on the work pool. */
  add: { ...promised, args: { a: b.i32, b: b.i32 } },
  /** The same through `bun_jsc::Job`, to compare. */
  addWithJob: { ...promised, args: { a: b.i32, b: b.i32 } },
  /** The sum of `0..count`, each term from its own pool task, all in flight at once. */
  fanOut: { ...promised, args: { count: b.u32 } },
  /** Resolves without suspending. */
  ready: { ...promised, args: { value: b.any } },
  sleep: { ...promised, args: { ms: b.u32 } },
  /** Occupies a pool thread for `ms`. */
  block: { ...promised, args: { ms: b.u32 } },
  /** `["fulfilled", value]` or `["rejected", reason]`. */
  settled: { ...promised, args: { value: b.any } },
  /** `await callback(i)` for each `i` in `0..count`, one after the other. The sum of what they gave. */
  sequence: { ...promised, args: { callback: b.callable, count: b.u32 } },
  /** What `value` settles to, or `"timed out"` after `ms`. */
  withTimeout: { ...promised, args: { value: b.any, ms: b.u32 } },
  /** Rejects with what `callback` throws after `ms`. */
  callAfter: { ...promised, args: { callback: b.callable, ms: b.u32 } },
  /** `text` in upper case, from the pool. The result is made through the bindings API. */
  shout: { ...promised, args: { text: b.string.utf8.owned } },
  /** A future that spawns another and waits for what it leaves behind. */
  nested: { ...promised, args: { value: b.i32 } },
  /** No promise: what `callback` throws after `ms` is an uncaught exception. */
  detached: { args: { callback: b.callable, ms: b.u32 }, capability: "js", throws: true },
});
