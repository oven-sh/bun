import * as b from "../../codegen/bindgen-lib.ts";
import { Blob, BlobOrBuildArtifact } from "./Blob.bind.ts";

export default b.module({ rustPath: "crate::webcore::object_url_registry" });

export const createObjectURL = b.fn({ args: { blob: BlobOrBuildArtifact }, returns: b.string });

/** Without an argument it throws `ERR_MISSING_ARGS`, as in Node. */
export const revokeObjectURL = b.fn({
  args: { url: b.string.allowStringObject.ifPassed },
  expected: { url: "revokeObjectURL expects a string" },
  capability: "heap",
  throws: true,
  length: 1,
});

/** `resolveObjectURL` of `node:buffer`. */
export const resolveObjectURL = b.fn({ args: { url: b.string.loose }, returns: Blob.optional, capability: "js" });
