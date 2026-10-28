import * as b from "../../codegen/bindgen-lib.ts";
import { SecureContext } from "../api/bun/SecureContext.bind.ts";
import { TLSOptions } from "./SSLConfig.bind.ts";

export const SocketHandlerBinaryType = b.enumeration([
  ["arraybuffer", "ArrayBuffer"],
  ["buffer", "Buffer"],
  ["uint8array", "Uint8Array"],
]);

export const SocketHandler = b.dictionary(
  {
    open: { type: b.opaque, rustName: "on_open" },
    close: { type: b.opaque, rustName: "on_close" },
    error: { type: b.opaque, rustName: "on_error" },
    data: { type: b.opaque, rustName: "on_data" },
    drain: { type: b.opaque, rustName: "on_writable" },
    handshake: { type: b.opaque, rustName: "on_handshake" },
    end: { type: b.opaque, rustName: "on_end" },
    connectError: { type: b.opaque, rustName: "on_connect_error" },
    timeout: { type: b.opaque, rustName: "on_timeout" },
    session: { type: b.opaque, rustName: "on_session" },
    keylog: { type: b.opaque, rustName: "on_keylog" },
    serverName: { type: b.opaque, rustName: "on_server_name" },
    alpnCallback: { type: b.opaque, rustName: "on_alpn_callback" },
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
    data: b.opaque.optional,
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

/** The `tls` object, read for the `SecureContext` in it. `TLSOptions` reads the rest. */
export const PrebuiltTLSOptions = b.dictionary(
  { secureContext: { type: SecureContext.withValue.emptyStringAsNull, expected: ["SecureContext"] } },
  { deferred: true, reportedAs: "tls" },
);
/** `TLSOptions` refuses `other`. */
export const UpgradeTLS = b.union({ enabled: b.bool, options: PrebuiltTLSOptions, other: b.opaque });

/**
 * The object that `SocketOptions` is read from in one call, and what `Bun.listen` and `Bun.connect` read from it
 * afterwards. A member of another type is ignored.
 */
export const SocketOptionsObject = b.dictionary(
  {
    tls: PrebuiltTLSOptions.otherAsNull,
    fd: b.f64.otherAsNull,
    /** Windows: `fd` is a `SOCKET`, not a libuv descriptor. */
    fdIsRawSocket: b.bool.loose.default(false),
    localAddress: b.string.allowStringObject.otherAsNull,
    localPort: b.f64.otherAsNull,
  },
  { deferred: true },
);
