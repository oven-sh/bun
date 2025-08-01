import { define } from "../../codegen/class-definitions";

export default [
  define({
    name: "H2FrameParser",
    JSType: "0b11101110",
    proto: {
      request: {
        fn: "request",
        length: 2,
      },
      setNativeSocket: {
        fn: "setNativeSocketFromJS",
        length: 1,
      },
      ping: {
        fn: "ping",
        length: 0,
      },
      altsvc: {
        fn: "altsvc",
        length: 3,
      },
      origin: {
        fn: "origin",
        length: 1,
      },
      goaway: {
        fn: "goaway",
        length: 3,
      },
      getCurrentState: {
        fn: "getCurrentState",
        length: 0,
      },
      settings: {
        fn: "updateSettings",
        length: 1,
      },
      setLocalWindowSize: {
        fn: "setLocalWindowSize",
        length: 1,
      },
      read: {
        fn: "read",
        length: 1,
      },
      flush: {
        fn: "flushFromJS",
        length: 0,
      },
      detach: {
        fn: "detachFromJS",
        length: 0,
      },
      rstStream: {
        fn: "rstStream",
        length: 1,
      },
      writeStream: {
        fn: "writeStream",
        length: 3,
      },
      sendTrailers: {
        fn: "sendTrailers",
        length: 2,
      },
      noTrailers: {
        fn: "noTrailers",
        length: 1,
      },
      setStreamPriority: {
        fn: "setStreamPriority",
        length: 2,
      },
      getStreamContext: {
        fn: "getStreamContext",
        length: 1,
      },
      setStreamContext: {
        fn: "setStreamContext",
        length: 2,
      },
      getEndAfterHeaders: {
        fn: "getEndAfterHeaders",
        length: 1,
      },
      isStreamAborted: {
        fn: "isStreamAborted",
        length: 1,
      },
      getStreamState: {
        fn: "getStreamState",
        length: 1,
      },
      bufferSize: {
        fn: "getBufferSize",
        length: 0,
      },
      hasNativeRead: {
        fn: "hasNativeRead",
        length: 1,
      },
      setNextStreamID: {
        fn: "setNextStreamID",
        length: 1,
      },
      forEachStream: {
        fn: "forEachStream",
        length: 2,
      },
      emitErrorToAllStreams: {
        fn: "emitErrorToAllStreams",
        length: 1,
      },
      emitAbortToAllStreams: {
        fn: "emitAbortToAllStreams",
        length: 0,
      },
      getNextStream: {
        fn: "getNextStream",
        length: 0,
      },
    },
    finalize: true,
    construct: true,
    klass: {},
  }),
];
