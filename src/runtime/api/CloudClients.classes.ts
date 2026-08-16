import { define } from "../../codegen/class-definitions";

export default [
  define({
    name: "AWSClient",
    construct: true,
    finalize: true,
    configurable: false,
    klass: {},
    JSType: "0b11101110",
    proto: {
      fetch: {
        fn: "fetch",
        length: 2,
      },
      presign: {
        fn: "presign",
        length: 2,
      },
      credentials: {
        fn: "credentials",
        length: 1,
      },
      region: {
        getter: "getRegion",
      },
      profile: {
        getter: "getProfile",
      },
    },
  }),
  define({
    name: "GCPClient",
    construct: true,
    finalize: true,
    configurable: false,
    klass: {},
    JSType: "0b11101110",
    proto: {
      fetch: {
        fn: "fetch",
        length: 2,
      },
      accessToken: {
        fn: "accessToken",
        length: 1,
      },
      idToken: {
        fn: "idToken",
        length: 1,
      },
    },
  }),
];
