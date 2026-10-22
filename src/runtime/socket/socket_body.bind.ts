import * as b from "../../codegen/bindgen-lib.ts";

export default b.module({ rustPath: "crate::socket::socket_body" });

const js = { capability: "js", throws: true } as const;
const method = { returns: b.any, ...js } as const;
const cached = { ...js, getter: b.any, cache: true } as const;
const write = {
  ...method,
  args: { data: b.any, byteOffset: b.any, byteLength: b.any, encoding: b.any },
  length: 3,
} as const;
const writeBuffered = { ...method, args: { data: b.any, encoding: b.any } } as const;

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
      ...(ssl ? ["duplexOrigin", "duplexOnData", "duplexOnEnd", "duplexOnClose"] : []),
    ],
    proto: {
      alpnProtocol: { ...js, getter: b.any },
      authorized: { getter: b.bool },
      bytesWritten: { getter: b.f64 },
      /** Can call the socket's handlers. */
      close: { capability: "js" },
      data: { setter: true, internalField: "data" },
      disableRenegotiation: {},
      end: write,
      exportKeyingMaterial: { ...method, args: { length: b.any, label: b.any, context: b.any } },
      fd: { getter: b.any, capability: "heap" },
      flush: { capability: "js" },
      getAuthorizationError: { returns: b.any, capability: "js" },
      getCertificate: method,
      getCipher: method,
      getEphemeralKeyInfo: method,
      getPeerCertificate: { ...method, args: { abbreviated: b.any } },
      ...(ssl ? { getPeerX509Certificate: method } : {}),
      getServername: method,
      getSession: method,
      getSharedSigalgs: method,
      getTLSFinishedMessage: method,
      getTLSPeerFinishedMessage: method,
      getTLSTicket: method,
      getTLSVersion: method,
      getTypeOfService: { returns: b.i32 },
      ...(ssl ? { getX509Certificate: method } : {}),
      isSessionReused: { returns: b.bool },
      listener: { getter: b.any, capability: "heap" },
      localAddress: cached,
      localFamily: { getter: b.any, cache: true, capability: "js" },
      localPort: { getter: b.u16.optional, cache: true },
      pause: { capability: "js" },
      readyState: { getter: b.i32 },
      ref: { rustName: "js_ref" },
      reload: { ...js, args: { options: b.any } },
      remoteAddress: cached,
      remoteFamily: { getter: b.any, cache: true, capability: "js" },
      remotePort: { getter: b.u16.optional },
      renegotiate: js,
      resume: { capability: "js" },
      resumeSNI: { args: { context: b.any, isError: b.bool.loose }, capability: "js" },
      setKeepAlive: { ...js, args: { enable: b.bool.loose, initialDelay: b.any }, returns: b.bool },
      setKeyCert: { ...js, args: { context: b.any } },
      setMaxSendFragment: { ...method, args: { size: b.any } },
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
      upgradeTLS: { ...method, args: { options: b.any } },
      write,
      "@@dispose": { ...write, rustName: "end", length: 0 },
      endBuffered: { ...writeBuffered, privateSymbol: "end" },
      writeBuffered: { ...writeBuffered, privateSymbol: "write" },
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
export const getBytesRead = b.fn({ args: { socket: SocketHandle }, returns: b.f64 });
