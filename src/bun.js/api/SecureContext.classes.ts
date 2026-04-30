import { define } from "../../codegen/class-definitions";

export default [
  define({
    name: "SecureContext",
    construct: true,
    finalize: true,
    memoryCost: true,
    configurable: false,
    klass: {},
    // No prototype surface — node:tls hands out the SecureContext object
    // itself as `.context`. We deliberately do NOT expose the underlying
    // SSL_CTX* to JS: a Number would lose precision above 2^53, and Node's
    // `context._external` is a V8 External (opaque) used only by N-API
    // addons that link OpenSSL directly, which Bun's BoringSSL build can't
    // satisfy anyway.
    proto: {},
  }),
];
