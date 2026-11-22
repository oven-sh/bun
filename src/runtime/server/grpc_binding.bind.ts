import * as b from "../../codegen/bindgen-lib.ts";
import { Request, Response } from "../webcore/response.bind.ts";

export default b.module({ rustPath: "crate::server::grpc_binding" });

export const acceptCall = b.fn({ args: { request: Request }, returns: b.bool });
export const writeStatus = b.fn({
  args: { request: Request, code: b.u32, message: b.string.utf8, trailers: b.any },
  capability: "js",
  throws: true,
});
export const takeTrailers = b.fn({
  args: { response: Response },
  returns: b.any.returning("Headers", "undefined"),
  capability: "js",
});
