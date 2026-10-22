import * as b from "../codegen/bindgen-lib.ts";

export default b.module({ rustPath: "crate::bytecode_order_recorder" });

export const namesForTesting = b.fn({
  args: { text: b.string.loose.utf8, kind: b.string.loose.utf8, chunkPaths: b.string.loose.utf8.optional },
  returns: b.any,
  capability: "heap",
  throws: true,
  length: 3,
});
