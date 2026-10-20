import * as b from "../../codegen/bindgen-lib.ts";

export default b.module({ rustPath: "crate::crypto::crypto_hasher" });

const input = b.bytes({ from: ["string", "buffer", "blob"] });

/** Without one, the digest is returned in a new buffer. */
export const DigestOutput = b.union({
  /** The digest is returned as a string. */
  encoding: b.string.utf8,
  /** The digest is written here, and this is returned. */
  into: b.bufferSource.allowShared,
});

const method = { capability: "heap", throws: true } as const;
const update = { ...method, returns: b.self, passThis: true, mutates: true } as const;
const digest = { ...method, args: { output: DigestOutput.nullable }, returns: b.any, mutates: true } as const;

export const CryptoHasher = b.class({
  rustPath: "crate::crypto::crypto_hasher::CryptoHasher",
  configurable: false,
  construct: {
    ...method,
    args: { algorithm: b.string.utf8, hmacKey: b.bytes({ from: ["string", "buffer"] }).nullable },
    length: 0,
  },
  proto: {
    algorithm: { ...method, getter: b.string, cache: true },
    byteLength: { ...method, getter: b.u32 },
    copy: { ...method, returns: b.self },
    digest,
    update: [
      {
        ...update,
        rustName: "update_string",
        args: { input: b.string.allowStringObject, encoding: b.string.loose.utf8.optional },
        length: 2,
      },
      { ...update, rustName: "update_bytes", args: { input } },
    ],
  },
  static: {
    algorithms: { getter: b.array(b.string.utf8) },
    hash: {
      ...method,
      args: {
        algorithm: b.bytes({ from: ["string"], refuse: ["stringObject"] }),
        input,
        output: DigestOutput.optional,
      },
      returns: b.any,
    },
  },
});

const hash = { ...method, args: { input, output: DigestOutput.optional }, returns: b.any } as const;

const staticHasher = (name: string) =>
  b.class({
    rustPath: `crate::crypto::crypto_hasher::${name}`,
    configurable: false,
    construct: {},
    proto: {
      byteLength: { getter: b.u32 },
      digest,
      update: { ...update, args: { input } },
    },
    static: {
      byteLength: { getter: b.u32, rustName: "static_byte_length" },
      hash: { ...hash, length: 2 },
    },
  });

export const MD4 = staticHasher("MD4");
export const MD5 = staticHasher("MD5");
export const SHA1 = staticHasher("SHA1");
export const SHA224 = staticHasher("SHA224");
export const SHA256 = staticHasher("SHA256");
export const SHA384 = staticHasher("SHA384");
export const SHA512 = staticHasher("SHA512");
export const SHA512_256 = staticHasher("SHA512_256");

/** `SHA512_256.hash`. */
export const sha = b.fn(hash);
