import * as b from "../../../codegen/bindgen-lib.ts";

const js = { capability: "js", throws: true } as const;
const objectIfOpen = { returns: b.any.returning("object", "undefined"), ...js } as const;
const certificate = { returns: b.any.returning("Buffer", "undefined"), ...js } as const;
const address = { returns: b.any.returning("SocketAddress", "undefined"), capability: "js" } as const;

/** `internalBinding("quic").Endpoint` of Node. */
export const QuicEndpoint = b.class({
  rustPath: "crate::node::quic::QuicEndpoint",
  construct: { passStructure: true, args: { options: b.any }, capability: "js", throws: true, length: 0 },
  proto: {
    address,
    closeGracefully: { capability: "js", passThis: true },
    connect: { ...objectIfOpen, args: { address: b.any, options: b.any, sessionTicket: b.any }, passThis: true },
    listen: { ...js, args: { options: b.any }, passThis: true },
    markBusy: { args: { busy: b.bool.loose } },
    releaseSocket: { capability: "js" },
    setSNIContexts: { ...js, args: { entries: b.any, replace: b.any } },
  },
});

export const QuicSession = b.class({
  rustPath: "crate::node::quic::QuicSession",
  proto: {
    applicationOptions: { returns: b.any.returning("object"), ...js },
    destroy: { ...js, args: { options: b.any } },
    getCertificate: certificate,
    getEphemeralKey: objectIfOpen,
    getLocalAddress: address,
    getPeerCertificate: certificate,
    getRemoteAddress: address,
    gracefulClose: { ...js, args: { options: b.any } },
    localTransportParams: objectIfOpen,
    openStream: { ...objectIfOpen, args: { direction: b.any, body: b.any }, passThis: true },
    remoteTransportParams: objectIfOpen,
    sendDatagram: { ...js, args: { data: b.any }, returns: b.any.returning("bigint") },
    updateKey: { returns: b.bool },
  },
});

export const QuicStream = b.class({
  rustPath: "crate::node::quic::QuicStream",
  proto: {
    abortForDestroy: { args: { stopSendingCode: b.any, resetCode: b.any }, capability: "js" },
    attachSource: { ...js, args: { source: b.any } },
    destroy: { ...js, args: { error: b.any } },
    endWrite: { capability: "js" },
    getPriority: { returns: b.u32 },
    getReader: { returns: b.self, passThis: true },
    initStreamingSource: {},
    pull: { ...js, args: { callback: b.any } },
    resetStream: { args: { code: b.any }, capability: "js" },
    sendHeaders: { ...js, args: { kind: b.any, headers: b.any, flags: b.any }, returns: b.any.returning("boolean") },
    setPriority: { ...js, args: { priority: b.any } },
    setWakeup: { args: { callback: b.any }, capability: "js" },
    stopSending: { args: { code: b.any }, capability: "js" },
    write: { ...js, args: { batch: b.any }, returns: b.any.returning("number", "undefined") },
  },
});
