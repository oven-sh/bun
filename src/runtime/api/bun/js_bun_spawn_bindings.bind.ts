import * as b from "../../../codegen/bindgen-lib.ts";

export default b.module({ rustPath: "crate::api::js_bun_spawn_bindings" });

/** `(cmd, options?)` or `({ cmd, ..options })`. */
const spawnSignature = {
  args: { cmdOrOptions: b.any, options: b.any },
  returns: b.any,
  capability: "js",
  throws: true,
} as const;
export const spawn = b.fn(spawnSignature);
export const spawnSync = b.fn(spawnSignature);
