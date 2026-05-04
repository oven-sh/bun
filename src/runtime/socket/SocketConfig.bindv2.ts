import * as b from "bindgenv2";
import { SSLConfig } from "../../server/SSLConfig.bindv2";

export const BinaryType = b.enumeration("SocketConfigBinaryType", [
  ["arraybuffer", "ArrayBuffer"],
  ["buffer", "Buffer"],
  ["uint8array", "Uint8Array"],
]);

export const Handlers = b.dictionary(
  {
    name: "SocketConfigHandlers",
    userFacingName: "SocketHandler",
    generateConversionFunction: true,
  },
  {
    open: { type: b.RawAny, internalName: "onOpen" },
    close: { type: b.RawAny, internalName: "onClose" },
    error: { type: b.RawAny, internalName: "onError" },
    data: { type: b.RawAny, internalName: "onData" },
    drain: { type: b.RawAny, internalName: "onWritable" },
    handshake: { type: b.RawAny, internalName: "onHandshake" },
    end: { type: b.RawAny, internalName: "onEnd" },
    connectError: { type: b.RawAny, internalName: "onConnectError" },
    timeout: { type: b.RawAny, internalName: "onTimeout" },
    binaryType: {
      type: BinaryType,
      default: "buffer",
      internalName: "binary_type",
    },
  },
);

export const TLS = b.union("SocketConfigTLS", {
  none: b.null,
  boolean: b.bool,
  object: SSLConfig,
});

export const SocketConfig = b.dictionary(
  {
    name: "SocketConfig",
    userFacingName: "SocketOptions",
    generateConversionFunction: true,
  },
  {
    socket: {
      type: Handlers,
      internalName: "handlers",
    },
    data: b.RawAny,
    allowHalfOpen: {
      type: b.bool,
      default: false,
      internalName: "allow_half_open",
    },
    hostname: {
      type: b.String.loose.nullable.loose,
      altNames: ["host"],
    },
    port: b.u16.loose.nullable,
    tls: TLS,
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
    unix: {
      type: b.String.nullable.loose,
      internalName: "unix_", // `unix` is a predefined C macro...
    },
    fd: b.i32.optional,
  },
);
