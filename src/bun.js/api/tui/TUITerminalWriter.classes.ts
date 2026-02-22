import { define } from "../../../codegen/class-definitions";

export default [
  define({
    name: "TuiTerminalWriter",
    construct: true,
    finalize: true,
    configurable: false,
    klass: {},
    JSType: "0b11101110",
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
      enterAltScreen: {
        fn: "enterAltScreen",
        length: 0,
      },
      exitAltScreen: {
        fn: "exitAltScreen",
        length: 0,
      },
      enableMouseTracking: {
        fn: "enableMouseTracking",
        length: 0,
      },
      disableMouseTracking: {
        fn: "disableMouseTracking",
        length: 0,
      },
      enableFocusTracking: {
        fn: "enableFocusTracking",
        length: 0,
      },
      disableFocusTracking: {
        fn: "disableFocusTracking",
        length: 0,
      },
      enableBracketedPaste: {
        fn: "enableBracketedPaste",
        length: 0,
      },
      disableBracketedPaste: {
        fn: "disableBracketedPaste",
        length: 0,
      },
      write: {
        fn: "write",
        length: 1,
      },
      cursorX: {
        getter: "getCursorX",
      },
      cursorY: {
        getter: "getCursorY",
      },
      columns: {
        getter: "getColumns",
      },
      rows: {
        getter: "getRows",
      },
      onresize: {
        setter: "setOnResize",
        getter: "getOnResize",
      },
    },
  }),
];
