import * as b from "../../codegen/bindgen-lib.ts";
import { SecureContext } from "../api/bun/SecureContext.bind.ts";
import { ServerWebSocket } from "../server/server.bind.ts";
import { Blob } from "../webcore/Blob.bind.ts";
import { Request, Response } from "../webcore/response.bind.ts";
import { Listener } from "./Listener.bind.ts";
import { SocketHandler, SocketReloadOptions, UpgradeTLS } from "./SocketConfig.bind.ts";

export default b.module({ rustPath: "crate::socket::socket_body" });

const js = { capability: "js", throws: true } as const;
const buffer = { ...js, returns: b.bufferSource.optional } as const;
const address = { getter: b.string.local.optional, cache: true, capability: "heap", throws: true } as const;
const family = { getter: b.string.local.optional, cache: true, capability: "heap" } as const;
const certificate = { ...js, returns: b.object.optional } as const;

export const looseString = b.conversion(b.string.loose);

/** What a socket writes. A `String` object is converted after the encoding. */
export const SocketData = b.union({
  none: b.undefined,
  text: b.string,
  bytes: b.bufferSource.allowShared,
  blob: Blob,
  request: Request,
  response: Response,
  stringObject: b.stringObject,
  other: b.ignored,
});
/**
 * `byteOffset`, `byteLength` or `encoding`. A string or a `String` object in the place of the first two is the encoding.
 * `stringObject` and `other` are converted only as the encoding of data that an open socket writes.
 */
export const SocketWriteOption = b.union({
  none: b.undefined,
  number: b.f64,
  text: b.string,
  stringObject: b.stringObject,
  other: b.opaque,
});
const write = {
  ...js,
  args: {
    data: SocketData.withValue,
    byteOffset: SocketWriteOption,
    byteLength: SocketWriteOption,
    encoding: SocketWriteOption,
  },
  returns: b.i32,
  length: 3,
} as const;
const writeBuffered = { ...js, args: { data: SocketData.withValue, encoding: SocketWriteOption }, length: 2 } as const;
/** Whether all of it was written, or the negative errno of a fatal send. */
export const BufferedWrite = b.union({ flushed: b.bool, errno: b.i32 });

export const TextOrBytes = b.union({
  none: b.undefined,
  text: b.string,
  bytes: b.bufferSource.allowShared,
  stringObject: b.stringObject,
  other: b.ignored,
});
export const OptionalBool = b.union({ none: b.undefined, value: b.bool, other: b.ignored });
/** Both wrap to an `i32`. */
export const CoercedInt32 = b.union({ bigInt: b.i64.asIntN, other: b.i32.wrap }, { fromJS: true });
/** A number saturates. `other` is converted once the socket is known to be open. */
export const TimeoutSeconds = b.union({ number: b.f64, other: b.opaque });

/** `secureContext` can also be in `tls`. */
export const UpgradeTLSOptions = b.dictionary(
  {
    /** Unset, the role of the socket. */
    isServer: b.bool.loose.emptyStringAsNull,
    /** Read as `SocketHandler`. */
    socket: b.opaque.optional,
    /** Bytes of the handshake that were already read. */
    initialData: TextOrBytes,
    secureContext: b.opaque.emptyStringAsNull,
    tls: UpgradeTLS.emptyStringAsNull,
    data: b.opaque.optional,
  },
  { deferred: true, reportedAs: "options" },
);
/** Returns the raw and the TLS halves, or `undefined` for a `TLSSocket`. */
const upgradeTLS = { ...js, returns: b.jsArray.optional } as const;

