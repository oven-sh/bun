import * as b from "../lib.ts";
import { socketDataCell, socketOptionsCell, socketsCell } from "./native-cells.ts";

export const memberOf = (operand: b.OperandName, ...path: b.MemberPath): b.PlaceSpec => ({
  place: "Member",
  operand,
  path,
});

// ToString of what lies at the end of the path: of an object, a function among them, it calls these three and nothing else.
export const convertedToString = (operand: b.OperandName, ...path: b.MemberPath) =>
  [
    { name: "@@toPrimitive", args: [b.string] },
    { name: "toString", args: [] },
    { name: "valueOf", args: [] },
  ].map(({ name, args }) =>
    b.memberCalled([...path, name], { times: "Once", this: memberOf(operand, ...path), args, result: "Ignored" }),
  );

// A sequence: native code asks what lies at the end of the path for its iterator and steps it, before the call returns.
export const iterated = (operand: b.OperandName, ...path: b.MemberPath) =>
  b.memberCalled([...path, "@@iterator"], {
    times: "Once",
    this: memberOf(operand, ...path),
    args: [],
    result: "Escapes",
  });

export const sequencesOfTLSOptions = ["ca", "cert", "key", "crl"];

export const tlsOptionNames = [
  "passphrase",
  "dhParamsFile",
  "serverName",
  "servername",
  "lowMemoryMode",
  "rejectUnauthorized",
  "requestCert",
  "ca",
  "cert",
  "key",
  "secureOptions",
  "minVersion",
  "maxVersion",
  "keyFile",
  "certFile",
  "caFile",
  "ALPNProtocols",
  "ciphers",
  "clientRenegotiationLimit",
  "clientRenegotiationWindow",
  "crl",
  "allowPartialTrustChain",
  "sessionTimeout",
  "sigalgs",
  "ecdhCurve",
];

const socketOptionNames = [
  "socket",
  "data",
  "binaryType",
  "allowHalfOpen",
  "hostname",
  "host",
  "port",
  "unix",
  "fd",
  "fdIsRawSocket",
  "localAddress",
  "localPort",
  "exclusive",
  "reusePort",
  "ipv6Only",
  "pauseOnConnect",
  "tls",
  "secureContext",
  ...tlsOptionNames,
];

// A socket is one object for as long as it lives.
export const socket = b.nativeCell(socketsCell);
export const newSocket = b.union(b.instance("TCPSocket"), b.instance("TLSSocket")).fresh;
const receivedChunk = b.union(b.instance("Buffer"), b.instance("Uint8Array").exactly, b.instance("ArrayBuffer")).fresh;

// socket_body.rs: the error is one that native code makes of a number of the system or of TLS, what another handler has thrown (call_error_handler), or nothing.
const socketHandlerArguments: Readonly<Record<string, readonly b.PlaceLike[]>> = {
  open: [socket],
  data: [socket, receivedChunk],
  close: [socket, b.thrown],
  drain: [socket],
  error: [socket, b.thrown],
  end: [socket],
  timeout: [socket],
  connectError: [socket, b.thrown],
  handshake: [socket, b.bool, b.thrown],
  session: [socket, b.instance("Buffer").fresh],
  keylog: [socket, b.instance("Buffer").fresh],
  alpnCallback: [socket, b.union(b.string, b.undefined), b.instance("Buffer").fresh],
  // The status of the write: 0, or a negative error number.
  writeComplete: [socket, b.f64],
};

// The data of the listener for a socket that it accepted, the socket's own for one that was upgraded, undefined where there is none.
const dataOfServer = [b.nativeCell(socketDataCell), b.undefined];

// SocketConfig.bind.ts and SSLConfig.bind.ts: a dictionary. Each member is read under its name and is of its type or refused, but these:
// `hostname`, `host` and `port` are converted, so is a String object as `binaryType`, and `ca`, `cert`, `key` and `crl` of `tls` may be a sequence, which is iterated.
// SecureContext.rs describes a `secureContext` that is none in its message: whatever is there may be printed.
export const socketOptions = [
  b.storedIn(b.nativeCell(socketOptionsCell)),
  b.reachableValuesStoredIn(b.nativeCell(socketOptionsCell)),
  b.runsTransitively(b.named(...socketOptionNames)),
  ...["hostname", "host", "port"].flatMap(name => convertedToString("options", name)),
  ...convertedToString("options", "socket", "binaryType"),
  ...sequencesOfTLSOptions.map(name => iterated("options", "tls", name)),
  b.memberStoredIn(["tls", "secureContext"], b.nativeMemory),
  b.createdIn(newSocket, socket),
  b.createdIn(newSocket, b.nativeMemory),
  b.memberStoredIn(["data"], b.nativeCell(socketDataCell)),
  ...Object.entries(socketHandlerArguments).map(([handler, args]) =>
    b.memberCalled(["socket", handler], { times: "PerEvent", this: socket, args, result: "Escapes" }),
  ),
  ...dataOfServer.map(data =>
    b.memberCalled(["socket", "serverName"], {
      times: "PerEvent",
      this: data,
      args: [data, b.string, socket],
      result: "Escapes",
    }),
  ),
];
