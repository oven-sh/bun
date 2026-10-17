import * as b from "../../codegen/bindgen-lib.ts";

export default b.module({ rustPath: "crate::webcore::crypto" });

/** What is not a string is not converted: it is "hex". */
export const UUIDEncoding = b.union({ label: b.string.utf8, ignored: b.any });

export const randomUUIDv5 = b.fn({
  args: {
    name: b.bytes({ from: ["string", "buffer"] }),
    /** A string is a UUID or the name of one. A buffer is its 16 bytes. */
    namespace: b.bytes({ from: ["string", "buffer"], string: "asIs", held: "handle" }),
    encoding: UUIDEncoding,
  },
  returns: b.any,
  capability: "heap",
  throws: true,
  rustPath: "crate::webcore::crypto::random_uuid_v5",
});
