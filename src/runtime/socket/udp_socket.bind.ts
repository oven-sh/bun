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

const UDPSocket = b.classRef("UDPSocket");

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
