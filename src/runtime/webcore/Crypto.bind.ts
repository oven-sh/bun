import * as b from "../../codegen/bindgen-lib.ts";

export default b.module({ rustPath: "crate::webcore::crypto" });

/** What is not a string is not converted: it is "hex". */
export const UUIDEncoding = b.union({ label: b.string.utf8, ignored: b.any });

const stringOrBuffer = b.bytes({ from: ["string", "buffer"] });

export const randomUUIDv5 = b.fn({
  /** A namespace that is a string is a UUID or the name of one. One that is a buffer is its 16 bytes. */
  args: { name: stringOrBuffer, namespace: stringOrBuffer.withValue, encoding: UUIDEncoding },
  returns: b.any,
  capability: "heap",
  throws: true,
  rustPath: "crate::webcore::crypto::random_uuid_v5",
});
