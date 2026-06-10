import { define } from "../../codegen/class-definitions";

export default [
  define({
    name: "FrameworkFileSystemRouter",
    // JS name and Rust type name differ, so the name-based resolver can't
    // find the backing struct on its own.
    rustPath: "crate::bake::framework_router::JSFrameworkRouter",
    construct: true,
    finalize: true,
    JSType: "0b11101110",
    configurable: false,
    proto: {
      toJSON: {
        fn: "toJSON",
        length: 0,
      },
      match: {
        fn: "match",
        length: 1,
      },
    },
    klass: {},
  }),
];
