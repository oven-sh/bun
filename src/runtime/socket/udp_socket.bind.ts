import * as b from "../../codegen/bindgen-lib.ts";
import * as table from "../../codegen/builtins/lib.ts";
import { coercedInt32 } from "./socket_body.bind.ts";

export default b.module({ rustPath: "crate::socket::udp_socket" });

export const dgramIsFdAdopted = b.fn({ args: { fd: b.i32 }, returns: b.bool });
export const dgramNewSocketFd = b.fn({ args: { isIPv6: b.bool, isStream: b.bool }, returns: b.i32, throws: true });
export const dgramAdoptFd = b.fn({ args: { fd: b.i32 }, throws: true });
export const dgramBindFd = b.fn({
  args: { fd: b.i32, address: b.string.loose.utf8, port: b.i32.wrap, flags: b.i32.wrap },
  throws: true,
});
/** `{ address, port, family }` */
const socketAddress = b.object.optional;
export const dgramGetSockNameFd = b.fn({ args: { fd: b.i32 }, returns: socketAddress, capability: "js", throws: true });
export const dgramGuessHandleType = b.fn({ args: { fd: b.i32 }, returns: b.string });
export const dgramListenFd = b.fn({ args: { fd: b.i32 }, throws: true });
export const dgramCloseFd = b.fn({ args: { fd: b.i32 }, throws: true });

const js = { capability: "js", throws: true } as const;
/** `other` is converted to a string where the address is parsed. */
export const UDPAddress = b.union({ missing: b.undefined, text: b.string, other: b.opaque });
/** `other` is converted to a number where the port is checked. */
export const UDPPort = b.union({ missing: b.undefined, number: b.f64, other: b.opaque });
export const looseNumber = b.conversion(b.f64.loose);
/** `string` is converted after the destination. */
export const UDPPayload = b.union({
  buffer: b.bufferSource.allowShared,
  string: b.stringLike,
  other: b.ignored,
});
const membership = {
  ...js,
  args: { multicastAddress: UDPAddress, interfaceAddress: UDPAddress },
  returns: b.bool,
} as const;
const sourceSpecificMembership = {
  ...js,
  args: { sourceAddress: UDPAddress, groupAddress: UDPAddress, interfaceAddress: UDPAddress },
  returns: b.bool,
} as const;
/** Returns `enabled` as it was passed. */
const flag = { ...js, args: { enabled: b.bool.loose.withValue }, returns: b.opaque } as const;
const ttl = { ...js, args: { ttl: coercedInt32.deferred }, returns: b.i32 } as const;

const callback = (name: string) => ({
  type: b.callable.emptyStringAsNull,
  expected: `Expected "socket.${name}" to be a function`,
});
export const UDPSocketHandler = b.dictionary(
  { data: callback("data"), drain: callback("drain"), error: callback("error") },
  { deferred: true },
);
/** A `String` object is converted after the port. */
export const UDPConnectHostname = b.union({ text: b.string, stringObject: b.stringObject });
export const UDPConnectOptions = b.dictionary(
  {
    hostname: { type: UDPConnectHostname.emptyStringAsNull, expected: 'Expected "connect.hostname" to be a string' },
    port: b.f64.loose.emptyStringAsNull,
  },
  { deferred: true },
);
export const UDPSocketOptions = b.dictionary(
  {
    port: b.f64.loose.emptyStringAsNull,
    flags: b.i32.validateInteger().reportedAs("options.flags").emptyStringAsNull,
    /** An already created socket to adopt. */
    fd: b.i32.validateInteger().reportedAs("options.fd").nullable,
    hostname: { type: b.string.allowStringObject.emptyStringAsNull, expected: 'Expected "hostname" to be a string' },
    /** node:dgram sets it for a descriptor that cluster workers share. */
    sharedFd: { type: b.bool.loose.default(false), privateSymbol: "sharedFd" },
    socket: { type: UDPSocketHandler.emptyStringAsNull, expected: 'Expected "socket" to be an object' },
    /** Read when there is a `socket`. */
    binaryType: {
      type: b.string.allowStringObject.emptyStringAsNull,
      expected: 'Expected "socket.binaryType" to be a string',
    },
    connect: { type: UDPConnectOptions.emptyStringAsNull, expected: 'Expected "connect" to be an object' },
  },
  { deferred: true, reportedAs: "" },
);

/** What `Bun.udpSocket()` resolves to. */
export const UDPSocket = b.class({
  rustPath: "crate::socket::udp_socket::UDPSocket",
  types: [table.exactType("$Node.UDPSocketHandle"), table.exactType("$Bindgen.UDPSocket")],
  internalFields: ["onData", "onDrain", "onError"],
  proto: {
    addMembership: membership,
    address: { ...js, getter: socketAddress, cache: true },
    addSourceSpecificMembership: sourceSpecificMembership,
    binaryType: { ...js, getter: b.string.local, cache: true },
    close: {},
    closed: { getter: b.bool, pure: true },
    dropMembership: membership,
    dropSourceSpecificMembership: sourceSpecificMembership,
    fd: { getter: b.i32 },
    hostname: { getter: b.string, cache: true },
    port: { getter: b.i32.optional, cache: true },
    ref: {},
    reload: { ...js, passThis: true, args: { options: UDPSocketOptions.otherAsNull }, length: 1 },
    remoteAddress: { ...js, getter: socketAddress, cache: true },
    /** `(data)` when connected, `(data, port, address)` when not. */
    send: { ...js, args: { data: UDPPayload, port: UDPPort, address: UDPAddress }, returns: b.bool },
    /** Payloads when connected, else a payload, a port and an address for each packet. */
    sendMany: { ...js, args: { packets: b.jsArray.otherAsNull }, returns: b.i32, length: 3 },
    setBroadcast: flag,
    setMulticastInterface: { ...js, args: { interfaceAddress: UDPAddress }, returns: b.bool },
    setMulticastLoopback: flag,
    setMulticastTTL: ttl,
    setTTL: ttl,
    unref: {},
    "@@dispose": { rustName: "close" },
  },
});

/** `options` is what `UDPSocketConfig` takes. Returns a promise of the socket. */
export const udpSocket = b.fn({
  ...js,
  args: { options: UDPSocketOptions.otherAsNull },
  returns: b.promise,
  length: 1,
  rustPath: "crate::socket::udp_socket::UDPSocket::udp_socket",
});

export const connect = b.fn({
  args: { socket: UDPSocket, host: b.string.loose, port: b.i32 },
  capability: "js",
  throws: true,
});
export const disconnect = b.fn({
  args: { socket: UDPSocket },
  capability: "heap",
  throws: true,
});
export const bufferSize = b.fn({
  args: { socket: UDPSocket, size: b.i32.wrap, isRecv: b.bool },
  returns: b.i32,
  throws: true,
});
export const getFd = b.fn({
  args: { socket: UDPSocket },
  returns: b.i32,
  rustPath: "crate::socket::udp_socket::UDPSocket::get_fd",
});
