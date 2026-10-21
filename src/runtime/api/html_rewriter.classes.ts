import { define } from "../../codegen/class-definitions.ts";

export default [
  define({
    name: "HTMLRewriter",
    // R-2 Phase 2: user impls take `&self`; emit `this: &T` shims.
    sharedThis: true,
    construct: true,
    finalize: true,
    JSType: "0b11101110",
    configurable: false,
    klass: {},
    // The `on()` / `onDocument()` callbacks: `HandlerList` in html_rewriter.rs.
    values: ["handlers"],
    proto: {
      on: {
        fn: "on",
        length: 2,
      },
      onDocument: {
        fn: "onDocument",
        length: 1,
      },
      transform: {
        fn: "transform",
        length: 1,
      },
    },
  }),
];