/** `false` when none was negotiated. */
export const ALPNProtocol = b.union({ none: b.bool, protocol: b.string.local });
export const CipherInfo = b.dictionary({
  name: b.string.local.nullable,
  standardName: b.string.local.nullable,
  version: b.string.nullable,
});
/** Empty when the handshake had no key exchange of its own. */
export const EphemeralKeyInfo = b.dictionary({
  type: b.string.optional,
  name: b.string.optional,
  size: b.i32.optional,
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
      alpnProtocol: { getter: ALPNProtocol, capability: "heap", throws: true },
      authorized: { getter: b.bool },
      bytesWritten: { getter: b.f64 },
      /** Can call the socket's handlers. */
      close: { capability: "js" },
      data: { setter: true, internalField: "data" },
      disableRenegotiation: {},
      end: write,
      exportKeyingMaterial: {
        ...buffer,
        args: {
          length: b.f64.otherAsNull,
          label: b.string.allowStringObject.otherAsNull.deferred,
          context: TextOrBytes,
        },
        length: 3,
      },
      fd: { getter: b.i64 },
      flush: { capability: "js" },
      getAuthorizationError: { returns: b.object.nullable, capability: "js" },
      getCertificate: certificate,
      getCipher: { returns: CipherInfo.optional, capability: "heap", throws: true },
      getEphemeralKeyInfo: { returns: EphemeralKeyInfo.nullable },
      getPeerCertificate: {
        ...js,
        args: { abbreviated: OptionalBool },
        returns: ssl ? b.object.optional : b.object.nullable,
      },
      ...(ssl ? { getPeerX509Certificate: certificate } : {}),
      getServername: { returns: b.string.utf8.optional },
      getSession: buffer,
      getSharedSigalgs: ssl ? { returns: b.array(b.string.utf8).nullable } : {},
      getTLSFinishedMessage: buffer,
      getTLSPeerFinishedMessage: buffer,
      getTLSTicket: buffer,
      getTLSVersion: { returns: b.string.utf8.nullable },
      getTypeOfService: { returns: b.i32 },
      ...(ssl ? { getX509Certificate: certificate } : {}),
      isSessionReused: { returns: b.bool },
      listener: { getter: Listener.optional, capability: "heap" },
      localAddress: address,
      localFamily: family,
      localPort: { getter: b.u16.optional, cache: true },
      pause: { capability: "js" },
      readyState: { getter: b.i32 },
      ref: { rustName: "js_ref" },
      reload: { ...js, args: { options: SocketReloadOptions.otherAsNull }, length: 1 },
      remoteAddress: address,
      remoteFamily: family,
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
      setServername: { ...js, args: { name: b.string.allowStringObject.otherAsNull.deferred }, length: 1 },
      setSession: { ...js, args: { session: TextOrBytes }, length: 1 },
      setTypeOfService: { args: { tos: b.i32.validateIntegerRange(0, 255).default(0) }, returns: b.i32, length: 1 },
      setVerifyMode: {
        ...js,
        args: { requestCert: b.bool.otherAsNull, rejectUnauthorized: b.bool.otherAsNull },
        length: 2,
      },
      shutdown: { args: { halfClose: b.bool.loose }, capability: "js" },
      terminate: { capability: "js" },
      timeout: { ...js, args: { seconds: TimeoutSeconds } },
      unref: { rustName: "js_unref" },
      upgradeTLS: { ...upgradeTLS, args: { options: UpgradeTLSOptions.otherAsNull }, length: 1 },
      write,
      "@@dispose": { ...write, rustName: "end", length: 0 },
      endBuffered: { ...writeBuffered, returns: b.bool, privateSymbol: "end" },
      writeBuffered: { ...writeBuffered, returns: BufferedWrite, privateSymbol: "write" },
    },
  });
}

export const TCPSocket = socket(false);
export const TLSSocket = socket(true);

export const BunSocket = b.union({ tcp: TCPSocket, tls: TLSSocket });
/** The `_handle` of a `net.Socket`: `new net.Socket({ handle })` keeps any object. */
export const SocketHandle = b.union({ tcp: TCPSocket, tls: TLSSocket, ignored: b.ignored });

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
  secureContext: b.opaque.emptyStringAsNull,
  tls: UpgradeTLS.emptyStringAsNull,
  data: b.opaque.optional,
});
/** Returns the `TLSSocket` and the listeners for the duplex's `data`, `end`, `drain` and `close`. */
export const upgradeDuplexToTLS = b.fn({
  ...js,
  args: { duplex: b.object.otherAsNull, options: DuplexTLSOptions },
  returns: b.jsArray,
  length: 2,
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
