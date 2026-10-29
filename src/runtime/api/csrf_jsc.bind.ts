import * as b from "../../codegen/bindgen-lib.ts";

export default b.module({ rustPath: "crate::api::csrf_jsc" });

/** In milliseconds. A day unless it is given. */
const duration = b.u64.validateInteger().default(24 * 60 * 60 * 1000);

export const CSRFGenerateOptions = b.dictionary(
  {
    expiresIn: duration,
    sessionId: b.string.utf8.nullable,
    encoding: b.string.loose.utf8.optional,
    algorithm: b.string.utf8.optional,
  },
  { allowArray: true, nonObjectAsEmpty: true },
);

export const CSRFVerifyOptions = b.dictionary(
  {
    secret: b.string.utf8.nullable,
    sessionId: b.string.utf8.nullable,
    maxAge: duration,
    encoding: b.string.loose.utf8.optional,
    algorithm: b.string.utf8.optional,
  },
  { allowArray: true, nonObjectAsEmpty: true },
);

export const CSRF = b.namespace({
  generate: {
    args: {
      secret: b.string.utf8.optional,
      options: CSRFGenerateOptions.nullable.default({}),
    },
    returns: b.string.local,
    capability: "js",
    throws: true,
  },
  verify: {
    args: {
      token: b.string.utf8,
      options: CSRFVerifyOptions.nullable.default({}),
    },
    returns: b.bool,
    capability: "heap",
    throws: true,
  },
});
