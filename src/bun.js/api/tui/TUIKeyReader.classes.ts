import { define } from "../../../codegen/class-definitions";

export default [
  define({
    name: "TuiKeyReader",
    construct: true,
    finalize: true,
    configurable: false,
    klass: {},
    JSType: "0b11101110",
    proto: {
      close: {
        fn: "close",
        length: 0,
      },
      onkeypress: {
        setter: "setOnKeypress",
        getter: "getOnKeypress",
      },
      onpaste: {
        setter: "setOnPaste",
        getter: "getOnPaste",
      },
      onmouse: {
        setter: "setOnMouse",
        getter: "getOnMouse",
      },
      onfocus: {
        setter: "setOnFocus",
        getter: "getOnFocus",
      },
      onblur: {
        setter: "setOnBlur",
        getter: "getOnBlur",
      },
    },
  }),
];
