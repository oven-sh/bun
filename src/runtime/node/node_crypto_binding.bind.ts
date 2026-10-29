import * as b from "../../codegen/bindgen-lib.ts";
import * as table from "../../codegen/builtins/lib.ts";

export default b.module({ rustPath: "crate::node::crypto" });

const INT32_MAX = 2 ** 31 - 1;
const UINT32_MAX = 2 ** 32 - 1;

const js = { capability: "js", throws: true } as const;
/** The bytes of the view are written once the operation has ended, and then the callback is called. */
const fillsLater = { buf: [...table.handedOver, table.writesContents()], callback: table.handedOver };

const stringOrBufferNames = ["string", "ArrayBuffer", "Buffer", "TypedArray", "DataView"];
const passwordAndSaltNames = { password: stringOrBufferNames, salt: stringOrBufferNames };
const stringOrBuffer = b.bytes({ from: ["string", "buffer"] });
/** For a job: the body isolates a string, and copies a buffer once nothing more can run JavaScript. */
const stringOrBufferHandle = b.bytes({ from: ["string", "buffer"], string: "asIs", held: "handle" });
const passwordAndSaltHandles = { password: stringOrBufferHandle, salt: stringOrBufferHandle };
const bufferNames = ["ArrayBuffer", "ArrayBufferView"];
const keylen = b.u32.validateInteger(0, INT32_MAX);

const pbkdf2Parameters = {
  iterations: b.u32.validateInteger(1, INT32_MAX),
  keylen,
};

export const RandomUUIDOptions = b.dictionary(
  { disableEntropyCache: { type: b.bool.default(false), expected: ["boolean"] } },
  { reportedAs: "options" },
);
const randomUUID = {
  args: { options: RandomUUIDOptions.default({}) },
  expected: { options: ["object"] },
  returns: b.string,
  length: 1,
  capability: "heap",
} as const;

const optionalUint32 = b.u32.validateInteger().optional;
export const ScryptOptions = b.dictionary(
  {
    N: optionalUint32,
    cost: optionalUint32,
    r: optionalUint32,
    blockSize: optionalUint32,
    p: optionalUint32,
    parallelization: optionalUint32,
    maxmem: b.u64.validateInteger().optional,
  },
  { allowArray: true, nonObjectAsEmpty: true, reportedAs: "" },
);

const positiveUint32 = b.u32.validateInteger(1, UINT32_MAX);
const argon2Parameters = (bytes: b.Type) => ({
  message: bytes,
  nonce: bytes,
  parallelism: positiveUint32,
  tagLength: positiveUint32,
  memory: positiveUint32,
  passes: positiveUint32,
  secret: bytes,
  associatedData: bytes,
  /** `kArgon2Types` of `crypto.ts`. */
  variant: b.u8.validateInteger(0, 2),
});

export const crypto = b.namespace({
  pbkdf2: [
    /** `callback` is optional so that a call without one is this overload and reports `digest` first. The body reports the missing `callback`. */
    {
      args: { ...passwordAndSaltHandles, ...pbkdf2Parameters, digest: b.string.utf8, callback: b.callable.optional },
      expected: { ...passwordAndSaltNames, digest: ["string"], callback: ["function"] },
      rustPath: "crate::node::crypto::pbkdf2",
      length: 6,
      ...js,
    },
    {
      args: { ...passwordAndSaltHandles, ...pbkdf2Parameters, callback: b.callable },
      expected: { ...passwordAndSaltNames, callback: ["function"] },
      rustPath: "crate::node::crypto::pbkdf2_without_digest",
      ...js,
    },
  ],
  pbkdf2Sync: {
    args: { password: stringOrBuffer, salt: stringOrBuffer, ...pbkdf2Parameters, digest: b.string.utf8 },
    expected: { ...passwordAndSaltNames, digest: ["string"] },
    returns: b.bufferSource,
    capability: "heap",
    throws: true,
  },
  randomInt: [
    {
      args: { min: b.f64, max: b.f64, callback: b.callable.optional },
      expected: { min: ["a safe integer"], max: ["a safe integer"], callback: ["function"] },
      returns: b.f64.optional,
      rustPath: "crate::node::crypto::random_int_between",
      length: 2,
      ...js,
    },
    {
      args: { max: b.f64, callback: b.callable.optional },
      expected: { max: ["a safe integer"], callback: ["function"] },
      returns: b.f64.optional,
      rustPath: "crate::node::crypto::random_int_below",
      ...js,
    },
  ],
  randomFill: [
    {
      args: { buf: b.bufferSource.allowShared, offset: b.f64, size: b.f64.optional, callback: b.callable },
      expected: { buf: bufferNames, offset: ["number"], size: ["number"], callback: ["function"] },
      rustPath: "crate::node::crypto::random_fill_range",
      uses: fillsLater,
      length: 4,
      ...js,
    },
    {
      args: { buf: b.bufferSource.allowShared, offset: b.f64, callback: b.callable },
      expected: { buf: bufferNames, offset: ["number"], callback: ["function"] },
      rustPath: "crate::node::crypto::random_fill_from_offset",
      uses: fillsLater,
      ...js,
    },
    {
      args: { buf: b.bufferSource.allowShared, callback: b.callable },
      expected: { buf: bufferNames, callback: ["function"] },
      rustPath: "crate::node::crypto::random_fill_all",
      uses: fillsLater,
      ...js,
    },
  ],
  randomFillSync: {
    args: { buf: b.bufferSource.allowShared, offset: b.f64.default(0), size: b.f64.optional },
    expected: { buf: bufferNames, offset: ["number"], size: ["number"] },
    returns: b.bufferSource.allowShared,
    length: 3,
    capability: "heap",
    throws: true,
  },
  randomUUID,
  randomUUIDv7: { ...randomUUID, rustPath: "crate::node::crypto::random_uuid_v7" },
  randomBytes: {
    args: { size: b.f64, callback: b.callable.optional },
    expected: { size: ["number"], callback: ["function"] },
    returns: b.bufferSource.optional,
    length: 2,
    capability: "js",
    throws: true,
  },
  secureHeapUsed: {},
  getFips: { returns: b.i32 },
  setFips: { length: 1 },
  setEngine: { length: 2, capability: "heap", throws: true },
  getHashes: { returns: b.array(b.string.utf8) },
  scrypt: [
    {
      args: { ...passwordAndSaltHandles, keylen, options: ScryptOptions, callback: b.callable },
      expected: { ...passwordAndSaltNames, callback: ["function"] },
      rustPath: "crate::node::crypto::scrypt",
      length: 5,
      ...js,
    },
    {
      args: { ...passwordAndSaltHandles, keylen, callback: b.callable },
      expected: { ...passwordAndSaltNames, callback: ["function"] },
      rustPath: "crate::node::crypto::scrypt_with_defaults",
      ...js,
    },
  ],
  scryptSync: {
    args: { password: stringOrBuffer, salt: stringOrBuffer, keylen, options: ScryptOptions },
    expected: passwordAndSaltNames,
    returns: b.bufferSource,
    capability: "heap",
    throws: true,
  },
  argon2: {
    args: { ...argon2Parameters(b.bytes({ from: ["buffer"], held: "copied" })), callback: b.callable },
    capability: "js",
  },
  argon2Sync: {
    args: argon2Parameters(b.bytes({ from: ["buffer"] })),
    returns: b.bufferSource,
    capability: "heap",
    throws: true,
  },
});
