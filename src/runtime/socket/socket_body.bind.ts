import * as b from "../../codegen/bindgen-lib.ts";

export default b.module({ rustPath: "crate::socket::socket_body" });

const js = { capability: "js", throws: true } as const;
const textIfOpen = b.any.returning("string", "undefined");
const cached = { ...js, getter: textIfOpen, cache: true } as const;
const write = {
  ...js,
  args: { data: b.any, byteOffset: b.any, byteLength: b.any, encoding: b.any },
  returns: b.any.returning("int32"),
  length: 3,
} as const;
const end = { ...write, returns: b.any.returning("number") } as const;
const buffered = { ...js, args: { data: b.any, encoding: b.any } } as const;
const bufferIfAny = { returns: b.any.returning("Buffer", "undefined"), ...js } as const;
const objectIfAny = { returns: b.any.returning("object", "undefined"), ...js } as const;

/** What `Bun.connect()` resolves to and the `open` handler of `Bun.listen()` takes. */
function socket<SSL extends boolean>(ssl: SSL) {
  return b.class({
    rustPath: ssl ? "crate::socket::TLSSocket" : "crate::socket::TCPSocket",
    refCounted: true,
    finalize: true,
    memoryCost: true,
    /** `handlers` is shared with the listener and its other sockets. `duplex*` serve a `TLSSocket` over a `Duplex`. */
    internalFields: [
      "handlers",
      "data",
      ...(ssl ? ["duplexOrigin", "duplexOnData", "duplexOnEnd", "duplexOnWritable", "duplexOnClose"] : []),
    ],
    proto: {
      alpnProtocol: { ...js, getter: b.any.returning("string", "boolean") },
      authorized: { getter: b.bool, pure: true },
      bytesWritten: { getter: b.f64, pure: true },
      /** Can call the socket's handlers. */
      close: { capability: "js" },
      data: { setter: true, internalField: "data" },
      disableRenegotiation: {},
      end,
      exportKeyingMaterial: { ...bufferIfAny, args: { length: b.any, label: b.any, context: b.any } },
      fd: { getter: b.any.returning("number"), capability: "heap" },
      flush: { capability: "js" },
      getAuthorizationError: { returns: b.any.returning("Error", "null"), capability: "js" },
      getCertificate: objectIfAny,
      getCipher: objectIfAny,
      getEphemeralKeyInfo: { returns: b.any.returning("object", "null"), ...js },
      getPeerCertificate: {
        ...js,
        args: { abbreviated: b.any },
        returns: b.any.returning("object", "undefined", "null"),
      },
      ...(ssl ? { getPeerX509Certificate: objectIfAny } : {}),
      getServername: { returns: textIfOpen, ...js },
      getSession: bufferIfAny,
      getSharedSigalgs: { returns: b.any.returning("Array", "null", "undefined"), ...js },
      getTLSFinishedMessage: bufferIfAny,
      getTLSPeerFinishedMessage: bufferIfAny,
      getTLSTicket: bufferIfAny,
      getTLSVersion: { returns: b.any.returning("string", "null"), ...js },
      getTypeOfService: { returns: b.i32 },
      ...(ssl ? { getX509Certificate: objectIfAny } : {}),
      isSessionReused: { returns: b.bool },
      listener: { getter: b.any.returning("Listener", "undefined"), capability: "heap" },
      localAddress: cached,
      localFamily: { getter: textIfOpen, cache: true, capability: "js" },
      localPort: { getter: b.u16.optional, cache: true },
      pause: { capability: "js" },
      readyState: { getter: b.i32 },
      ref: { rustName: "js_ref" },
      reload: { ...js, args: { options: b.any } },
      remoteAddress: cached,
      remoteFamily: { getter: textIfOpen, cache: true, capability: "js" },
      remotePort: { getter: b.u16.optional },
      renegotiate: js,
      resume: { capability: "js" },
      resumeSNI: { args: { context: b.any, isError: b.bool.loose }, capability: "js" },
      setKeepAlive: { ...js, args: { enable: b.bool.loose, initialDelay: b.any }, returns: b.bool },
      setKeyCert: { ...js, args: { context: b.any } },
      setMaxSendFragment: { ...js, args: { size: b.any }, returns: b.any.returning("boolean") },
      /** No argument enables it, `undefined` disables it. */
      setNoDelay: { args: { noDelay: b.any.variadic }, returns: b.bool, length: 1 },
      setServername: { ...js, args: { name: b.any } },
      setSession: { ...js, args: { session: b.any } },
      setTypeOfService: { ...js, args: { tos: b.any }, returns: b.i32 },
      setVerifyMode: { ...js, args: { requestCert: b.any, rejectUnauthorized: b.any } },
      shutdown: { args: { halfClose: b.bool.loose }, capability: "js" },
      terminate: { capability: "js" },
      timeout: { ...js, args: { seconds: b.any } },
      unref: { rustName: "js_unref" },
      upgradeTLS: { ...js, args: { options: b.any }, returns: b.any.returning("Array", "undefined") },
      write,
      "@@dispose": { ...end, rustName: "end", length: 0 },
      endBuffered: { ...buffered, returns: b.any.returning("boolean"), privateSymbol: "end" },
      writeBuffered: { ...buffered, returns: b.any.returning("boolean", "number"), privateSymbol: "write" },
    },
  });
}

export const TCPSocket = socket(false);
export const TLSSocket = socket(true);

export const BunSocket = b.union({ tcp: TCPSocket, tls: TLSSocket });
/** The `_handle` of a `net.Socket`: `new net.Socket({ handle })` keeps any object. */
export const SocketHandle = b.union({ tcp: TCPSocket, tls: TLSSocket, ignored: b.any });

export const upgradeTLSDeferred = b.fn({
  args: { socket: BunSocket, options: b.any },
  returns: b.any,
  capability: "js",
  throws: true,
});
export const releaseHeldFlight = b.fn({ args: { socket: SocketHandle } });
export const checkServerIdentityInHandshake = b.fn({ args: { socket: SocketHandle, inHandshake: b.bool } });
export const firstFlightBeforeFin = b.fn({ args: { socket: SocketHandle } });
export const isNamedPipeSocket = b.fn({ args: { socket: SocketHandle }, returns: b.bool });
export const getBufferedAmount = b.fn({ args: { socket: SocketHandle }, returns: b.usize });
