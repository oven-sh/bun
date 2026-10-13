import * as b from "../../codegen/bindgen-lib.ts";
import { SSLConfig } from "./SSLConfig.bind.ts";

export const SocketConfigBinaryType = b.enumeration([
  ["arraybuffer", "ArrayBuffer"],
  ["buffer", "Buffer"],
  ["uint8array", "Uint8Array"],
]);

export const SocketConfigHandlers = b.dictionary(
  {
    open: { type: b.any, internalName: "onOpen" },
    close: { type: b.any, internalName: "onClose" },
    error: { type: b.any, internalName: "onError" },
    data: { type: b.any, internalName: "onData" },
    drain: { type: b.any, internalName: "onWritable" },
    handshake: { type: b.any, internalName: "onHandshake" },
    end: { type: b.any, internalName: "onEnd" },
    connectError: { type: b.any, internalName: "onConnectError" },
    timeout: { type: b.any, internalName: "onTimeout" },
    session: { type: b.any, internalName: "onSession" },
    keylog: { type: b.any, internalName: "onKeylog" },
    serverName: { type: b.any, internalName: "onServerName" },
    alpnCallback: { type: b.any, internalName: "onALPNCallback" },
    binaryType: SocketConfigBinaryType.default("buffer"),
  },
  {
    userFacingName: "SocketHandler",
    fromJS: true,
  },
);

export const SocketConfigTLS = b.union({
  none: b.null,
  boolean: b.bool,
  object: SSLConfig,
});

export const SocketConfig = b.dictionary(
  {
    socket: { type: SocketConfigHandlers, internalName: "handlers" },
    data: b.any,
    allowHalfOpen: b.bool.default(false),
    hostname: { type: b.string.loose.falsyAsNull, altNames: ["host"] },
    port: b.u16.loose.nullable,
    tls: SocketConfigTLS,
    exclusive: b.bool.default(false),
    reusePort: b.bool.default(false),
    ipv6Only: b.bool.default(false),
    pauseOnConnect: b.bool.loose.default(false),
    unix: {
      type: b.string.falsyAsNull,
      internalName: "unix_", // `unix` is a predefined C macro...
    },
    fd: b.i32.optional,
  },
  {
    userFacingName: "SocketOptions",
    fromJS: true,
  },
);
