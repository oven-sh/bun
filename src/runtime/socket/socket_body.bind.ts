import * as b from "../../codegen/bindgen-lib.ts";
import { SecureContext } from "../api/bun/SecureContext.bind.ts";
import { ServerWebSocket } from "../server/server.bind.ts";

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
const byName = <const T extends object>(members: T) =>
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
        /** Node's `handle.writeQueueSize`, for the `_handle` of a `net.Socket`. */
        writeQueueSize: { getter: b.f64, enumerable: false },
      }),
      "@@dispose": { ...write, rustName: "end", length: 0 },
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
export const upgradeDuplexToTLS = b.fn({
  args: { duplex: b.any, options: b.any },
  returns: b.any,
  capability: "js",
  throws: true,
});
export const releaseHeldFlight = b.fn({ args: { socket: SocketHandle } });
export const checkServerIdentityInHandshake = b.fn({ args: { socket: SocketHandle, inHandshake: b.bool } });
export const firstFlightBeforeFin = b.fn({ args: { socket: SocketHandle } });
export const isNamedPipeSocket = b.fn({ args: { socket: SocketHandle }, returns: b.bool });
export const getBytesRead = b.fn({ args: { socket: SocketHandle }, returns: b.f64 });

// `bun:internal-for-testing`
export const createSocketPair = b.fn({ ...js, returns: b.array(b.i32) });
/** `other` is a `WebSocket` or the native handle of a node:http server socket. */
export const AnySocket = b.union({ tcp: TCPSocket, tls: TLSSocket, serverWebSocket: ServerWebSocket, other: b.any });
export const setSocketOptions = b.fn({ ...js, args: { socket: AnySocket, option: b.i32, size: b.i32 } });
const testing = (name: string) => `crate::socket::socket_body::testing_apis::${name}`;
export const socketFaultInjectionAvailable = b.fn({
  returns: b.bool,
  rustPath: testing("socket_fault_injection_available"),
});
export const namedPipeLiveCount = b.fn({ returns: b.usize, rustPath: testing("named_pipe_live_count") });
export const upgradedDuplexLiveCount = b.fn({ returns: b.usize, rustPath: testing("upgraded_duplex_live_count") });
/** `count` is truncated and clamped to an `i32`. */
export const sweepSocketTimers = b.fn({
  ...js,
  args: { count: b.f64.loose.allowBigInt },
  rustPath: testing("sweep_socket_timers"),
});
export const clearSocketFaults = b.fn({ ...js, rustPath: testing("clear_socket_faults") });
/** `socket`, `close` and `shutdown` have no hook in bsd.c: a rule for one would never fire. */
export const SocketFaultSyscall = b.enumeration([
  "recv",
  "send",
  "writev",
  "sendmsg",
  "recvmsg",
  "connect",
  "accept",
  "ssl_loop_buffer",
  "poll_start",
  "session_buffer",
  "ssl_write",
]);
export const SocketFaultAction = b.enumeration(["errno", "short", "zero", "excess", "none"]);
export const SocketFaultErrnoName = b.enumeration([
  "ECONNRESET",
  "EPIPE",
  "ETIMEDOUT",
  "ECONNREFUSED",
  "EAGAIN",
  "EWOULDBLOCK",
  "EINTR",
  "ENOBUFS",
  "ENOMEM",
  "EBADF",
  "EINVAL",
  "ENETUNREACH",
  "EHOSTUNREACH",
  "EPROTOTYPE",
  "EMFILE",
  "EPERM",
]);
export const SocketFaultErrno = b.union({ name: SocketFaultErrnoName, code: b.i32 });
const count = b.i32.wrap.emptyStringAsNull;
export const SocketFaultRule = b.dictionary(
  {
    syscall: SocketFaultSyscall,
    action: SocketFaultAction,
    /** `errno` is a macro in C++. */
    errno: { type: SocketFaultErrno.emptyStringAsNull, rustName: "error" },
    bytes: count,
    fd: count,
    after: count,
    repeat: count,
  },
  { reportedAs: "rule" },
);
export const setSocketFault = b.fn({
  ...js,
  args: { rule: SocketFaultRule },
  returns: b.bool,
  rustPath: testing("set_socket_fault"),
});
