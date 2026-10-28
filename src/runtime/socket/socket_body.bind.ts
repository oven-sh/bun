import * as b from "../../codegen/bindgen-lib.ts";
import * as table from "../../codegen/builtins/lib.ts";
import { SecureContext } from "../api/bun/SecureContext.bind.ts";
import { ServerWebSocket } from "../server/server.bind.ts";
import { Listener } from "./Listener.bind.ts";
import { SocketHandler, UpgradeTLS } from "./SocketConfig.bind.ts";

export default b.module({ rustPath: "crate::socket::socket_body" });

const js = { capability: "js", throws: true } as const;
const textIfOpen = b.string.local.optional;
const cached = { getter: textIfOpen, cache: true, capability: "heap", throws: true } as const;
const write = {
  ...js,
  args: { data: b.opaque, byteOffset: b.opaque, byteLength: b.opaque, encoding: b.opaque },
  returns: b.i32,
  length: 3,
} as const;
const buffered = { ...js, args: { data: b.opaque, encoding: b.opaque } } as const;
const bufferIfAny = { returns: b.opaque.returning("Buffer", "undefined"), ...js } as const;
const objectIfAny = { returns: b.opaque.returning("object", "undefined"), ...js } as const;
/** Whether all of it was written, or the negative errno of a fatal send. */
export const BufferedWrite = b.union({ flushed: b.bool, errno: b.i32 });

export const coercedInt32 = b.i32.allowBigInt.wrap;

const secureContext = { type: SecureContext.withValue.emptyStringAsNull, expected: ["SecureContext"] } as const;
/** `secureContext` can also be in `tls`. */
export const UpgradeTLSOptions = b.dictionary(
  {
    /** Unset, the role of the socket. */
    isServer: b.bool.loose.emptyStringAsNull,
    /** Read as `SocketHandler`. */
    socket: b.opaque.optional,
    /** Bytes of the handshake that were already read. */
    initialData: b.opaque.emptyStringAsNull,
    secureContext,
    tls: UpgradeTLS.emptyStringAsNull,
    data: b.opaque.optional,
  },
  { deferred: true, reportedAs: "options" },
);
/** Returns the raw and the TLS halves, or `undefined` for a `TLSSocket`. */
const upgradeTLS = { ...js, returns: b.jsArray.optional } as const;

export const CipherInfo = b.dictionary({
  name: b.string.local.nullable,
  standardName: b.string.local.nullable,
  version: b.string.nullable,
});

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
      alpnProtocol: { ...js, getter: b.opaque.returning("string", "boolean") },
      authorized: { getter: b.bool, pure: true },
      bytesWritten: { getter: b.f64, pure: true },
      /** Can call the socket's handlers. */
      close: { capability: "js" },
      data: { setter: true, internalField: "data" },
      disableRenegotiation: {},
      end: write,
      exportKeyingMaterial: { ...bufferIfAny, args: { length: b.opaque, label: b.opaque, context: b.opaque } },
      fd: { getter: b.i64 },
      flush: { capability: "js" },
      getAuthorizationError: { returns: b.object.returning("Error").nullable, capability: "js" },
      getCertificate: objectIfAny,
      getCipher: { returns: CipherInfo.optional, capability: "heap", throws: true },
      getEphemeralKeyInfo: { returns: b.opaque.returning("object", "null"), ...js },
      getPeerCertificate: {
        ...js,
        args: { abbreviated: b.opaque },
        returns: b.opaque.returning("object", "undefined", "null"),
      },
      ...(ssl ? { getPeerX509Certificate: objectIfAny } : {}),
      getServername: { returns: b.string.utf8.optional },
      getSession: bufferIfAny,
      getSharedSigalgs: ssl ? { returns: b.array(b.string.utf8).nullable } : {},
      getTLSFinishedMessage: bufferIfAny,
      getTLSPeerFinishedMessage: bufferIfAny,
      getTLSTicket: bufferIfAny,
      getTLSVersion: { returns: b.string.utf8.nullable },
      getTypeOfService: { returns: b.i32 },
      ...(ssl ? { getX509Certificate: objectIfAny } : {}),
      isSessionReused: { returns: b.bool },
      listener: { getter: Listener.optional, capability: "heap" },
      localAddress: cached,
      localFamily: { getter: textIfOpen, cache: true, capability: "heap" },
      localPort: { getter: b.u16.optional, cache: true },
      pause: { capability: "js" },
      readyState: { getter: b.i32 },
      ref: { rustName: "js_ref" },
      reload: { ...js, args: { options: b.opaque } },
      remoteAddress: cached,
      remoteFamily: { getter: textIfOpen, cache: true, capability: "heap" },
      remotePort: { getter: b.u16.optional },
      renegotiate: js,
      resume: { capability: "js" },
      resumeSNI: { args: { context: SecureContext.otherAsNull, isError: b.bool.loose }, capability: "js" },
      setKeepAlive: {
        args: {
          enable: b.bool.loose,
          /** Milliseconds. */
          initialDelay: b.u32
            .validateIntegerRange(0, 2 ** 31 - 1)
            .nanAs(0)
            .default(0),
        },
        returns: b.bool,
        length: 2,
      },
      setKeyCert: { ...js, args: { context: SecureContext.otherAsNull }, length: 1 },
      setMaxSendFragment: { ...js, args: { size: b.f64.otherAsNull }, returns: b.bool, length: 1 },
      /** No argument enables it, `undefined` disables it. */
      setNoDelay: { args: { noDelay: b.bool.loose.ifPassed }, returns: b.bool, length: 1 },
      setServername: { ...js, args: { name: b.opaque } },
      setSession: { ...js, args: { session: b.opaque } },
      setTypeOfService: { args: { tos: b.i32.validateIntegerRange(0, 255).default(0) }, returns: b.i32, length: 1 },
      setVerifyMode: {
        ...js,
        args: { requestCert: b.bool.otherAsNull, rejectUnauthorized: b.bool.otherAsNull },
        length: 2,
      },
      shutdown: { args: { halfClose: b.bool.loose }, capability: "js" },
      terminate: { capability: "js" },
      timeout: { ...js, args: { seconds: b.opaque } },
      unref: { rustName: "js_unref" },
      upgradeTLS: { ...upgradeTLS, args: { options: UpgradeTLSOptions.otherAsNull }, length: 1 },
      write,
      "@@dispose": { ...write, rustName: "end", length: 0 },
      endBuffered: { ...buffered, returns: b.bool, privateSymbol: "end" },
      writeBuffered: { ...buffered, returns: BufferedWrite, privateSymbol: "write" },
    },
  });
}

