import * as b from "../../codegen/bindgen-lib.ts";

export default b.module({ rustPath: "crate::node::node_zlib_binding" });

export const crc32 = b.fn({
  args: {
    data: b.bytes({ from: ["string", "buffer"], refuse: ["stringObject"] }),
    value: b.u32.validateInteger().default(0),
  },
  expected: { data: ["Buffer", "TypedArray", "DataView", "string"] },
  returns: b.u32,
});
