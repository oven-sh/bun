import * as b from "../../codegen/bindgen-lib.ts";

export default b.module({ rustPath: "crate::socket::socket" });

const TCPSocket = b.classRef("TCPSocket");
const TLSSocket = b.classRef("TLSSocket");

export const NativeSocket = b.union({ tcp: TCPSocket, tls: TLSSocket });
/** The `_handle` of a `net.Socket`, which is not always one of ours. */
export const SocketHandle = b.union({ tcp: TCPSocket, tls: TLSSocket, other: b.any });

export const upgradeTLSDeferred = b.fn({
  args: { socket: NativeSocket, options: b.any },
  returns: b.any,
  capability: "js",
  throws: true,
});
export const releaseHeldFlight = b.fn({ args: { socket: SocketHandle } });
export const checkServerIdentityInHandshake = b.fn({ args: { socket: SocketHandle, inHandshake: b.bool } });
export const firstFlightBeforeFin = b.fn({ args: { socket: SocketHandle } });
export const isNamedPipeSocket = b.fn({ args: { socket: SocketHandle }, returns: b.bool });
export const getBufferedAmount = b.fn({ args: { socket: SocketHandle }, returns: b.usize });
