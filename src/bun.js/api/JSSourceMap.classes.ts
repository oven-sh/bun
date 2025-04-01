import { define } from "../../codegen/class-definitions";

export default {
  JSSourceMap: define({
    name: "SourceMap",
    construct: true,
    finalize: true,
    estimatedSize: true,
    klass: {},
    proto: {
      payload: {
        getter: "getPayload",
        enumerable: true,
      },
      lineLengths: {
        getter: "getLineLengths",
        enumerable: true,
      },
      findEntry: {
        fn: "findEntry",
        length: 2,
        enumerable: true,
      },
      findOrigin: {
        fn: "findOrigin",
        length: 2,
        enumerable: true,
      },
    },
  }),
};