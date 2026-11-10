import { Buffer } from "buffer";
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

function nodeError(Base, code, message) {
  const error = new Base(message);
  error.code = code;
  return error;
}

// https://github.com/nodejs/node/blob/v26.3.0/lib/internal/errors.js#L1008-L1056
function determineSpecificType(value) {
  if (value === null) return "null";
  if (value === undefined) return "undefined";
  switch (typeof value) {
    case "bigint":
      return `type bigint (${value}n)`;
    case "number":
      return `type number (${Object.is(value, -0) ? "-0" : value})`;
    case "boolean":
      return `type boolean (${value})`;
    case "symbol":
      return `type symbol (${String(value)})`;
    case "function":
      return `function ${value.name}`;
    case "string":
      if (value.length > 28) value = `${value.slice(0, 25)}...`;
      return value.includes("'") ? `type string (${JSON.stringify(value)})` : `type string ('${value}')`;
  }
  if (value.constructor && "name" in value.constructor) return `an instance of ${value.constructor.name}`;
  // What util.inspect(value, { depth: -1 }) prints for a plain object.
  const empty = Object.keys(value).length === 0;
  if (Object.getPrototypeOf(value) === null) return empty ? "[Object: null prototype] {}" : "[Object: null prototype]";
  return empty ? "{}" : "[Object]";
}

// https://github.com/nodejs/node/blob/v26.3.0/lib/internal/errors.js#L1400-L1470
function ERR_INVALID_ARG_TYPE(name, expected, actual) {
  const kind = name.includes(".") ? "property" : "argument";
  const message = `The "${name}" ${kind} must be ${expected}. Received ${determineSpecificType(actual)}`;
  return nodeError(TypeError, "ERR_INVALID_ARG_TYPE", message);
}

// https://github.com/nodejs/node/blob/v26.3.0/lib/internal/errors.js#L883-L891
function addNumericalSeparator(val) {
  let res = "";
  let i = val.length;
  const start = val[0] === "-" ? 1 : 0;
  for (; i >= start + 4; i -= 3) res = `_${val.slice(i - 3, i)}${res}`;
  return `${val.slice(0, i)}${res}`;
}

// https://github.com/nodejs/node/blob/v26.3.0/lib/internal/errors.js#L1647-L1666
function ERR_OUT_OF_RANGE(name, range, input) {
  let received = String(input);
  if (Number.isInteger(input) && Math.abs(input) > 2 ** 32) received = addNumericalSeparator(received);
  const message = `The value of "${name}" is out of range. It must be ${range}. Received ${received}`;
  return nodeError(RangeError, "ERR_OUT_OF_RANGE", message);
}

function validateType(value, name, type) {
  if (typeof value !== type) throw ERR_INVALID_ARG_TYPE(name, `of type ${type}`, value);
}

// instanceof misses a buffer of another realm (an iframe). Only an isolated page has the SharedArrayBuffer global.
const hasTag = (value, tag) => Object.prototype.toString.call(value) === `[object ${tag}]`;
const isShared = buffer => !(buffer instanceof ArrayBuffer) && hasTag(buffer, "SharedArrayBuffer");
const isBufferSource = value =>
  ArrayBuffer.isView(value) || value instanceof ArrayBuffer || hasTag(value, "ArrayBuffer") || isShared(value);

function toBytes(value) {
  if (!ArrayBuffer.isView(value)) return new Uint8Array(value);
  return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
}

// https://github.com/nodejs/node/blob/v26.3.0/lib/internal/crypto/hash.js#L163-L168
export function createHmac(hmac, key, options) {
  validateType(hmac, "hmac", "string");
  let encoding;
  if (options && (encoding = options.encoding) != null) validateType(encoding, "options.encoding", "string");
  if (typeof key === "string") {
    // https://github.com/nodejs/node/blob/v26.3.0/lib/internal/crypto/util.js#L153-L157
    key = Buffer.from(key, encoding === "buffer" ? "utf8" : encoding);
  } else if (isBufferSource(key)) {
    // npm create-hmac reads key.length. An ArrayBuffer or a DataView has none: the MAC would be that of an empty key.
    key = toBytes(key);
    // npm to-buffer cannot read a long key in shared memory when the page has no SharedArrayBuffer global.
    if (isShared(key.buffer)) key = key.slice();
  } else {
    const instances = "ArrayBuffer, Buffer, TypedArray, DataView, KeyObject, or CryptoKey";
    throw ERR_INVALID_ARG_TYPE("key", `of type string or an instance of ${instances}`, key);
  }
  return cryptoBrowserify.createHmac(hmac, key);
}
export const Hmac = createHmac;

const kMaxPossibleLength = 2 ** 31 - 1;

