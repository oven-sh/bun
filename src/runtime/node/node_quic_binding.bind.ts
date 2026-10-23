import * as b from "../../codegen/bindgen-lib.ts";

export default b.module({ rustPath: "crate::node::node_quic_binding" });

/** The default export of `src/js/internal/quic/binding.ts`. */
export const binding = b.value({ returns: b.any, capability: "js", throws: true });

export const setCallbacks = b.fn({
  export: "Bun__NodeQuicBinding__setCallbacks",
  args: { callbacks: b.object },
  expected: { callbacks: ["object"] },
  capability: "js",
  throws: true,
});
