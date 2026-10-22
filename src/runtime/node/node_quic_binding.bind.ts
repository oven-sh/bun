import * as b from "../../codegen/bindgen-lib.ts";

export default b.module({ rustPath: "crate::node::node_quic_binding" });

/** `src/js/internal/quic/binding.ts`. */
export const createBinding = b.fn({ returns: b.any, capability: "js", throws: true });

export const setCallbacks = b.fn({
  export: "Bun__NodeQuicBinding__setCallbacks",
  args: { callbacks: b.any },
  capability: "js",
  throws: true,
});
