import { define } from "../../codegen/class-definitions";

export default [
  define({
    name: "SourceMap",
    JSType: "0b11101110",
    proto: {
      findOrigin: {
        fn: "findOrigin",
        length: 2,
      },
      findEntry: {
        fn: "findEntry",
        length: 2,
      },
      payload: {
        getter: "getPayload",
        cache: true,
      },
      lineLengths: {
        getter: "getLineLengths",
        cache: true,
      },
    },
    finalize: true,
    construct: true,
    constructNeedsThis: true,
    memoryCost: true,
    estimatedSize: true,
  }),
];
