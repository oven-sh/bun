import * as b from "../../../codegen/bindgen-lib.ts";
import { SocketAddress } from "../../socket/SocketAddress.bind.ts";
import { BlockList } from "../net/BlockList.bind.ts";

const js = { capability: "js", throws: true } as const;
const objectIfOpen = { returns: b.opaque.returning("object", "undefined"), ...js } as const;
const certificate = { returns: b.opaque.returning("Buffer", "undefined"), ...js } as const;
const address = { returns: b.opaque.returning("SocketAddress", "undefined"), capability: "js" } as const;

/** A member of another type is ignored. */
export const EndpointOptions = b.dictionary(
  {
    address: SocketAddress.withValue.otherAsNull,
    blockList: BlockList.withValue.otherAsNull,
    blockListPolicy: b.string.allowStringObject.otherAsNull,
    disableStatelessReset: b.bool.otherAsNull,
    statelessResetBurst: b.f64.otherAsNull,
    statelessResetRate: b.f64.otherAsNull,
  },
  { allowArray: true, nonObjectAsEmpty: true },
);

/** `internalBinding("quic").Endpoint` of Node. */
export const QuicEndpoint = b.class({
  rustPath: "crate::node::quic::QuicEndpoint",
  construct: { passStructure: true, args: { options: EndpointOptions }, capability: "js", throws: true, length: 0 },
  proto: {
    address,
    closeGracefully: { capability: "js", passThis: true },
    connect: {
      ...objectIfOpen,
      args: { address: SocketAddress.otherAsNull, options: b.opaque, sessionTicket: b.opaque },
      passThis: true,
    },
    listen: { ...js, args: { options: b.opaque }, passThis: true },
    markBusy: { args: { busy: b.bool.loose } },
    releaseSocket: { capability: "js" },
    setSNIContexts: { ...js, args: { entries: b.opaque, replace: b.bool.loose } },
  },
});

export const EphemeralKey = b.dictionary({ type: b.string, name: b.string.optional, size: b.u32 });

export const QuicSession = b.class({
  rustPath: "crate::node::quic::QuicSession",
  proto: {
    applicationOptions: { returns: b.object, ...js },
    destroy: { ...js, args: { options: b.opaque } },
    getCertificate: certificate,
    getEphemeralKey: { returns: EphemeralKey.optional },
    getLocalAddress: address,
    getPeerCertificate: certificate,
    getRemoteAddress: address,
    gracefulClose: { ...js, args: { options: b.opaque } },
    localTransportParams: objectIfOpen,
    openStream: { ...objectIfOpen, args: { direction: b.f64.otherAsNull, body: b.opaque }, passThis: true },
    remoteTransportParams: objectIfOpen,
    sendDatagram: { ...js, args: { data: b.opaque }, returns: b.u64.asBigInt },
    updateKey: { returns: b.bool },
  },
});

export const QuicStream = b.class({
  rustPath: "crate::node::quic::QuicStream",
  proto: {
    abortForDestroy: { args: { stopSendingCode: b.opaque, resetCode: b.opaque }, capability: "js" },
    attachSource: { ...js, args: { source: b.opaque } },
    destroy: { ...js, args: { error: b.opaque } },
    endWrite: { capability: "js" },
    getPriority: { returns: b.u32 },
    getReader: { returns: b.self, passThis: true },
    initStreamingSource: {},
    pull: { ...js, args: { callback: b.opaque } },
    resetStream: { args: { code: b.opaque }, capability: "js" },
    sendHeaders: { ...js, args: { kind: b.opaque, headers: b.opaque, flags: b.opaque }, returns: b.bool },
    setPriority: { args: { priority: b.i32.allowBigInt.wrap } },
    setWakeup: { args: { callback: b.opaque.nullable }, capability: "js" },
    stopSending: { args: { code: b.opaque }, capability: "js" },
    write: { ...js, args: { batch: b.opaque }, returns: b.opaque.returning("number", "undefined") },
  },
});
