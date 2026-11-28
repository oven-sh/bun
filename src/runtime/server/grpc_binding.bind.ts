import * as b from "../../codegen/bindgen-lib.ts";
import { Response } from "../webcore/response.bind.ts";

export default b.module({ rustPath: "crate::server::grpc_binding" });

const js = { capability: "js", throws: true } as const;
const frame = b.bytes({ from: ["buffer"] });
const metadata = { getter: b.any.returning("Headers"), cache: true, capability: "js" } as const;

export const GrpcRoute = b.class({
  rustPath: "crate::server::grpc_call::GrpcRoute",
  internalFields: ["start"],
  proto: {},
});

export const GrpcCall = b.class({
  rustPath: "crate::server::grpc_call::GrpcCall",
  refCounted: true,
  estimatedSize: true,
  thisValue: "this_value",
  internalFields: ["start", "listener", "server"],
  proto: {
    listener: { internalField: "listener", setter: true },
    server: { internalField: "server" },
    path: { getter: b.string.utf8 },
    host: { getter: b.string.utf8 },
    headers: metadata,
    responseHeaders: metadata,
    responseTrailers: metadata,
    interruptionCode: { getter: b.u8 },
    interruptionMessage: { getter: b.string.utf8 },
    requestIP: { returns: b.any.returning("object", "null"), ...js },
    timeout: { args: { seconds: b.u8 } },
    read: { returns: b.any.returning("object", "null", "undefined"), ...js },
    write: { args: { frame }, returns: b.bool, capability: "heap" },
    end: { args: { code: b.u8, message: b.string.utf8, frame: frame.optional }, capability: "heap" },
  },
});

export const createRoute = b.fn({
  args: { requestStream: b.bool, limit: b.u32, start: b.callable.optional },
  returns: b.any.returning("object"),
  capability: "js",
});
export const takeTrailers = b.fn({
  args: { response: Response },
  returns: b.any.returning("Headers", "undefined"),
  capability: "js",
});