export const TCPSocket = socket(false);
export const TLSSocket = socket(true);

export const BunSocket = b.union({ tcp: TCPSocket, tls: TLSSocket });
/** The `_handle` of a `net.Socket`: `new net.Socket({ handle })` keeps any object. */
export const SocketHandle = b.union({ tcp: TCPSocket, tls: TLSSocket, other: b.ignored });

export const upgradeTLSDeferred = b.fn({
  ...upgradeTLS,
  args: { socket: BunSocket, options: UpgradeTLSOptions.otherAsNull },
  length: 2,
});
export const releaseHeldFlight = b.fn({ args: { socket: SocketHandle } });
export const checkServerIdentityInHandshake = b.fn({ args: { socket: SocketHandle, inHandshake: b.bool } });
export const firstFlightBeforeFin = b.fn({ args: { socket: SocketHandle } });
export const isNamedPipeSocket = b.fn({ args: { socket: SocketHandle }, returns: b.bool });
export const getBufferedAmount = b.fn({ args: { socket: SocketHandle }, returns: b.usize });
/** `secureContext` can also be in `tls`. */
export const DuplexTLSOptions = b.dictionary({
  socket: SocketHandler,
  isServer: b.bool.loose.default(false),
  secureContext,
  tls: UpgradeTLS.emptyStringAsNull,
  data: b.opaque.optional,
});
/** Returns the `TLSSocket` and the listeners for the duplex's `data`, `end`, `drain` and `close`. */
/** `data` of the options is `data` of the new socket. */
export const upgradeDuplexToTLS = b.fn({
  ...js,
  args: { duplex: b.opaque, options: DuplexTLSOptions },
  returns: b.jsArray,
  uses: { options: [table.everything, table.memberStoredIn(["data"], table.nativeCell("Socket.data"))] },
});

// `bun:internal-for-testing`
export const createSocketPair = b.fn({ ...js, returns: b.array(b.i32) });
/** `other` is a `WebSocket` or the native handle of a node:http server socket. */
export const AnySocket = b.union({
  tcp: TCPSocket,
  tls: TLSSocket,
  serverWebSocket: ServerWebSocket,
  other: b.opaque,
});
export const setSocketOptions = b.fn({ ...js, args: { socket: AnySocket, option: b.i32, size: b.i32 } });
const testing = (name: string) => `crate::socket::socket_body::testing_apis::${name}`;
export const socketFaultInjectionAvailable = b.fn({
  returns: b.bool,
  rustPath: testing("socket_fault_injection_available"),
});
export const namedPipeContextLiveCount = b.fn({
  returns: b.usize,
  rustPath: testing("named_pipe_context_live_count"),
});
export const duplexUpgradeContextLiveCount = b.fn({
  returns: b.usize,
  rustPath: testing("duplex_upgrade_context_live_count"),
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
