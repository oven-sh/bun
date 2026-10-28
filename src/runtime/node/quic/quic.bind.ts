import * as b from "../../../codegen/bindgen-lib.ts";
import { coercedInt32 } from "../../socket/socket_body.bind.ts";
import { SocketAddress } from "../../socket/SocketAddress.bind.ts";
import { BlockList } from "../net/BlockList.bind.ts";

const js = { capability: "js", throws: true } as const;
const objectIfOpen = { returns: b.opaque.returning("object", "undefined"), ...js } as const;
const certificate = { returns: b.opaque.returning("Buffer", "undefined"), ...js } as const;
const address = { returns: b.opaque.returning("SocketAddress", "undefined"), capability: "js" } as const;

/** A member of another type is ignored. */
const text = b.string.allowStringObject.otherAsNull;
const flag = b.bool.otherAsNull;
const truthy = b.bool.loose.optional;
const object = b.object.otherAsNull;
/** A negative number is 0 and a BigInt wraps to 64 bits. */
export const Uint64Option = b.union({ missing: b.null, number: b.f64, bigInt: b.i64.asIntN, other: b.ignored });

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
    /** `headers` is `[string, count]`. It is read first, and `flags` is not converted for trailers. */
    sendHeaders: {
      ...js,
      args: { kind: coercedInt32.deferred, headers: b.opaque, flags: coercedInt32.deferred },
      returns: b.bool,
    },
    setPriority: { args: { priority: coercedInt32 } },
    setWakeup: { args: { callback: b.opaque.nullable }, capability: "js" },
    stopSending: { args: { code: b.opaque }, capability: "js" },
    write: { ...js, args: { batch: b.opaque }, returns: b.f64.optional },
  },
});

export const EphemeralKey = b.dictionary({ type: b.string, name: b.string.optional, size: b.u32 });

export const QuicCloseOptions = b.dictionary(
  { type: b.string.loose.optional, code: Uint64Option, reason: text },
  { deferred: true },
);

export const QuicSession = b.class({
  rustPath: "crate::node::quic::QuicSession",
  proto: {
    applicationOptions: { returns: b.object, ...js },
    destroy: { ...js, args: { options: QuicCloseOptions.otherAsNull } },
    getCertificate: certificate,
    getEphemeralKey: { returns: EphemeralKey.optional },
    getLocalAddress: address,
    getPeerCertificate: certificate,
    getRemoteAddress: address,
    gracefulClose: { ...js, args: { options: QuicCloseOptions.otherAsNull } },
    localTransportParams: objectIfOpen,
    openStream: {
      ...js,
      args: { direction: b.f64.otherAsNull, body: b.bufferSource.allowShared.otherAsNull },
      returns: QuicStream.optional,
      passThis: true,
    },
    remoteTransportParams: objectIfOpen,
    sendDatagram: { ...js, args: { data: b.bufferSource.allowShared.otherAsNull }, returns: b.u64.asBigInt },
    updateKey: { returns: b.bool },
  },
});

export const EndpointOptions = b.dictionary(
  {
    address: SocketAddress.withValue.otherAsNull,
    blockList: BlockList.withValue.otherAsNull,
    blockListPolicy: text,
    disableStatelessReset: flag,
    statelessResetBurst: b.f64.otherAsNull,
    statelessResetRate: b.f64.otherAsNull,
  },
  { allowArray: true, nonObjectAsEmpty: true },
);

export const TextOrBuffer = b.union({
  text: b.string.allowStringObject,
  buffer: b.bufferSource.allowShared,
  other: b.ignored,
});
/** What in `list` is not a string or a buffer is skipped. */
export const PemSource = b.union({ list: b.jsArray, value: TextOrBuffer });
export const QuicTLSOptions = b.dictionary(
  {
    alpn: TextOrBuffer,
    servername: text,
    certs: PemSource,
    keys: PemSource,
    ca: PemSource,
    crl: PemSource,
    verifyPeerStrict: truthy,
    verifyHostname: truthy,
    verifyClient: truthy,
    keylog: truthy,
    enableEarlyData: truthy,
    ciphers: text,
    groups: text,
    /** What is not a string is skipped. */
    origins: b.jsArray.otherAsNull,
    /** Each own enumerable string key is a host name, whose value is a `QuicTLSOptions`. */
    sni: object,
  },
  { deferred: true },
);
export const TransportParams = b.dictionary(
  {
    preferredAddressIpv4: SocketAddress.withValue.otherAsNull,
    preferredAddressIpv6: SocketAddress.withValue.otherAsNull,
    initialMaxStreamDataBidiLocal: Uint64Option,
    initialMaxStreamDataBidiRemote: Uint64Option,
    initialMaxStreamDataUni: Uint64Option,
    initialMaxData: Uint64Option,
    initialMaxStreamsBidi: Uint64Option,
    initialMaxStreamsUni: Uint64Option,
    maxIdleTimeout: Uint64Option,
    maxUdpPayloadSize: Uint64Option,
    disableActiveMigration: truthy,
    maxDatagramFrameSize: Uint64Option,
  },
  { deferred: true },
);
export const ApplicationOptions = b.dictionary(
  { enableConnectProtocol: flag, enableDatagrams: flag, maxHeaderPairs: Uint64Option, maxHeaderLength: Uint64Option },
  { deferred: true },
);
/** The options of `connect` and of `listen`, which keeps them and reads `datagramDropPolicy`, `qlog`, `verifyPeer` and `application` for each session. */
export const SessionOptions = b.dictionary(
  {
    version: Uint64Option,
    minVersion: Uint64Option,
    tls: QuicTLSOptions.otherAsNull,
    handshakeTimeout: Uint64Option,
    keepAlive: Uint64Option,
    transportParams: TransportParams.otherAsNull,
    cc: text,
    preferredAddressPolicy: Uint64Option,
    datagramDropPolicy: text,
    qlog: truthy,
    verifyPeer: text,
    application: ApplicationOptions.otherAsNull,
  },
  { deferred: true },
);

/** `internalBinding("quic").Endpoint` of Node. */
export const QuicEndpoint = b.class({
  rustPath: "crate::node::quic::QuicEndpoint",
  construct: { passStructure: true, args: { options: EndpointOptions }, capability: "js", throws: true, length: 0 },
  proto: {
    address,
    closeGracefully: { capability: "js", passThis: true },
    connect: {
      ...js,
      args: {
        address: SocketAddress.otherAsNull,
        options: SessionOptions.otherAsNull,
        sessionTicket: b.bufferSource.allowShared.otherAsNull,
      },
      returns: QuicSession.optional,
      passThis: true,
    },
    listen: { ...js, args: { options: SessionOptions.otherAsNull }, passThis: true },
    markBusy: { args: { busy: b.bool.loose } },
    releaseSocket: { capability: "js" },
    /** `entries` is what `QuicTLSOptions.sni` is. */
    setSNIContexts: { ...js, args: { entries: object, replace: b.bool.loose } },
  },
});
