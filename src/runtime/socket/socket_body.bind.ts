import * as b from "../../codegen/bindgen-lib.ts";

export default b.module({ rustPath: "crate::socket::socket_body" });

/** A handler of the socket can run inside. */
const runsJS = { capability: "js" } as const;
const js = { capability: "js", throws: true } as const;
const value = { ...js, returns: b.any } as const;
const cached = { ...js, getter: b.any, cache: true } as const;
const write = {
  ...value,
  args: { data: b.any, byteOffset: b.any, byteLength: b.any, encoding: b.any },
  length: 3,
} as const;
const writeBuffered = { ...value, args: { data: b.any, encoding: b.any } } as const;

/** What `Bun.connect()` resolves to and the `open` handler of `Bun.listen()` takes. */
function socket<SSL extends boolean>(ssl: SSL) {
  return b.class({
    rustPath: ssl ? "crate::socket::TLSSocket" : "crate::socket::TCPSocket",
    refCounted: true,
    finalize: true,
    configurable: false,
    memoryCost: true,
    /**
     * `handlers` is the `JSSocketHandlers` cell shared with the listener and its other sockets. The `duplex*` fields
     * are the stream and the four native listeners of a `TLSSocket` over a `Duplex`.
     */
    internalFields: [
      "handlers",
      "data",
      ...(ssl ? ["duplexOrigin", "duplexOnData", "duplexOnEnd", "duplexOnWritable", "duplexOnClose"] : []),
    ],
    proto: {
      alpnProtocol: { ...js, getter: b.any },
      authorized: { getter: b.bool },
      bytesWritten: { getter: b.f64 },
      close: runsJS,
      data: { internalField: "data", setter: true },
      disableRenegotiation: value,
      end: write,
      exportKeyingMaterial: { ...value, args: { length: b.any, label: b.any, context: b.any } },
      fd: { getter: b.any, capability: "heap" },
      flush: runsJS,
      getAuthorizationError: value,
      getCertificate: value,
      getCipher: value,
      getEphemeralKeyInfo: value,
      getPeerCertificate: { ...value, args: { abbreviated: b.any } },
      ...(ssl ? { getPeerX509Certificate: value } : {}),
      getServername: value,
      getSession: value,
      getSharedSigalgs: value,
      getTLSFinishedMessage: value,
      getTLSPeerFinishedMessage: value,
      getTLSTicket: value,
      getTLSVersion: value,
      getTypeOfService: { returns: b.i32 },
      ...(ssl ? { getX509Certificate: value } : {}),
      isSessionReused: value,
      listener: { getter: b.any, capability: "heap" },
      localAddress: cached,
      localFamily: cached,
      localPort: { getter: b.u16.optional, cache: true },
      pause: { ...runsJS, rustName: "pause_from_js" },
      readyState: { getter: b.i32 },
      ref: { rustName: "js_ref" },
      reload: { ...js, args: { options: b.any } },
      remoteAddress: cached,
      remoteFamily: cached,
      remotePort: { getter: b.u16.optional },
      renegotiate: value,
      resume: { ...runsJS, rustName: "resume_from_js" },
      resumeSNI: { ...runsJS, args: { context: b.any, isError: b.any } },
      setKeepAlive: { ...js, args: { enable: b.any, initialDelay: b.any }, returns: b.bool },
      setKeyCert: { ...value, args: { context: b.any } },
      setMaxSendFragment: { ...value, args: { size: b.any } },
      /** No argument enables it, `undefined` disables it. */
      setNoDelay: { args: { args: b.any.variadic }, returns: b.bool, length: 1 },
      setServername: { ...value, args: { name: b.any } },
      setSession: { ...value, args: { session: b.any } },
      setTypeOfService: { ...js, args: { tos: b.any }, returns: b.i32 },
      setVerifyMode: { ...value, args: { requestCert: b.any, rejectUnauthorized: b.any } },
      shutdown: { ...runsJS, args: { halfClose: b.any } },
      terminate: runsJS,
      timeout: { ...js, args: { seconds: b.any } },
      unref: { rustName: "js_unref" },
      upgradeTLS: { ...value, args: { options: b.any } },
      write,
      "@@dispose": { ...write, rustName: "end", length: 1 },
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
