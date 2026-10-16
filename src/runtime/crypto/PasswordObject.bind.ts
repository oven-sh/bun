import * as b from "../../codegen/bindgen-lib.ts";

export default b.module({ rustPath: "crate::crypto::password_object" });

/** Which of the costs counts depends on `algorithm`, and the others can be anything. */
export const PasswordHashOptions = b.dictionary(
  {
    algorithm: b.string.utf8.nullable,
    cost: b.any,
    timeCost: b.any,
    memoryCost: b.any,
  },
  { allowArray: true },
);

export const PasswordHashAlgorithm = b.union({
  unspecified: b.null,
  label: b.string,
  options: PasswordHashOptions,
});

/** `hash` and `verify` make their own copies of these, to zero them. */
const copied = b.any;

export const password = b.namespace({
  hash: {
    args: { password: copied, algorithm: PasswordHashAlgorithm },
    returns: b.any,
    capability: "js",
    throws: true,
  },
  hashSync: {
    args: { password: b.stringOrBuffer, algorithm: PasswordHashAlgorithm },
    returns: b.string.utf8,
    capability: "heap",
    throws: true,
  },
  verify: {
    args: { password: copied, hash: copied, algorithm: b.string.utf8.nullable },
    returns: b.any,
    capability: "js",
    throws: true,
  },
  verifySync: {
    args: { password: b.stringOrBuffer, hash: b.stringOrBuffer, algorithm: b.string.utf8.nullable },
    returns: b.bool,
    capability: "heap",
    throws: true,
  },
});
