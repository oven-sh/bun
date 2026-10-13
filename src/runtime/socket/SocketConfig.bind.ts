import * as b from "../../codegen/bindgen-lib.ts";
import { SSLConfig } from "./SSLConfig.bind.ts";

export const SocketConfigBinaryType = b.enumeration("SocketConfigBinaryType", [
  ["arraybuffer", "ArrayBuffer"],
  ["buffer", "Buffer"],
  ["uint8array", "Uint8Array"],
]);

export const SocketConfigHandlers = b.dictionary(
  {
    name: "SocketConfigHandlers",
    userFacingName: "SocketHandler",
    fromJS: true,
  },
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
    binaryType: {
      type: SocketConfigBinaryType,
      default: "buffer",
      internalName: "binary_type",
    },
  },
);

export const SocketConfigTLS = b.union("SocketConfigTLS", {
  none: b.null,
  boolean: b.bool,
  object: SSLConfig,
});

export const SocketConfig = b.dictionary(
  {
    name: "SocketConfig",
    userFacingName: "SocketOptions",
    fromJS: true,
  },
  {
    socket: {
      type: SocketConfigHandlers,
      internalName: "handlers",
    },
    data: b.any,
    allowHalfOpen: {
      type: b.bool,
      default: false,
      internalName: "allow_half_open",
    },
    hostname: {
      type: b.string.loose.nullable.loose,
      altNames: ["host"],
    },
    port: b.u16.loose.nullable,
    tls: SocketConfigTLS,
    exclusive: {
      type: b.bool,
      default: false,
    },
    reusePort: {
      type: b.bool,
      default: false,
      internalName: "reuse_port",
    },
    ipv6Only: {
      type: b.bool,
      default: false,
      internalName: "ipv6_only",
    },
    pauseOnConnect: {
      type: b.bool.loose,
      default: false,
      internalName: "pause_on_connect",
    },
    unix: {
      type: b.string.nullable.loose,
      internalName: "unix_", // `unix` is a predefined C macro...
    },
    fd: b.i32.optional,
  },
);
