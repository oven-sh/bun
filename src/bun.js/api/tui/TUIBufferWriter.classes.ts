import { define } from "../../../codegen/class-definitions";

export default [
  define({
    name: "TuiBufferWriter",
    construct: true,
    constructNeedsThis: true,
    finalize: true,
    configurable: false,
    klass: {},
    JSType: "0b11101110",
    values: ["buffer"],
    proto: {
      render: {
        fn: "render",
        length: 2,
      },
      clear: {
        fn: "clear",
        length: 0,
      },
      close: {
        fn: "close",
        length: 0,
      },
      end: {
        fn: "end",
        length: 0,
      },
      cursorX: {
        getter: "getCursorX",
      },
      cursorY: {
        getter: "getCursorY",
      },
      byteOffset: {
        getter: "getByteOffset",
      },
      byteLength: {
        getter: "getByteLength",
      },
    },
  }),
];
