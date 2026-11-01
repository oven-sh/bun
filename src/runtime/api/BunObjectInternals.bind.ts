import * as b from "../../codegen/bindgen-lib.ts";

export default b.module({ rustPath: "crate::api::bun_object" });

/** Called by the entry point the bundler generates for a macro. */
export const registerMacro = b.fn({
  args: { id: b.f64, callback: b.any },
  capability: "heap",
  throws: true,
});

/** `bun:internal-for-testing`. */
export const resolverDirInfoSlotsUsed = b.fn({ returns: b.usize });

/** `bun:internal-for-testing`. */
export const resolverLookupsRunAgain = b.fn({ returns: b.usize });

/** `bun:internal-for-testing`. */
export const resolverHoldNextMissCheck = b.fn({});
export const resolverWaitUntilMissCheckIsHeld = b.fn({ returns: b.bool });
export const resolverReleaseMissCheck = b.fn({});
