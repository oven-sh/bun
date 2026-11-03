import * as b from "../../codegen/bindgen-lib.ts";

export default b.module({ rustPath: "crate::api::bun_object" });

/** Called by the entry point the bundler generates for a macro. */
export const registerMacro = b.fn({
  args: { id: b.f64, callback: b.any },
  capability: "heap",
  throws: true,
});

/** `bun:internal-for-testing`. */
export const resolverCounters = b.fn({ returns: b.record(b.usize) });

/** `bun:internal-for-testing`. */
export const resolverMissHold = b.fn({ args: { step: b.i32 }, returns: b.bool });
