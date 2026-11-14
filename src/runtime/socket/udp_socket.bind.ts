import * as b from "../../codegen/bindgen-lib.ts";
import * as table from "../../codegen/builtins/lib.ts";

export default b.module({ rustPath: "crate::socket::udp_socket" });

export const dgramIsFdAdopted = b.fn({ args: { fd: b.i32 }, returns: b.bool });
export const dgramNewSocketFd = b.fn({ args: { isIPv6: b.bool, isStream: b.bool }, returns: b.i32, throws: true });
export const dgramAdoptFd = b.fn({ args: { fd: b.i32 }, throws: true });
export const dgramBindFd = b.fn({
  args: { fd: b.i32, address: b.string.loose.utf8, port: b.i32.wrap, flags: b.i32.wrap },
  throws: true,
});
export const dgramGetSockNameFd = b.fn({ args: { fd: b.i32 }, returns: b.any, capability: "js", throws: true });
export const dgramGuessHandleType = b.fn({ args: { fd: b.i32 }, returns: b.string });
export const dgramListenFd = b.fn({ args: { fd: b.i32 }, throws: true });
export const dgramCloseFd = b.fn({ args: { fd: b.i32 }, throws: true });

const js = { capability: "js", throws: true } as const;
const membership = { ...js, args: { multicastAddress: b.any, interfaceAddress: b.any }, returns: b.bool } as const;
const sourceSpecificMembership = {
  ...js,
  args: { sourceAddress: b.any, groupAddress: b.any, interfaceAddress: b.any },
  returns: b.bool,
} as const;

/** What `Bun.udpSocket()` resolves to. */
export const UDPSocket = b.class({
  rustPath: "crate::socket::udp_socket::UDPSocket",
  types: [table.exactType("$Node.UDPSocketHandle"), table.exactType("$Bindgen.UDPSocket")],
  internalFields: ["onData", "onDrain", "onError"],
  proto: {
    addMembership: membership,
    address: { ...js, getter: b.any.returning("object", "undefined"), cache: true },
    addSourceSpecificMembership: sourceSpecificMembership,
    binaryType: { ...js, getter: b.any.returning("string"), cache: true },
    close: {},
    closed: { getter: b.bool, pure: true },
    dropMembership: membership,
    dropSourceSpecificMembership: sourceSpecificMembership,
    fd: { getter: b.i32 },
    hostname: { ...js, getter: b.any.returning("string"), cache: true },
    port: { getter: b.i32.optional, cache: true },
    ref: {},
    reload: { ...js, passThis: true, args: { options: b.any } },
    remoteAddress: { ...js, getter: b.any.returning("object", "undefined"), cache: true },
    /** `(data)` when connected, `(data, port, address)` when not. */
    send: { ...js, args: { data: b.any, port: b.any, address: b.any }, returns: b.bool },
    sendMany: { ...js, args: { packets: b.any }, returns: b.i32, length: 3 },
    setBroadcast: { ...js, args: { enabled: b.any }, returns: b.any },
    setMulticastInterface: { ...js, args: { interfaceAddress: b.any }, returns: b.bool },
    setMulticastLoopback: { ...js, args: { enabled: b.any }, returns: b.any },
    setMulticastTTL: { ...js, args: { ttl: b.any }, returns: b.i32 },
    setTTL: { ...js, args: { ttl: b.any }, returns: b.i32 },
    unref: {},
    "@@dispose": { rustName: "close" },
  },
});

/** `options` is what `UDPSocketConfig` takes. Returns a promise of the socket. */
export const udpSocket = b.fn({
  ...js,
  args: { options: b.any },
  returns: b.any,
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
