import * as b from "../../codegen/bindgen-lib.ts";
import { TLSOptions } from "./SSLConfig.bind.ts";

export const SocketHandlerBinaryType = b.enumeration([
  ["arraybuffer", "ArrayBuffer"],
  ["buffer", "Buffer"],
  ["uint8array", "Uint8Array"],
]);

export const SocketHandler = b.dictionary(
  {
    open: { type: b.any, rustName: "on_open" },
    close: { type: b.any, rustName: "on_close" },
    error: { type: b.any, rustName: "on_error" },
    data: { type: b.any, rustName: "on_data" },
    drain: { type: b.any, rustName: "on_writable" },
    handshake: { type: b.any, rustName: "on_handshake" },
    end: { type: b.any, rustName: "on_end" },
    connectError: { type: b.any, rustName: "on_connect_error" },
    timeout: { type: b.any, rustName: "on_timeout" },
    session: { type: b.any, rustName: "on_session" },
    keylog: { type: b.any, rustName: "on_keylog" },
    serverName: { type: b.any, rustName: "on_server_name" },
    alpnCallback: { type: b.any, rustName: "on_alpn_callback" },
    binaryType: SocketHandlerBinaryType.default("buffer"),
  },
  { fromJS: true },
);

export const SocketOptionsTLS = b.union({
  none: b.null,
  boolean: b.bool,
  object: TLSOptions,
});

export const SocketOptions = b.dictionary(
  {
    socket: { type: SocketHandler, rustName: "handlers" },
    data: b.any,
    allowHalfOpen: b.bool.default(false),
    hostname: { type: b.string.loose.falsyAsNull, altNames: ["host"] },
    port: b.u16.loose.allowBigInt.nullable,
    tls: SocketOptionsTLS,
    exclusive: b.bool.default(false),
    reusePort: b.bool.default(false),
    ipv6Only: b.bool.default(false),
    pauseOnConnect: b.bool.loose.default(false),
    unix: {
      type: b.string.falsyAsNull,
      rustName: "unix_", // The C++ struct has the same field, and `unix` is a predefined C macro.
    },
    fd: b.i32.allowBigInt.optional,
  },
  { fromJS: true },
);
