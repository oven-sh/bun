// Not the Buffer global: a page has none. The build gives the npm packages of this file the same polyfill.
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

function nodeError(Ctor, code, message) {
  const error = new Ctor(message);
  error.code = code;
  return error;
}

const getter = (prototype, name) => Object.getOwnPropertyDescriptor(prototype, name).get;
const slots = prototype => ["buffer", "byteOffset", "byteLength"].map(name => getter(prototype, name));
const TypedArray = Object.getPrototypeOf(Uint8Array);
const typedArrayName = getter(TypedArray.prototype, Symbol.toStringTag);
const typedArraySlots = slots(TypedArray.prototype);
const dataViewSlots = slots(DataView.prototype);
const arrayBufferByteLength = getter(ArrayBuffer.prototype, "byteLength");
const anyBuffer = "an instance of ArrayBuffer, Buffer, TypedArray, or DataView";

function doesNotThrow(run) {
  try {
    run();
    return true;
  } catch {
    return false;
  }
}

// As Node, each test reads an internal slot: a buffer of another realm (an iframe) passes, and no other object can.
const isArrayBuffer = value => doesNotThrow(() => arrayBufferByteLength.call(value));
// Only an isolated page has the SharedArrayBuffer global. A DataView takes an ArrayBuffer or shared memory.
const isArrayBufferOrShared = value => doesNotThrow(() => new DataView(value));
// The getter of ArrayBuffer throws for shared memory. The tag says which test to run first, to save that throw.
const hasSharedTag = value => Object.prototype.toString.call(value) === "[object SharedArrayBuffer]";

function toBytes(value, name, expected = anyBuffer) {
  if (ArrayBuffer.isView(value)) {
    const [buffer, byteOffset, byteLength] = typedArrayName.call(value) === undefined ? dataViewSlots : typedArraySlots;
    return new Uint8Array(buffer.call(value), byteOffset.call(value), byteLength.call(value));
  }
  if ((!hasSharedTag(value) && isArrayBuffer(value)) || isArrayBufferOrShared(value)) return new Uint8Array(value);
  throw nodeError(TypeError, "ERR_INVALID_ARG_TYPE", `The "${name}" argument must be ${expected}.`);
}

// By the name, as Node: 8 for a Float64Array, 1 for a Uint8Array. A DataView or a buffer has no name: 1.
function elementSizeOf(value) {
  const name = typedArrayName.call(value) ?? "";
  return name.includes("64") ? 8 : name.includes("32") ? 4 : name.includes("16") ? 2 : 1;
}

function checkType(value, name, type) {
  if (typeof value !== type) {
    throw nodeError(TypeError, "ERR_INVALID_ARG_TYPE", `The "${name}" argument must be of type ${type}.`);
  }
}

// npm create-hmac reads key.length. An ArrayBuffer or a DataView has none, and the MAC would be that of an empty key.
export function createHmac(algorithm, key, options) {
  checkType(algorithm, "hmac", "string");
  const encoding = options ? options.encoding : undefined;
  if (encoding != null) checkType(encoding, "options.encoding", "string");
  // npm create-hmac reads a string key as UTF-8. Node reads it with options.encoding.
  if (typeof key === "string") key = Buffer.from(key, encoding === "buffer" ? "utf8" : encoding);
  else key = toBytes(key, "key", `of type string or ${anyBuffer}`);
  return cryptoBrowserify.createHmac(algorithm, key);
}
export const Hmac = createHmac;

// The callback forms of npm randombytes and randomfill call process.nextTick, which a browser does not have.
export function randomBytes(size, callback) {
  size = checkSize(size, 1);
  if (callback !== undefined) checkType(callback, "callback", "function");
  const bytes = cryptoBrowserify.randomBytes(size);
  if (callback === undefined) return bytes;
  // As Node: with no bytes to make, the callback runs in the call.
  if (bytes.length === 0) callback(null, bytes);
  else queueMicrotask(() => callback(null, bytes));
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

const kMaxLength = 2 ** 31 - 1;

function checkSize(size, elementSize) {
  checkType(size, "size", "number");
  size *= elementSize;
  if (!(size >= 0 && size <= kMaxLength)) throw outOfRange("size", `>= 0 && <= ${kMaxLength}`, size);
  return size;
}

// As Node: offset and size count elements, and each loses its fraction. subarray drops the fraction of the end.
function bytesToFill(bytes, elementSize, offset, size) {
  checkType(offset, "offset", "number");
  offset *= elementSize;
  if (!(offset >= 0 && offset <= bytes.length)) throw outOfRange("offset", `>= 0 && <= ${bytes.length}`, offset);
  offset >>>= 0;
  if (size === undefined) return bytes.subarray(offset);
  size = checkSize(size, elementSize);
  if (size + offset > bytes.length) throw outOfRange("size + offset", `<= ${bytes.length}`, size + offset);
  return bytes.subarray(offset, offset + size);
}

// Not npm randomfill: its browser file fills from the start of the ArrayBuffer and ignores the byteOffset of a view.
function fill(bytes) {
  // Which of the two this real buffer is. instanceof saves the tag for the usual buffer.
  const shared = !(bytes.buffer instanceof ArrayBuffer) && hasSharedTag(bytes.buffer);
  // getRandomValues takes at most 65536 bytes in one call. In a browser it rejects a view of a SharedArrayBuffer.
  for (let i = 0; i < bytes.length; i += 65536) {
    const chunk = bytes.subarray(i, i + 65536);
    if (shared) chunk.set(crypto.getRandomValues(new Uint8Array(chunk.length)));
    else crypto.getRandomValues(chunk);
  }
}

export function randomFillSync(buffer, offset = 0, size) {
  fill(bytesToFill(toBytes(buffer, "buf"), elementSizeOf(buffer), offset, size));
  return buffer;
}

export function randomFill(buffer, offset, size, callback) {
  const all = toBytes(buffer, "buf");
  const elementSize = elementSizeOf(buffer);
  if (typeof offset === "function") {
    [offset, size, callback] = [0, undefined, offset];
  } else if (typeof size === "function") {
    // As Node: this size counts elements. With an offset of 1.5 it loses the last byte.
    [size, callback] = [all.length / elementSize - offset, size];
  } else {
    checkType(callback, "callback", "function");
  }
  const bytes = bytesToFill(all, elementSize, offset, size);
  fill(bytes);
  if (bytes.length === 0) callback(null, buffer);
  else queueMicrotask(() => callback(null, buffer));
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
