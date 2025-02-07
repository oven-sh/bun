import { define } from "../../codegen/class-definitions";

export default [
  define({
    name: "SocketAddressNew",
    construct: true,
    finalize: false,
    klass: {
      isSocketAddress: {
        fn: "isSocketAddress",
        length: 1,
        enumerable: false,
        configurable: true,
      },
      parse: {
        fn: "parse",
        length: 1,
        enumerable: false,
        configurable: true,
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
