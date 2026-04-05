import { define } from "../../codegen/class-definitions";

export default [
  define({
    name: "SMTPClient",
    construct: true,
    constructNeedsThis: true,
    finalize: true,
    configurable: false,
    JSType: "0b11101110",
    memoryCost: true,
    klass: {
      parseAddress: {
        fn: "jsParseAddress",
        length: 2,
      },
      createTestAccount: {
        fn: "jsCreateTestAccount",
        length: 0,
      },
    },
    proto: {
      send: {
        fn: "send",
        length: 1,
      },
      verify: {
        fn: "verify",
        length: 0,
      },
      close: {
        fn: "close",
        length: 0,
      },
      connected: {
        getter: "getConnected",
      },
      secure: {
        getter: "getSecure",
      },
    },
    values: ["sendPromise"],
  }),
];
