import * as cryptoBrowserify from "crypto-browserify";

export const prng = cryptoBrowserify.prng;
export const pseudoRandomBytes = cryptoBrowserify.pseudoRandomBytes;
export const rng = cryptoBrowserify.rng;
export const randomBytes = cryptoBrowserify.randomBytes;
export const Hash = cryptoBrowserify.Hash;
export const createHash = cryptoBrowserify.createHash;
export const Hmac = cryptoBrowserify.Hmac;
export const createHmac = cryptoBrowserify.createHmac;
export const getHashes = cryptoBrowserify.getHashes;
export const pbkdf2 = cryptoBrowserify.pbkdf2;
export const pbkdf2Sync = cryptoBrowserify.pbkdf2Sync;
export const Cipher = cryptoBrowserify.Cipher;
export const createCipher = cryptoBrowserify.createCipher;
export const Cipheriv = cryptoBrowserify.Cipheriv;
export const createCipheriv = cryptoBrowserify.createCipheriv;
export const Decipher = cryptoBrowserify.Decipher;
export const createDecipher = cryptoBrowserify.createDecipher;
export const Decipheriv = cryptoBrowserify.Decipheriv;
export const createDecipheriv = cryptoBrowserify.createDecipheriv;
export const getCiphers = cryptoBrowserify.getCiphers;
export const listCiphers = cryptoBrowserify.listCiphers;
export const DiffieHellmanGroup = cryptoBrowserify.DiffieHellmanGroup;
export const createDiffieHellmanGroup = cryptoBrowserify.createDiffieHellmanGroup;
export const getDiffieHellman = cryptoBrowserify.getDiffieHellman;
export const createDiffieHellman = cryptoBrowserify.createDiffieHellman;
export const DiffieHellman = cryptoBrowserify.DiffieHellman;
export const createSign = cryptoBrowserify.createSign;
export const Sign = cryptoBrowserify.Sign;
export const createVerify = cryptoBrowserify.createVerify;
export const Verify = cryptoBrowserify.Verify;
export const createECDH = cryptoBrowserify.createECDH;
export const publicEncrypt = cryptoBrowserify.publicEncrypt;
export const privateEncrypt = cryptoBrowserify.privateEncrypt;
export const publicDecrypt = cryptoBrowserify.publicDecrypt;
export const privateDecrypt = cryptoBrowserify.privateDecrypt;
export const randomFill = cryptoBrowserify.randomFill;
export const randomFillSync = cryptoBrowserify.randomFillSync;
export const createCredentials = cryptoBrowserify.createCredentials;
export const constants = cryptoBrowserify.constants;

export var DEFAULT_ENCODING = "buffer";

// we deliberately reference crypto. directly here because we want to preserve the This binding
export const getRandomValues = array => {
  return crypto.getRandomValues(array);
};

export const randomUUID = () => {
  return crypto.randomUUID();
};

const hardcoded_curves = [
  "p192",
  "p224",
  "p256",
  "p384",
  "p521",
  "curve25519",
  "ed25519",
  "secp256k1",
  "secp224r1",
  "prime256v1",
  "prime192v1",
  "ed25519",
  "secp384r1",
  "secp521r1",
];

export function getCurves() {
  return hardcoded_curves;
}

export const webcrypto = crypto;
export const subtle = crypto.subtle;

// randomInt, timingSafeEqual and getFips follow Node.js. They only need
// WebCrypto and plain JavaScript, so they do not depend on crypto-browserify.

function nodeError(Ctor, code, message) {
  const error = new Ctor(message);
  error.code = code;
  return error;
}

function describeReceived(value) {
  if (value == null) return `Received ${value}`;
  if (typeof value === "function") return `Received function ${value.name}`;
  if (typeof value === "object") return `Received an instance of ${value.constructor?.name ?? "Object"}`;
  const shown = typeof value === "string" ? `'${value}'` : typeof value === "bigint" ? `${value}n` : String(value);
  return `Received type ${typeof value} (${shown.length > 28 ? `${shown.slice(0, 25)}...` : shown})`;
}

// Node.js writes an integer above 2 ** 32 with numeric separators.
function describeNumber(value) {
  if (!Number.isInteger(value) || Math.abs(value) <= 2 ** 32) return String(value);
  const digits = String(value);
  const start = digits[0] === "-" ? 1 : 0;
  let result = "";
  let i = digits.length;
  for (; i >= start + 4; i -= 3) result = `_${digits.slice(i - 3, i)}${result}`;
  return `${digits.slice(0, i)}${result}`;
}

const RAND_MAX = 0xffff_ffff_ffff;

