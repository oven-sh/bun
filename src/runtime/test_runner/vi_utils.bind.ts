import * as b from "../../codegen/bindgen-lib.ts";

export default b.module({ rustPath: "crate::test_runner::vi_utils" });

export const setConfig = b.fn({
  export: "Bun__ViUtils__setConfig",
  args: { config: b.any },
  capability: "js",
  throws: true,
});
export const resetConfig = b.fn({ export: "Bun__ViUtils__resetConfig", capability: "js" });
