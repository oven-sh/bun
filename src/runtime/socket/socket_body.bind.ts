import * as b from "../../codegen/bindgen-lib.ts";
import { SecureContext } from "../api/bun/SecureContext.bind.ts";

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

/** Members of the trait `TlsHandle`. */
const tlsHandle = {
  alpnProtocol: { ...js, getter: b.any },
  disableRenegotiation: {},
  exportKeyingMaterial: { ...method, args: { length: b.any, label: b.any, context: b.any } },
  getCertificate: method,
  getCipher: method,
  getEphemeralKeyInfo: method,
  getPeerCertificate: { ...method, args: { abbreviated: b.any } },
  getPeerX509Certificate: method,
  getServername: method,
  getSession: method,
  getSharedSigalgs: method,
  getTLSFinishedMessage: method,
  getTLSPeerFinishedMessage: method,
  getTLSTicket: method,
  getTLSVersion: method,
  getX509Certificate: method,
  isSessionReused: { returns: b.bool },
  renegotiate: js,
  resumeSNI: { args: { context: SecureContext.nullable, isError: b.bool.loose }, capability: "js" },
  setKeyCert: { ...js, args: { context: b.any } },
  setMaxSendFragment: { ...method, args: { size: b.any } },
  setSession: { ...js, args: { session: b.any } },
} as const;
const rustTraits = ["crate::socket::socket_body::TlsHandle"];
/** The order `for-in` shows. */
const byName = <T extends object>(members: T) =>
  Object.fromEntries(Object.entries(members).sort(([a], [b]) => (a < b ? -1 : 1))) as T;

/** What `Bun.connect()` resolves to and the `open` handler of `Bun.listen()` takes. */
function socket<SSL extends boolean>(ssl: SSL) {
  return b.class({
    rustPath: ssl ? "crate::socket::TLSSocket" : "crate::socket::TCPSocket",
    refCounted: true,
    finalize: true,
    memoryCost: true,
    rustTraits,
    /** `handlers` is shared with the listener and its other sockets. `duplex*` serve a `TLSSocket` over a `Duplex`. */
    internalFields: [
      "handlers",
      "data",
      ...(ssl ? ["duplexOrigin", "duplexOnData", "duplexOnEnd", "duplexOnClose"] : []),
    ],
    proto: {
      ...byName({
        ...tlsHandle,
        authorized: { getter: b.bool },
        bytesWritten: { getter: b.f64 },
        /** Can call the socket's handlers. */
        close: { capability: "js" },
        data: { setter: true, internalField: "data" },
        end: write,
        fd: { getter: b.any, capability: "heap" },
        flush: { capability: "js" },
        getAuthorizationError: { returns: b.any, capability: "js" },
        getTypeOfService: { returns: b.i32 },
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
        resume: { capability: "js" },
        setKeepAlive: { ...js, args: { enable: b.bool.loose, initialDelay: b.any }, returns: b.bool },
        /** No argument enables it, `undefined` disables it. */
        setNoDelay: { args: { noDelay: b.any.variadic }, returns: b.bool, length: 1 },
        setServername: { ...js, args: { name: b.any } },
        setTypeOfService: { ...js, args: { tos: b.any }, returns: b.i32 },
        setVerifyMode: { ...js, args: { requestCert: b.any, rejectUnauthorized: b.any } },
        shutdown: { args: { halfClose: b.bool.loose }, capability: "js" },
        terminate: { capability: "js" },
        timeout: { ...js, args: { seconds: b.any } },
        unref: { rustName: "js_unref" },
        upgradeTLS: { ...method, args: { options: b.any } },
        write,
      }),
      "@@dispose": { ...write, rustName: "end", length: 0 },
      writeBuffered: { ...writeBuffered, privateSymbol: "write" },
    },
  });
}

export const TCPSocket = socket(false);
export const TLSSocket = socket(true);

/** `req.socket[kTLSHandle]` of a `node:https` server. `socket` is the `NodeHTTPServerSocket` of the connection, which uWS owns. */
export const NodeHTTPServerSocketTLS = b.class({
  rustPath: "crate::socket::socket_body::NodeHTTPServerSocketTLS",
  rustTraits,
  construct: { args: { socket: b.any }, capability: "js", passStructure: true },
  internalFields: ["socket"],
  proto: tlsHandle,
});

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
