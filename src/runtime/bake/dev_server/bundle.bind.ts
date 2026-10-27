import * as b from "../../../codegen/bindgen-lib.ts";

export default b.module({ rustPath: "crate::bake::dev_server::bundle" });

const reaction = {
  args: { value: b.any, context: b.promisePtr("crate::bake::dev_server::DevServer") },
  capability: "js",
  throws: true,
} as const;
export const onStartResolved = b.fn({ ...reaction, export: "BunDevServer__onStartResolved" });
export const onStartRejected = b.fn({ ...reaction, export: "BunDevServer__onStartRejected" });
