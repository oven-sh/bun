import { define } from "../../codegen/class-definitions";

function generate(name) {
  return define({
    name: name,
    // R-2 Phase 3 opt-out: ResumableSink host-fns still take `&mut self`.
    sharedThis: false,
    construct: true,
    finalize: true,
    configurable: false,
    klass: {},
    JSType: "0b11101110",
    proto: {
      start: {
        fn: "jsStart",
        length: 1,
      },
      write: {
        fn: "jsWrite",
        length: 1,
      },
      flush: {
        fn: "jsFlush",
        length: 1,
        passThis: true,
      },
      end: {
        fn: "jsClose",
        length: 0,
        passThis: true,
      },
      close: {
        fn: "jsClose",
        length: 0,
        passThis: true,
      },
      error: {
        fn: "jsError",
        length: 1,
        passThis: true,
      },
      setHandlers: {
        fn: "jsSetHandlers",
        length: 2,
        passThis: true,
      },
    },
    values: ["ondrain", "oncancel", "stream", "flushPromise"],
  });
}
export default [generate("ResumableFetchSink"), generate("ResumableS3UploadSink")];
