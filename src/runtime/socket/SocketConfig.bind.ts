import * as b from "../../codegen/bindgen-lib.ts";
import { TLSOptions } from "./SSLConfig.bind.ts";

export const SocketHandlerBinaryType = b.enumeration([
  ["arraybuffer", "ArrayBuffer"],
  ["buffer", "Buffer"],
  ["uint8array", "Uint8Array"],
]);

/** `other` is refused after every member was read. */
export const SocketCallback = b.union({ none: b.null, callback: b.callable, other: b.ignored });

export const SocketHandler = b.dictionary(
  {
    open: { type: SocketCallback, rustName: "on_open" },
    close: { type: SocketCallback, rustName: "on_close" },
    error: { type: SocketCallback, rustName: "on_error" },
    data: { type: SocketCallback, rustName: "on_data" },
    drain: { type: SocketCallback, rustName: "on_writable" },
    handshake: { type: SocketCallback, rustName: "on_handshake" },
    end: { type: SocketCallback, rustName: "on_end" },
    connectError: { type: SocketCallback, rustName: "on_connect_error" },
    timeout: { type: SocketCallback, rustName: "on_timeout" },
    session: { type: SocketCallback, rustName: "on_session" },
    keylog: { type: SocketCallback, rustName: "on_keylog" },
    serverName: { type: SocketCallback, rustName: "on_server_name" },
    alpnCallback: { type: SocketCallback, rustName: "on_alpn_callback" },
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

/** What `reload()` of a socket or a listener takes. `socket` is read as `SocketHandler`. */
export const SocketReloadOptions = b.dictionary({ socket: b.opaque.optional }, { deferred: true });

/** The `tls` object, read for the `SecureContext` in it. `TLSOptions` reads the rest. */
export const PrebuiltTLSOptions = b.dictionary({ secureContext: b.opaque.emptyStringAsNull }, { deferred: true });
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
