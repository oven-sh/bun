import { define } from "../../../codegen/class-definitions";

export default [
  define({
    name: "TuiScreen",
    construct: true,
    finalize: true,
    configurable: false,
    estimatedSize: true,
    klass: {},
    JSType: "0b11101110",
    proto: {
      setText: {
        fn: "setText",
        length: 4,
      },
      setAnsiText: {
        fn: "setAnsiText",
        length: 3,
      },
      style: {
        fn: "style",
        length: 1,
      },
      clearRect: {
        fn: "clearRect",
        length: 4,
      },
      fill: {
        fn: "fill",
        length: 6,
      },
      copy: {
        fn: "copy",
        length: 7,
      },
      resize: {
        fn: "resize",
        length: 2,
      },
      clear: {
        fn: "clear",
        length: 0,
      },
      width: {
        getter: "getWidth",
      },
      height: {
        getter: "getHeight",
      },
      getCell: {
        fn: "getCell",
        length: 2,
      },
      hyperlink: {
        fn: "hyperlink",
        length: 1,
      },
      setHyperlink: {
        fn: "setHyperlink",
        length: 3,
      },
      clip: {
        fn: "clip",
        length: 4,
      },
      unclip: {
        fn: "unclip",
        length: 0,
      },
      drawBox: {
        fn: "drawBox",
        length: 5,
      },
    },
  }),
];
