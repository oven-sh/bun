import { define } from "../../codegen/class-definitions";

export default [
  define({
    name: "SocketAddressNew",
    construct: true,
    finalize: true,
    klass: {
      isSocketAddress: {
        fn: "isSocketAddress",
        length: 1,
      },
      parse: {
        fn: "parse",
        length: 1,
      },
    },
    proto: {
      address: {
        getter: "getAddress",
        // setter: "setAddress",
        enumerable: false,
        configurable: true,
      },
      port: {
        getter: "getPort",
        enumerable: false,
        configurable: true,
      },
      family: {
        getter: "getFamily",
        enumerable: false,
        configurable: true,
      },
      flowlabel: {
        getter: "getFlowLabel",
        enumerable: false,
        configurable: true,
      },
    },
  }),
];
