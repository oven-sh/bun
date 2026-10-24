import * as b from "../../codegen/bindgen-lib.ts";

export default b.module({ rustPath: "crate::crypto::password_object" });

export const PasswordCost = b.union({ absent: b.null, number: b.f64, text: b.string, other: b.ignored });

/** Which of the costs counts depends on `algorithm`, and the others can be anything. */
export const PasswordHashOptions = b.dictionary(
  {
    algorithm: b.string.utf8.nullable,
    cost: PasswordCost,
    timeCost: PasswordCost,
    memoryCost: PasswordCost,
  },
  { allowArray: true },
);

export const PasswordHashAlgorithm = b.union({
  unspecified: b.null,
  label: b.string,
  options: PasswordHashOptions,
});

const stringOrBuffer = b.bytes({ from: ["string", "buffer"] });
/** For a job to own, and to zero when it is done. */
const copied = b.bytes({ from: ["string", "buffer"], otherwise: "toString", refuse: ["undefined"], held: "copied" });

export const password = b.namespace({
  hash: {
    args: { password: copied, algorithm: PasswordHashAlgorithm },
    returns: b.promise,
    capability: "js",
    throws: true,
  },
  hashSync: {
    args: { password: stringOrBuffer, algorithm: PasswordHashAlgorithm },
    returns: b.string.utf8,
    capability: "heap",
    throws: true,
  },
  verify: {
    args: { password: copied, hash: copied, algorithm: b.string.utf8.nullable },
    returns: b.promise,
    capability: "js",
    throws: true,
  },
  verifySync: {
    args: { password: stringOrBuffer, hash: stringOrBuffer, algorithm: b.string.utf8.nullable },
    returns: b.bool,
    capability: "heap",
    throws: true,
  },
});
