import * as b from "../codegen/bindgen-lib.ts";

export default b.module({ rustPath: "crate::macro_host" });

/** The reaction to the promise that a call of a macro waits for. */
export const onSettled = b.fn({
  args: { value: b.any, id: b.u32.wrap },
  capability: "js",
  throws: true,
  export: "Bun__MacroHost__onSettled",
  feature: "RuntimeTranspiler",
});
