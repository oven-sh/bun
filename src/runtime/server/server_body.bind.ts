import * as b from "../../codegen/bindgen-lib.ts";

export default b.module({ rustPath: "crate::server::server_body" });

const reaction = { args: { value: b.any, context: b.any }, capability: "js" } as const;
export const onResolvePlugins = b.fn({ ...reaction, export: "BunServe__onResolvePlugins" });
export const onRejectPlugins = b.fn({ ...reaction, export: "BunServe__onRejectPlugins" });