export function randomInt(min, max, callback) {
  // randomInt(max) and randomInt(max, callback) leave min out.
  const minNotSpecified = typeof max === "undefined" || typeof max === "function";
  if (minNotSpecified) {
    callback = max;
    max = min;
    min = 0;
  }
  const isSync = typeof callback === "undefined";
  if (!isSync && typeof callback !== "function") {
    throw nodeError(
      TypeError,
      "ERR_INVALID_ARG_TYPE",
      `The "callback" argument must be of type function. ${describeReceived(callback)}`,
    );
  }
  if (!Number.isSafeInteger(min)) {
    throw nodeError(
      TypeError,
      "ERR_INVALID_ARG_TYPE",
      `The "min" argument must be a safe integer. ${describeReceived(min)}`,
    );
  }
  if (!Number.isSafeInteger(max)) {
    throw nodeError(
      TypeError,
      "ERR_INVALID_ARG_TYPE",
      `The "max" argument must be a safe integer. ${describeReceived(max)}`,
    );
  }
  if (max <= min) {
    throw nodeError(
      RangeError,
      "ERR_OUT_OF_RANGE",
      `The value of "max" is out of range. It must be greater than the value of "min" (${min}). Received ${describeNumber(max)}`,
    );
  }
  const range = max - min;
  if (!(range <= RAND_MAX)) {
    throw nodeError(
      RangeError,
      "ERR_OUT_OF_RANGE",
      `The value of "max${minNotSpecified ? "" : " - min"}" is out of range. It must be <= ${RAND_MAX}. Received ${describeNumber(range)}`,
    );
  }
  // x % range is unbiased only when x is drawn from [0, randLimit).
  const randLimit = RAND_MAX - (RAND_MAX % range);
  const bytes = new Uint8Array(6);
  let x;
  do {
    crypto.getRandomValues(bytes);
    x = ((((bytes[0] * 256 + bytes[1]) * 256 + bytes[2]) * 256 + bytes[3]) * 256 + bytes[4]) * 256 + bytes[5];
  } while (x >= randLimit);
  const n = (x % range) + min;
  if (isSync) return n;
  queueMicrotask(() => callback(undefined, n));
}

function toBytes(value, name) {
  if (value instanceof ArrayBuffer || (typeof SharedArrayBuffer === "function" && value instanceof SharedArrayBuffer)) {
    return new Uint8Array(value);
  }
  if (ArrayBuffer.isView(value)) {
    return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  }
  throw nodeError(
    TypeError,
    "ERR_INVALID_ARG_TYPE",
    `The "${name}" argument must be an instance of ArrayBuffer, Buffer, TypedArray, or DataView.`,
  );
}

// Compares bytes, not elements, and reads every byte either way.
export function timingSafeEqual(buf1, buf2) {
  const a = toBytes(buf1, "buf1");
  const b = toBytes(buf2, "buf2");
  if (a.byteLength !== b.byteLength) {
    throw nodeError(RangeError, "ERR_CRYPTO_TIMING_SAFE_EQUAL_LENGTH", "Input buffers must have the same byte length");
  }
  let difference = 0;
  for (let i = 0; i < a.byteLength; i++) difference |= a[i] ^ b[i];
  return difference === 0;
}

// A browser has no FIPS mode.
export function getFips() {
  return 0;
}

// Node.js's default export is the module itself. It was the WebCrypto object,
// so `import crypto from "crypto"` had no createHash, randomBytes or the rest.
// The WebCrypto members stay reachable: getRandomValues, randomUUID and subtle
// are exported above.
export default {
  prng,
  pseudoRandomBytes,
  rng,
  randomBytes,
  Hash,
  createHash,
  Hmac,
  createHmac,
  getHashes,
  pbkdf2,
  pbkdf2Sync,
  Cipher,
  createCipher,
  Cipheriv,
  createCipheriv,
  Decipher,
  createDecipher,
  Decipheriv,
  createDecipheriv,
  getCiphers,
  listCiphers,
  DiffieHellmanGroup,
  createDiffieHellmanGroup,
  getDiffieHellman,
  createDiffieHellman,
  DiffieHellman,
  createSign,
  Sign,
  createVerify,
  Verify,
  createECDH,
  publicEncrypt,
  privateEncrypt,
  publicDecrypt,
  privateDecrypt,
  randomFill,
  randomFillSync,
  createCredentials,
  constants,
  DEFAULT_ENCODING,
  getRandomValues,
  randomUUID,
  getCurves,
  webcrypto,
  subtle,
  randomInt,
  timingSafeEqual,
  getFips,
};
