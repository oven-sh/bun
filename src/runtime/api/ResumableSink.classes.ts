import { define } from "../../codegen/class-definitions";

function generate(name) {
  return define({
    name: name,
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
      end: {
        fn: "jsEnd",
        length: 1,
      },
      setHandlers: {
        fn: "jsSetHandlers",
        length: 2,
        passThis: true,
      },
    },
    values: ["ondrain", "oncancel", "stream"],
  });
}
export default [generate("ResumableFetchSink"), generate("ResumableS3UploadSink")];
