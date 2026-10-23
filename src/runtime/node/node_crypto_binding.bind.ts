import * as b from "../../codegen/bindgen-lib.ts";

export default b.module({ rustPath: "crate::node::crypto" });

/** Each body validates its own arguments, in Node's order and with Node's errors. */
const js = { capability: "js", throws: true } as const;

const argon2Parameters = {
  message: b.any,
  nonce: b.any,
  parallelism: b.any,
  tagLength: b.any,
  memory: b.any,
  passes: b.any,
  secret: b.any,
  associatedData: b.any,
  type: b.any,
};

export const crypto = b.namespace({
  pbkdf2: {
    args: { password: b.any, salt: b.any, iterations: b.any, keylen: b.any, digest: b.any, callback: b.any },
    ...js,
  },
  pbkdf2Sync: {
    args: { password: b.any, salt: b.any, iterations: b.any, keylen: b.any, digest: b.any },
    returns: b.any,
    ...js,
  },
  randomInt: {
    args: { min: b.any, max: b.any, callback: b.any },
    returns: b.f64.optional,
    length: 2,
    ...js,
  },
  randomFill: {
    args: { buf: b.any, offset: b.any, size: b.any, callback: b.any },
    ...js,
  },
  randomFillSync: {
    args: { buf: b.any, offset: b.any, size: b.any },
    returns: b.any,
    ...js,
  },
  randomUUID: { args: { options: b.any }, returns: b.string, ...js },
  randomUUIDv7: {
    args: { options: b.any },
    returns: b.string,
    rustPath: "crate::node::crypto::random_uuid_v7",
    ...js,
  },
  randomBytes: { args: { size: b.any, callback: b.any }, returns: b.any, ...js },
  secureHeapUsed: {},
  getFips: { returns: b.i32 },
  setFips: { length: 1 },
  setEngine: { length: 2, capability: "heap", throws: true },
  getHashes: { returns: b.any, capability: "heap", throws: true },
  scrypt: {
    args: { password: b.any, salt: b.any, keylen: b.any, options: b.any, callback: b.any },
    ...js,
  },
  scryptSync: {
    args: { password: b.any, salt: b.any, keylen: b.any, options: b.any },
    returns: b.any,
    ...js,
  },
  argon2: { args: { ...argon2Parameters, callback: b.any }, ...js },
  argon2Sync: { args: argon2Parameters, returns: b.any, ...js },
});
