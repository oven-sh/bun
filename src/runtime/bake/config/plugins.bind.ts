import * as b from "../../../codegen/bindgen-lib.ts";

export default b.module({ rustPath: "crate::bake::config::plugins" });

export const setConfigPlugins = b.fn({ args: { plugins: b.any, names: b.any }, capability: "js", throws: true });
export const isRestart = b.fn({ returns: b.bool });
export const restartProcess = b.fn({ capability: "js" });
export const isRestarting = b.fn({ returns: b.bool });
export const setPages = b.fn({ args: { framework: b.any }, capability: "js" });
export const checkFramework = b.fn({ args: { framework: b.any }, capability: "js", throws: true });
