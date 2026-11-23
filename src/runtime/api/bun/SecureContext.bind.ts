import * as b from "../../../codegen/bindgen-lib.ts";
import * as table from "../../../codegen/builtins/lib.ts";

export default b.module({ rustPath: "crate::api::bun_secure_context" });

const fromOptions = { args: { options: b.any }, capability: "js", throws: true } as const;

/** What `node:tls` hands out as `secureContext.context`. */
export const SecureContext = b.class({
  rustPath: "crate::api::bun_secure_context::SecureContext",
  memoryCost: true,
  types: [table.exactType("$Node.NativeSecureContext"), table.exactType("$Bindgen.SecureContext")],
  construct: { ...fromOptions, length: 0 },
  proto: {
    /** Node's is an opaque V8 External of the `SSL_CTX`, for addons that link OpenSSL. Here it is `undefined`. */
    _external: { getter: b.any.returning("undefined"), capability: "heap" },
    addCACert: { args: { cert: b.any }, capability: "js", throws: true },
  },
  static: {
    /** Owns its `SSL_CTX`, so `addCACert` affects nothing else. */
    createPrivate: { ...fromOptions, returns: b.self },
    /** The same object for the same options, while it is alive. */
    intern: { ...fromOptions, returns: b.any.returning("SecureContext") },
    /** A PKCS#12 (`pfx`) blob as `{ key, cert, ca }` PEM strings. */
    parsePkcs12: {
      args: { pfx: b.any, passphrase: b.any },
      returns: b.any.returning("object"),
      capability: "js",
      throws: true,
    },
  },
});

export const liveCount = b.fn({ returns: b.f64 });
