import * as b from "../../codegen/bindgen-lib.ts";
import { Blob, BlobOrBuildArtifact } from "./Blob.bind.ts";

export default b.module({ rustPath: "crate::webcore::object_url_registry" });

export const createObjectURL = b.fn({ args: { object: BlobOrBuildArtifact }, returns: b.string });

export const revokeObjectURL = b.fn({
  args: { url: b.string.allowStringObject },
  expected: { url: "revokeObjectURL expects a string" },
  requiredArguments: 1,
});

/** `resolveObjectURL` of `node:buffer`. */
export const resolveObjectURL = b.fn({ args: { url: b.string.loose }, returns: Blob.optional, capability: "js" });
