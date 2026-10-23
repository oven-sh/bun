import * as b from "../../codegen/bindgen-lib.ts";

export default b.module({ rustPath: "crate::webcore::object_url_registry" });

/** `blob` is a `Blob` or a `BuildArtifact`. */
export const createObjectURL = b.fn({ args: { blob: b.any }, returns: b.string, capability: "heap", throws: true });

/** Without an argument it throws `ERR_MISSING_ARGS`, as in Node. */
export const revokeObjectURL = b.fn({ args: { url: b.any.variadic }, capability: "js", throws: true, length: 1 });

/** `resolveObjectURL` of `node:buffer`. */
export const resolveObjectURL = b.fn({ args: { url: b.string.loose }, returns: b.any, capability: "js" });
