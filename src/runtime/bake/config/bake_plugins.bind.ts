import * as b from "../../../codegen/bindgen-lib.ts";

export default b.module({ rustPath: "crate::bake::config::plugins" });

export const setConfigPlugins = b.fn({
  args: { plugins: b.any, names: b.array(b.string.loose.utf8.owned) },
  capability: "js",
});
export const isRestart = b.fn({ returns: b.bool });
export const restartProcess = b.fn({ capability: "js" });
export const isRestarting = b.fn({ returns: b.bool });
export const setPages = b.fn({ args: { framework: b.any }, capability: "js" });
export const checkFramework = b.fn({ args: { framework: b.any }, capability: "js", throws: true });