// https://github.com/nodejs/node/blob/v26.3.0/lib/internal/crypto/random.js#L72-L98
function assertOffset(offset, elementSize, length) {
  validateType(offset, "offset", "number");
  offset *= elementSize;
  const maxLength = Math.min(length, kMaxPossibleLength);
  if (Number.isNaN(offset) || offset > maxLength || offset < 0) {
    throw ERR_OUT_OF_RANGE("offset", `>= 0 && <= ${maxLength}`, offset);
  }
  return offset >>> 0;
}

function assertSize(size, elementSize, offset, length) {
  validateType(size, "size", "number");
  size *= elementSize;
  if (Number.isNaN(size) || size > kMaxPossibleLength || size < 0) {
    throw ERR_OUT_OF_RANGE("size", `>= 0 && <= ${kMaxPossibleLength}`, size);
  }
  if (size + offset > length) {
    throw ERR_OUT_OF_RANGE("size + offset", `<= ${length}`, size + offset);
  }
  return size >>> 0;
}

function assertBuffer(buf) {
  if (!isBufferSource(buf)) throw ERR_INVALID_ARG_TYPE("buf", "an instance of ArrayBuffer or ArrayBufferView", buf);
}

function fillRange(buf, offset, size) {
  const elementSize = buf.BYTES_PER_ELEMENT || 1;
  offset = assertOffset(offset, elementSize, buf.byteLength);
  size = size === undefined ? buf.byteLength - offset : assertSize(size, elementSize, offset, buf.byteLength);
  if (size === 0) return false;
  // Not npm randomfill: its browser file fills from the start of the ArrayBuffer and ignores the byteOffset of a view.
  const bytes = ArrayBuffer.isView(buf)
    ? new Uint8Array(buf.buffer, buf.byteOffset + offset, size)
    : new Uint8Array(buf, offset, size);
  const shared = isShared(bytes.buffer);
  // getRandomValues takes at most 65536 bytes in one call. In a browser it rejects a view of a SharedArrayBuffer.
  for (let i = 0; i < size; i += 65536) {
    const chunk = bytes.subarray(i, i + 65536);
    if (shared) chunk.set(crypto.getRandomValues(new Uint8Array(chunk.length)));
    else crypto.getRandomValues(chunk);
  }
  return true;
}

// A task of its own, as in Node. Not process.nextTick: a page has none. Not a timer: a nested one takes 4 ms there.
function later(callback) {
  const { port1, port2 } = new MessageChannel();
  port1.onmessage = () => {
    port1.close();
    callback();
  };
  port2.postMessage(undefined);
}

// https://github.com/nodejs/node/blob/v26.3.0/lib/internal/crypto/random.js#L120-L196
export function randomFillSync(buf, offset = 0, size) {
  assertBuffer(buf);
  fillRange(buf, offset, size);
  return buf;
}

export function randomFill(buf, offset, size, callback) {
  assertBuffer(buf);
  if (typeof offset === "function") {
    callback = offset;
    offset = 0;
    size = buf.length;
  } else if (typeof size === "function") {
    callback = size;
    // As in Node: an ArrayBuffer or a DataView has no length, and assertSize() throws for the NaN.
    size = buf.length - offset;
  } else {
    validateType(callback, "callback", "function");
  }
  if (fillRange(buf, offset, size)) later(() => callback(null, buf));
  else callback(null, buf);
}

// https://github.com/nodejs/node/blob/v26.3.0/lib/internal/crypto/random.js#L100-L118
export function randomBytes(size, callback) {
  size = assertSize(size, 1, 0, Infinity);
  if (callback !== undefined) validateType(callback, "callback", "function");
  const buf = cryptoBrowserify.randomBytes(size);
  if (callback === undefined) return buf;
  if (size === 0) callback(null, buf);
  else later(() => callback(null, buf));
}
export const prng = randomBytes;
export const pseudoRandomBytes = randomBytes;
export const rng = randomBytes;

// https://github.com/nodejs/node/blob/v26.3.0/src/crypto/crypto_timing.cc#L23-L51
export function timingSafeEqual(buf1, buf2) {
  const expected = "argument must be an instance of ArrayBuffer, Buffer, TypedArray, or DataView.";
  if (!isBufferSource(buf1)) throw nodeError(TypeError, "ERR_INVALID_ARG_TYPE", `The "buf1" ${expected}`);
  if (!isBufferSource(buf2)) throw nodeError(TypeError, "ERR_INVALID_ARG_TYPE", `The "buf2" ${expected}`);
  const a = toBytes(buf1);
  const b = toBytes(buf2);
  if (a.length !== b.length) {
    throw nodeError(RangeError, "ERR_CRYPTO_TIMING_SAFE_EQUAL_LENGTH", "Input buffers must have the same byte length");
  }
  let difference = 0;
  for (let i = 0; i < a.length; i++) difference |= a[i] ^ b[i];
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
