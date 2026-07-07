import { define } from "../../../codegen/class-definitions";

// Native handle classes for node:quic, mirroring Node's internalBinding('quic')
// Endpoint/Session/Stream objects (node/src/quic/{endpoint,session,streams}.h).
// The JS layer (src/js/internal/quic/quic.ts) wraps these handles.
export default [
  define({
    name: "QuicEndpoint",
    rustPath: "crate::node::quic::QuicEndpoint",
    construct: true,
    constructNeedsThis: true,
    call: false,
    finalize: true,
    configurable: false,
    JSType: "0b11101110",
    klass: {},
    proto: {
      listen: {
        fn: "listen",
        length: 1,
      },
      closeGracefully: {
        fn: "closeGracefully",
        length: 0,
      },
      releaseSocket: {
        fn: "releaseSocket",
        length: 0,
      },
      connect: {
        fn: "connect",
        length: 3,
      },
      markBusy: {
        fn: "markBusy",
        length: 1,
      },
      ref: {
        fn: "doRef",
        length: 1,
      },
      setSNIContexts: {
        fn: "setSniContexts",
        length: 2,
      },
      address: {
        fn: "address",
        length: 0,
      },
    },
  }),
  define({
    name: "QuicSession",
    rustPath: "crate::node::quic::QuicSession",
    construct: false,
    noConstructor: true,
    call: false,
    finalize: true,
    configurable: false,
    JSType: "0b11101110",
    klass: {},
    proto: {
      destroy: {
        fn: "destroy",
        length: 1,
      },
      getRemoteAddress: {
        fn: "getRemoteAddress",
        length: 0,
      },
      getLocalAddress: {
        fn: "getLocalAddress",
        length: 0,
      },
      getCertificate: {
        fn: "getCertificate",
        length: 0,
      },
      getEphemeralKey: {
        fn: "getEphemeralKey",
        length: 0,
      },
      getPeerCertificate: {
        fn: "getPeerCertificate",
        length: 0,
      },
      gracefulClose: {
        fn: "gracefulClose",
        length: 1,
      },
      silentClose: {
        fn: "silentClose",
        length: 0,
      },
      updateKey: {
        fn: "updateKey",
        length: 0,
      },
      openStream: {
        fn: "openStream",
        length: 2,
      },
      sendDatagram: {
        fn: "sendDatagram",
        length: 1,
      },
      localTransportParams: {
        fn: "localTransportParams",
        length: 0,
      },
      remoteTransportParams: {
        fn: "remoteTransportParams",
        length: 0,
      },
      applicationOptions: {
        fn: "applicationOptions",
        length: 0,
      },
    },
  }),
  define({
    name: "QuicStream",
    rustPath: "crate::node::quic::QuicStream",
    construct: false,
    noConstructor: true,
    call: false,
    finalize: true,
    configurable: false,
    JSType: "0b11101110",
    klass: {},
    proto: {
      attachSource: {
        fn: "attachSource",
        length: 1,
      },
      destroy: {
        fn: "destroy",
        length: 1,
      },
      sendHeaders: {
        fn: "sendHeaders",
        length: 3,
      },
      stopSending: {
        fn: "stopSending",
        length: 1,
      },
      resetStream: {
        fn: "resetStream",
        length: 1,
      },
      abortForDestroy: {
        fn: "abortForDestroy",
        length: 2,
      },
      setPriority: {
        fn: "setPriority",
        length: 1,
      },
      getPriority: {
        fn: "getPriority",
        length: 0,
      },
      getReader: {
        fn: "getReader",
        length: 0,
      },
      setWakeup: {
        fn: "setWakeup",
        length: 1,
      },
      pull: {
        fn: "pull",
        length: 1,
      },
      initStreamingSource: {
        fn: "initStreamingSource",
        length: 0,
      },
      write: {
        fn: "write",
        length: 1,
      },
      endWrite: {
        fn: "endWrite",
        length: 0,
      },
    },
  }),
];
