import { define } from "../../codegen/class-definitions";

export default [
  define({
    name: "SecureContext",
    construct: true,
    finalize: true,
    memoryCost: true,
    configurable: false,
    klass: {
      // `tls.createSecureContext()` entry — WeakGCMap-memoised by config
      // digest so identical configs return the same JS cell. Replaces the
      // old SHA-256/WeakRef cache that lived in `tls.ts`.
      intern: { fn: "intern", length: 1 },
    },
    // node:tls hands out the SecureContext object itself as `.context`. We
    // deliberately do NOT expose the underlying SSL_CTX* to JS: a Number would
    // lose precision above 2^53, and Node's `context._external` is a V8
    // External (opaque) used only by N-API addons that link OpenSSL directly,
    // which Bun's BoringSSL build can't satisfy anyway.
    proto: {
      // Append a PEM-encoded (possibly multi-cert) trust anchor to the
      // context's verify store. Lenient like Node — bad input is silently
      // ignored, duplicates are no-ops.
      addCACert: { fn: "addCACert", length: 1 },
    },
  }),
];
