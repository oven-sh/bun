import * as b from "../../codegen/bindgen-lib.ts";
import { BlobOrBuildArtifact } from "./Blob.bind.ts";

export default b.module({ rustPath: "crate::webcore::form_data" });

const stringOrBuffer = b.bytes({ from: ["string", "buffer"] });
const parse = { returns: b.any, capability: "heap", throws: true } as const;

/** Without a boundary, or with an empty one, the input is URL-encoded. A `Blob` that is a file is empty. */
export const from = b.overloads(
  {
    ...parse,
    args: { input: BlobOrBuildArtifact, boundary: stringOrBuffer.nullable },
    rustPath: "crate::webcore::form_data::from_blob",
  },
  {
    ...parse,
    args: { input: stringOrBuffer, boundary: stringOrBuffer.nullable },
    rustPath: "crate::webcore::form_data::from_bytes",
  },
);
