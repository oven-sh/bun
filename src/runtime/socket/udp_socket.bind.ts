import * as b from "../../codegen/bindgen-lib.ts";

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
const membership = { ...js, args: { address: b.any, interfaceAddress: b.any }, returns: b.bool };
const sourceSpecificMembership = {
  ...js,
  args: { source: b.any, group: b.any, interfaceAddress: b.any },
  returns: b.bool,
};

/** What `Bun.udpSocket()` resolves to. */
export const UDPSocket = b.class({
  rustPath: "crate::socket::udp_socket::UDPSocket",
  configurable: false,
  /** The handlers of the options. */
  internalFields: ["onData", "onDrain", "onError"],
  proto: {
    addMembership: membership,
    address: { ...js, getter: b.any, cache: true },
    addSourceSpecificMembership: sourceSpecificMembership,
    binaryType: { ...js, getter: b.any, cache: true },
    close: {},
    closed: { getter: b.bool },
    dropMembership: membership,
    dropSourceSpecificMembership: sourceSpecificMembership,
    fd: { getter: b.i32 },
    hostname: { ...js, getter: b.any, cache: true },
    port: { getter: b.i32.optional, cache: true },
    ref: { rustName: "ref_" },
    reload: { ...js, args: { options: b.any } },
    remoteAddress: { ...js, getter: b.any, cache: true },
    /** `(payload)` when connected, `(payload, port, address)` when not. */
    send: { ...js, args: { args: b.any.variadic }, returns: b.bool, length: 3 },
    sendMany: { ...js, args: { packets: b.any }, returns: b.i32, length: 3 },
    setBroadcast: { ...js, args: { enabled: b.any }, returns: b.any },
    setMulticastInterface: { ...js, args: { address: b.any }, returns: b.bool },
    setMulticastLoopback: { ...js, args: { enabled: b.any }, returns: b.any },
    setMulticastTTL: { ...js, args: { ttl: b.any }, returns: b.i32 },
    setTTL: { ...js, args: { ttl: b.any }, returns: b.i32 },
    unref: {},
    "@@dispose": { rustName: "close", length: 1 },
  },
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
export const getFd = b.fn({ args: { socket: UDPSocket }, returns: b.i32 });
