import * as b from "../../codegen/bindgen-lib.ts";
import { Request } from "../webcore/response.bind.ts";

export default b.module({ rustPath: "crate::server::server_body" });

const reaction = {
  args: { value: b.any, context: b.promisePtr("crate::server::server_body::ServePlugins") },
  capability: "js",
} as const;
export const onResolvePlugins = b.fn({ ...reaction, export: "BunServe__onResolvePlugins" });
export const onRejectPlugins = b.fn({ ...reaction, export: "BunServe__onRejectPlugins" });

/** For `internal/debugger`. `server.requestIP(request)` is the other end of the same connection. */
export const requestLocalAddress = b.fn({ args: { request: Request.otherAsNull }, returns: b.string.nullable });
