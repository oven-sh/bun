import * as cryptoBrowserify from "crypto-browserify";

export const Hash = cryptoBrowserify.Hash;
export const createHash = cryptoBrowserify.createHash;
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

function nodeError(Ctor, code, message) {
  const error = new Ctor(message);
  error.code = code;
  return error;
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

// npm create-hmac reads key.length. An ArrayBuffer or a DataView has none, and the MAC would be that of an empty key.
export function createHmac(algorithm, key) {
  return cryptoBrowserify.createHmac(algorithm, typeof key === "string" ? key : toBytes(key, "key"));
}
export const Hmac = createHmac;

// The callback forms of npm randombytes and randomfill call process.nextTick, which a browser does not have.
export function randomBytes(size, callback) {
  const bytes = cryptoBrowserify.randomBytes(size);
  if (typeof callback !== "function") return bytes;
  queueMicrotask(() => callback(null, bytes));
}
export const prng = randomBytes;
export const pseudoRandomBytes = randomBytes;
export const rng = randomBytes;

function outOfRange(name, range, received) {
  return nodeError(
    RangeError,
    "ERR_OUT_OF_RANGE",
    `The value of "${name}" is out of range. It must be ${range}. Received ${received}`,
  );
}

function bytesToFill(buffer, offset = 0, size) {
  const bytes = toBytes(buffer, "buf");
  const elementSize = buffer.BYTES_PER_ELEMENT || 1;
  if (typeof offset !== "number") {
    throw nodeError(TypeError, "ERR_INVALID_ARG_TYPE", 'The "offset" argument must be of type number.');
  }
  offset *= elementSize;
  if (!(offset >= 0 && offset <= bytes.length)) throw outOfRange("offset", `>= 0 && <= ${bytes.length}`, offset);
  if (size === undefined) return bytes.subarray(offset);
  if (typeof size !== "number") {
    throw nodeError(TypeError, "ERR_INVALID_ARG_TYPE", 'The "size" argument must be of type number.');
  }
  size *= elementSize;
  if (!(size >= 0)) throw outOfRange("size", ">= 0", size);
  if (size + offset > bytes.length) throw outOfRange("size + offset", `<= ${bytes.length}`, size + offset);
  return bytes.subarray(offset, offset + size);
}

// Not npm randomfill: its browser file fills from the start of the ArrayBuffer and ignores the byteOffset of a view.
export function randomFillSync(buffer, offset, size) {
  const bytes = bytesToFill(buffer, offset, size);
  const shared = typeof SharedArrayBuffer === "function" && bytes.buffer instanceof SharedArrayBuffer;
  // getRandomValues takes at most 65536 bytes in one call. In a browser it rejects a view of a SharedArrayBuffer.
  for (let i = 0; i < bytes.length; i += 65536) {
    const chunk = bytes.subarray(i, i + 65536);
    if (shared) chunk.set(crypto.getRandomValues(new Uint8Array(chunk.length)));
    else crypto.getRandomValues(chunk);
  }
  return buffer;
}

export function randomFill(buffer, offset, size, callback) {
  if (typeof offset === "function") [offset, size, callback] = [undefined, undefined, offset];
  else if (typeof size === "function") [size, callback] = [undefined, size];
  if (typeof callback !== "function") {
    throw nodeError(TypeError, "ERR_INVALID_ARG_TYPE", 'The "callback" argument must be of type function.');
  }
  randomFillSync(buffer, offset, size);
  queueMicrotask(() => callback(null, buffer));
}

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
  timingSafeEqual,
};
