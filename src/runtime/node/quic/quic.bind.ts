import * as b from "../../../codegen/bindgen-lib.ts";

const js = { capability: "js", throws: true, returns: b.any } as const;

/** `internalBinding("quic").Endpoint` of Node. */
export const QuicEndpoint = b.class({
  rustPath: "crate::node::quic::QuicEndpoint",
  configurable: false,
  construct: { args: { options: b.any }, capability: "js", throws: true, length: 0, passStructure: true },
  proto: {
    address: js,
    closeGracefully: { ...js, passThis: true },
    connect: { ...js, args: { address: b.any, options: b.any, sessionTicket: b.any }, passThis: true },
    listen: { ...js, args: { options: b.any }, passThis: true },
    markBusy: { args: { busy: b.any } },
    releaseSocket: js,
    setSNIContexts: { ...js, args: { entries: b.any, replace: b.any } },
  },
});

export const QuicSession = b.class({
  rustPath: "crate::node::quic::QuicSession",
  configurable: false,
  proto: {
    applicationOptions: js,
    destroy: { ...js, args: { options: b.any } },
    getCertificate: js,
    getEphemeralKey: js,
    getLocalAddress: js,
    getPeerCertificate: js,
    getRemoteAddress: js,
    gracefulClose: { ...js, args: { options: b.any } },
    localTransportParams: js,
    openStream: { ...js, args: { direction: b.any, body: b.any }, passThis: true },
    remoteTransportParams: js,
    sendDatagram: { ...js, args: { data: b.any } },
    updateKey: { returns: b.bool },
  },
});

export const QuicStream = b.class({
  rustPath: "crate::node::quic::QuicStream",
  configurable: false,
  proto: {
    abortForDestroy: { ...js, args: { stopSendingCode: b.any, resetCode: b.any } },
    attachSource: { ...js, args: { source: b.any } },
    destroy: { ...js, args: { error: b.any } },
    endWrite: js,
    getPriority: { returns: b.u32 },
    getReader: { returns: b.self, passThis: true },
    initStreamingSource: js,
    pull: { ...js, args: { callback: b.any } },
    resetStream: { ...js, args: { code: b.any } },
    sendHeaders: { ...js, args: { kind: b.any, headers: b.any, flags: b.any } },
    setPriority: { ...js, args: { priority: b.any } },
    setWakeup: { ...js, args: { callback: b.any } },
    stopSending: { ...js, args: { code: b.any } },
    write: { ...js, args: { batch: b.any } },
  },
});
