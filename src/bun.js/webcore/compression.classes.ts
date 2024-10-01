import { define } from "../../codegen/class-definitions";

export default [
  define({
    name: "CompressionStream",
    construct: true,
    finalize: true,
    klass: {},
    JSType: "0b11101110",
    proto: {
      readable: { getter: "get_readable", setter: "set_noop" },
      writable: { getter: "get_writable", setter: "set_noop" },
    },
  }),

  define({
    name: "DecompressionStream",
    construct: true,
    finalize: true,
    klass: {},
    JSType: "0b11101110",
    proto: {
      readable: { getter: "get_readable", setter: "set_noop" },
      writable: { getter: "get_writable", setter: "set_noop" },
    },
  }),
];
