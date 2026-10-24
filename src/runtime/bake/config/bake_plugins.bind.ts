import * as b from "../../../codegen/bindgen-lib.ts";
import { FrameworkValue } from "../../server/server.bind.ts";

export default b.module({ rustPath: "crate::bake::config::plugins" });

export const setConfigPlugins = b.fn({
  args: { plugins: b.opaque, names: b.array(b.string.loose.utf8.owned) },
  capability: "js",
});
export const isRestart = b.fn({ returns: b.bool });
export const restartProcess = b.fn({ capability: "js" });
export const isRestarting = b.fn({ returns: b.bool });
export const setPages = b.fn({ args: { framework: b.opaque.nullable }, capability: "js", length: 1 });
export const checkFramework = b.fn({ args: { framework: FrameworkValue }, capability: "js", throws: true, length: 1 });
