import { define } from "../../../codegen/class-definitions";

export default [
  define({
    name: "SecureContext",
    construct: true,
    finalize: true,
    memoryCost: true,
    configurable: false,
    klass: {},
    proto: {
      // Exposed for parity with Node's `SecureContext.prototype.context`
      // (which userland sometimes pokes at to call `SSL_CTX_*` via N-API).
      // Returns the raw pointer as a number; not stable across GC.
      _nativeHandle: {
        getter: "getNativeHandle",
      },
    },
  }),
];
