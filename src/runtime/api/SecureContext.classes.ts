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
      createPrivate: { fn: "create_private", length: 1 },
      // Parses a PKCS#12 (`pfx`) blob into { key, cert, ca } PEM strings so
      // the regular key/cert/ca option plumbing can consume it.
      parsePkcs12: { fn: "parse_pkcs12", length: 2 },
    },
    // node:tls hands out the SecureContext object itself as `.context`. We
    // deliberately do NOT expose the underlying SSL_CTX* to JS: a Number
    // would lose precision above 2^53, and Node's `context._external` is a
    // V8 External (opaque) used only by N-API addons that link OpenSSL
    // directly, which Bun's BoringSSL build can't satisfy anyway.
    proto: {
      // Present so the accessor exists (and rejects a foreign receiver the
      // way every other class getter does) rather than reading as a plain
      // missing property; the value stays hidden, see above.
      _external: {
        getter: "get_external",
      },
      // `secureContext.context.addCACert(pem)` — Node's SecureContext exposes
      // this so extra CAs can be appended to an existing context's store.
      addCACert: {
        fn: "add_ca_cert",
        length: 1,
      },
    },
  }),
];
