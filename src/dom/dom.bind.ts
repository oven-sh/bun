// For tests.
import * as b from "../codegen/bindgen-lib.ts";

export default b.module({ rustPath: "crate::bindings", feature: "Desktop", isCold: true });

const text = b.string.utf8;
const doc = b.ref("Doc");

/** See `inspect` in accessibility.rs of the library. */
export const askAsAssistiveTechnology = b.fn({ args: { question: text }, returns: text });
/** What would be painted, a line for each item. */
export const dumpDisplayList = b.fn({ args: { doc }, returns: text, capability: "js" });
export const panicInEngine = b.fn({ args: { doc } });
