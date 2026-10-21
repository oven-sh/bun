import * as b from "../../../codegen/bindgen-lib.ts";

const js = { capability: "js", throws: true } as const;
const method = { returns: b.any, ...js } as const;

/** `internalBinding("quic").Endpoint` of Node. */
export const QuicEndpoint = b.class({
  rustPath: "crate::node::quic::QuicEndpoint",
  configurable: false,
  construct: { args: { options: b.any }, capability: "js", throws: true, length: 0, passStructure: true },
  proto: {
    address: method,
    closeGracefully: { capability: "js", passThis: true },
    connect: { ...method, args: { address: b.any, options: b.any, sessionTicket: b.any }, passThis: true },
    listen: { ...js, args: { options: b.any }, passThis: true },
    markBusy: { args: { busy: b.any } },
    releaseSocket: { capability: "js" },
    setSNIContexts: { ...js, args: { entries: b.any, replace: b.any } },
  },
});

export const QuicSession = b.class({
  rustPath: "crate::node::quic::QuicSession",
  configurable: false,
  proto: {
    applicationOptions: method,
    destroy: { ...js, args: { options: b.any } },
    getCertificate: method,
    getEphemeralKey: method,
    getLocalAddress: method,
    getPeerCertificate: method,
    getRemoteAddress: method,
    gracefulClose: { ...js, args: { options: b.any } },
    localTransportParams: method,
    openStream: { ...method, args: { direction: b.any, body: b.any }, passThis: true },
    remoteTransportParams: method,
    sendDatagram: { ...method, args: { data: b.any } },
    updateKey: { returns: b.bool },
  },
});

export const QuicStream = b.class({
  rustPath: "crate::node::quic::QuicStream",
  configurable: false,
  proto: {
    abortForDestroy: { capability: "js", args: { stopSendingCode: b.any, resetCode: b.any } },
    attachSource: { ...js, args: { source: b.any } },
    destroy: { ...js, args: { error: b.any } },
    endWrite: { capability: "js" },
    getPriority: { returns: b.u32 },
    getReader: { returns: b.self, passThis: true },
    initStreamingSource: {},
    pull: { ...js, args: { callback: b.any } },
    resetStream: { capability: "js", args: { code: b.any } },
    sendHeaders: { ...method, args: { kind: b.any, headers: b.any, flags: b.any } },
    setPriority: { ...js, args: { priority: b.any } },
    setWakeup: { capability: "js", args: { callback: b.any } },
    stopSending: { capability: "js", args: { code: b.any } },
    write: { ...method, args: { batch: b.any } },
  },
});
