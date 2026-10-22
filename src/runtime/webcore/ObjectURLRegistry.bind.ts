import * as b from "../../codegen/bindgen-lib.ts";
import { Blob } from "./Blob.bind.ts";

export default b.module({ rustPath: "crate::webcore::object_url_registry" });

export const createObjectURL = b.fn({
  args: { blob: Blob },
  expected: { blob: "createObjectURL expects a Blob object" },
  returns: b.string,
});

export const revokeObjectURL = b.fn({
  args: { url: b.string.allowStringObject },
  expected: { url: "revokeObjectURL expects a string" },
});

/** `resolveObjectURL` of `node:buffer`. */
export const resolveObjectURL = b.fn({ args: { url: b.string.loose }, returns: b.any, capability: "js" });
