import * as b from "../../../codegen/bindgen-lib.ts";
import * as table from "../../../codegen/builtins/lib.ts";
import { TLSOptions } from "../../socket/SSLConfig.bind.ts";

export default b.module({ rustPath: "crate::api::bun_secure_context" });

const fromOptions = { args: { options: TLSOptions }, capability: "js", throws: true } as const;

/** PEM strings. */
export const ParsedPkcs12 = b.dictionary({
  key: b.string.local,
  cert: b.string.local,
  ca: b.string.local.optional,
});

/** What is not a buffer becomes a string once the passphrase has. */
export const Pkcs12Source = b.union({ missing: b.undefined, buffer: b.bufferSource.allowShared, other: b.opaque });
export const pkcs12Text = b.conversion(b.string.loose.utf8.owned);

/** What `node:tls` hands out as `secureContext.context`. */
export const SecureContext = b.class({
  rustPath: "crate::api::bun_secure_context::SecureContext",
  memoryCost: true,
  types: [table.exactType("$Node.NativeSecureContext"), table.exactType("$Bindgen.SecureContext")],
  construct: { ...fromOptions, length: 0 },
  proto: {
    /** Node's is an opaque V8 External of the `SSL_CTX`, for addons that link OpenSSL. Here it is `undefined`. */
    _external: { getter: b.opaque.returning("undefined"), capability: "heap" },
    addCACert: { args: { cert: b.string.loose.utf8.owned.deferred }, capability: "js", throws: true },
  },
  static: {
    /** Owns its `SSL_CTX`, so `addCACert` affects nothing else. */
    createPrivate: { ...fromOptions, returns: b.self },
    /** The same object for the same options, while it is alive. */
    intern: { ...fromOptions, returns: b.self },
    /** A PKCS#12 (`pfx`) blob as `{ key, cert, ca }` PEM strings. */
    parsePkcs12: {
      args: { pfx: Pkcs12Source, passphrase: b.string.loose.utf8.owned.nullable.deferred },
      returns: ParsedPkcs12,
      capability: "js",
      throws: true,
      length: 2,
    },
  },
});

export const liveCount = b.fn({ returns: b.f64 });
