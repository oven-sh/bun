import * as b from "../../codegen/bindgen-lib.ts";

export default b.module({ rustPath: "crate::desktop" });

export const load = b.fn({ args: { onEvents: b.callable }, returns: b.undefined, capability: "js", throws: true });
export const call = b.fn({
  args: { json: b.string.utf8 },
  returns: b.string.local,
  capability: "heap",
  throws: true,
});
export const post = b.fn({ args: { command: b.u32, surface: b.u32, argument: b.u32 }, returns: b.undefined });
export const draw = b.fn({
  args: { numbers: b.bytes({ from: ["buffer"] }), length: b.u32, text: b.string.utf8 },
  returns: b.undefined,
});
export const measure = b.fn({
  args: { numbers: b.bufferSource, text: b.string.utf8 },
  returns: b.undefined,
  capability: "heap",
});
export const drainNumbers = b.fn({ args: { numbers: b.bufferSource }, returns: b.u32, capability: "heap" });
export const drain = b.fn({ returns: b.string.local, capability: "heap", throws: true });
export const drainMicrotasks = b.fn({ returns: b.undefined, capability: "js" });
/** Runs the event loop until the promise is settled. */
export const waitFor = b.fn({ args: { promise: b.any }, returns: b.undefined, capability: "js" });
/** What the encoding lacks becomes a character reference, which is percent-encoded `forQuery`. */
export const encodeText = b.fn({
  args: { label: b.string.utf8, text: b.string.utf8, forQuery: b.bool },
  returns: b.bufferSource,
  capability: "heap",
  throws: true,
});
export const isLoadingEntryPoint = b.fn({ returns: b.bool });
export const wait = b.fn({ returns: b.undefined });
export const present = b.fn({ returns: b.undefined });
export const putBlob = b.fn({ args: { bytes: b.bytes({ from: ["buffer"] }) }, returns: b.u32 });
export const takeBlob = b.fn({ args: { id: b.u32 }, returns: b.bufferSource, capability: "heap", throws: true });
export const keepAlive = b.fn({ args: { on: b.bool }, returns: b.undefined, capability: "heap" });
export const writeToUnixSocket = b.fn({ args: { path: b.string.utf8, message: b.string.utf8 }, returns: b.bool });
export const findChrome = b.fn({ returns: b.string.utf8.nullable });
/** Style sheets with the contents of this file refer to its pages from now on. Does nothing unless it ships with the program. */
export const mapResource = b.fn({ args: { path: b.string.utf8 } });
export const resourcesPath = b.fn({ returns: b.string.utf8.nullable });
