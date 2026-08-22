// Hardcoded module "node:crypto"
const { defineCustomPromisifyArgs } = require("internal/promisify");
const Writable = require("internal/streams/writable");
const { CryptoHasher } = Bun;

const {
  getCurves,
  certVerifySpkac,
  certExportPublicKey,
  certExportChallenge,
  getCiphers,
  getCipherInfo,
  Sign: _Sign,
  sign,
  Verify: _Verify,
  verify,
  Hmac,
  Hash,
  ECDH,
  DiffieHellman,
  DiffieHellmanGroup,
  diffieHellman,
  checkPrime,
  checkPrimeSync,
  generatePrime,
  generatePrimeSync,
  Cipheriv,
  Decipheriv,
  hkdf,
  hkdfSync,

  publicEncrypt,
  publicDecrypt,
  privateEncrypt,
  privateDecrypt,

  KeyObject,

  createSecretKey,
  createPublicKey,
  createPrivateKey,

  generateKey,
  generateKeySync,
  generateKeyPair,
  generateKeyPairSync,

  X509Certificate,
} = $cpp("node_crypto_binding.cpp", "createNodeCryptoBinding");

const {
  pbkdf2,
  pbkdf2Sync,
  timingSafeEqual,
  randomInt,
  randomUUID,
  randomUUIDv7,
  randomBytes,
  randomFillSync,
  randomFill,
  secureHeapUsed,
  getFips,
  setFips,
  setEngine,
  getHashes,
  scrypt,
  scryptSync,
  argon2: _argon2,
  argon2Sync: _argon2Sync,
} = $rust("node_crypto_binding.rs", "createNodeCryptoBindingZig");

const {
  validateFunction,
  validateInteger,
  validateObject,
  validateOneOf,
  validateString,
  validateUint32,
} = require("internal/validators");
const { deprecate } = require("internal/util/deprecate");

const kHandle = Symbol("kHandle");

function verifySpkac(spkac, encoding) {
  return certVerifySpkac(getArrayBufferOrView(spkac, "spkac", encoding));
}
function exportPublicKey(spkac, encoding) {
  return certExportPublicKey(getArrayBufferOrView(spkac, "spkac", encoding));
}
function exportChallenge(spkac, encoding) {
  return certExportChallenge(getArrayBufferOrView(spkac, "spkac", encoding));
}

function Certificate(): void {
  if (!new.target) {
    return new Certificate();
  }

  this.verifySpkac = verifySpkac;
  this.exportPublicKey = exportPublicKey;
  this.exportChallenge = exportChallenge;
}
Certificate.prototype = {};
Certificate.verifySpkac = verifySpkac;
Certificate.exportPublicKey = exportPublicKey;
Certificate.exportChallenge = exportChallenge;

var Buffer = globalThis.Buffer;
const { isAnyArrayBuffer, isArrayBufferView } = require("node:util/types");

function getArrayBufferOrView(buffer, name, encoding?) {
  if (isAnyArrayBuffer(buffer)) return buffer;
  if (typeof buffer === "string") {
    if (encoding === "buffer") encoding = "utf8";
    return Buffer.from(buffer, encoding);
  }
  if (!isArrayBufferView(buffer)) {
    throw $ERR_INVALID_ARG_TYPE(name, ["string", "ArrayBuffer", "Buffer", "TypedArray", "DataView"], buffer);
  }
  return buffer;
}

const crypto = globalThis.crypto;

var crypto_exports: any = {};

crypto_exports.getRandomValues = value => crypto.getRandomValues(value);
crypto_exports.constants = $processBindingConstants.crypto;

crypto_exports.KeyObject = KeyObject;

crypto_exports.generateKey = generateKey;
crypto_exports.generateKeySync = generateKeySync;
defineCustomPromisifyArgs(generateKeyPair, ["publicKey", "privateKey"]);
crypto_exports.generateKeyPair = generateKeyPair;
crypto_exports.generateKeyPairSync = generateKeyPairSync;

crypto_exports.createSecretKey = createSecretKey;
crypto_exports.createPublicKey = createPublicKey;
crypto_exports.createPrivateKey = createPrivateKey;

var webcrypto = crypto;
var _subtle = webcrypto.subtle;

crypto_exports.hash = function hash(algorithm, input, outputEncoding = "hex") {
  return CryptoHasher.hash(algorithm, input, outputEncoding);
};

crypto_exports.pbkdf2 = pbkdf2;
crypto_exports.pbkdf2Sync = pbkdf2Sync;

crypto_exports.hkdf = hkdf;
crypto_exports.hkdfSync = hkdfSync;

crypto_exports.getCurves = getCurves;
crypto_exports.getCipherInfo = getCipherInfo;
crypto_exports.timingSafeEqual = timingSafeEqual;
crypto_exports.webcrypto = webcrypto;
crypto_exports.subtle = _subtle;
crypto_exports.X509Certificate = X509Certificate;
crypto_exports.Certificate = Certificate;

function Sign(algorithm, options): void {
  if (!(this instanceof Sign)) {
    return new Sign(algorithm, options);
  }

  validateString(algorithm, "algorithm");
  this[kHandle] = new _Sign();
  this[kHandle].init(algorithm);

  Writable.$apply(this, [options]);
}
$toClass(Sign, "Sign", Writable);

Object.assign(Sign.prototype, {
  _write: function (chunk, encoding, callback) {
    this.update(chunk, encoding);
    callback();
  },
  update: function (data, encoding) {
    return this[kHandle].update(this, data, encoding);
  },
  sign: function (options, encoding) {
    return this[kHandle].sign(options, encoding);
  },
});

crypto_exports.Sign = Sign;
crypto_exports.sign = sign;

function createSign(algorithm, options?) {
  return new Sign(algorithm, options);
}

crypto_exports.createSign = createSign;

function Verify(algorithm, options): void {
  if (!(this instanceof Verify)) {
    return new Verify(algorithm, options);
  }

  validateString(algorithm, "algorithm");
  this[kHandle] = new _Verify();
  this[kHandle].init(algorithm);

  Writable.$apply(this, [options]);
}
$toClass(Verify, "Verify", Writable);

Verify.prototype._write = Sign.prototype._write;
Verify.prototype.update = Sign.prototype.update;

Object.assign(Verify.prototype, {
  verify: function (options, signature, sigEncoding) {
    return this[kHandle].verify(options, signature, sigEncoding);
  },
});

crypto_exports.Verify = Verify;
crypto_exports.verify = verify;

function createVerify(algorithm, options?) {
  return new Verify(algorithm, options);
}

crypto_exports.createVerify = createVerify;

crypto_exports.Hash = deprecate(Hash, "crypto.Hash constructor is deprecated.", "DEP0179");
crypto_exports.createHash = function createHash(algorithm, options) {
  return new Hash(algorithm, options);
};

crypto_exports.Hmac = deprecate(Hmac, "crypto.Hmac constructor is deprecated.", "DEP0181");
crypto_exports.createHmac = function createHmac(hmac, key, options) {
  return new Hmac(hmac, key, options);
};

crypto_exports.getHashes = getHashes;

crypto_exports.randomInt = randomInt;
crypto_exports.randomFill = randomFill;
crypto_exports.randomFillSync = randomFillSync;
crypto_exports.randomBytes = randomBytes;
crypto_exports.randomUUID = randomUUID;
crypto_exports.randomUUIDv7 = randomUUIDv7;

const kArgon2Types = { __proto__: null, argon2d: 0, argon2i: 1, argon2id: 2 };

// Node's argon2 path rejects KeyObject and throws node-formatted
// ERR_INVALID_ARG_TYPE, unlike the local `getArrayBufferOrView` above.
function getArgon2BufferSource(buffer, name) {
  if (isAnyArrayBuffer(buffer)) return buffer;
  if (typeof buffer === "string") return Buffer.from(buffer, "utf8");
  if (!isArrayBufferView(buffer)) {
    throw $ERR_INVALID_ARG_TYPE(name, ["string", "ArrayBuffer", "Buffer", "TypedArray", "DataView"], buffer);
  }
  return buffer;
}

// Mirrors `check()` in node's lib/internal/crypto/argon2.js, except a
// wrong-typed secret/associatedData names the property (node passes no name
// there and trips ERR_INTERNAL_ASSERTION on it).
function checkArgon2(algorithm, parameters) {
  validateString(algorithm, "algorithm");
  validateOneOf(algorithm, "algorithm", ["argon2d", "argon2i", "argon2id"]);
  const type = kArgon2Types[algorithm];

  validateObject(parameters, "parameters");

  const { parallelism, tagLength, memory, passes } = parameters;
  const MAX_POSITIVE_UINT_32 = 2 ** 32 - 1;

  const message = getArgon2BufferSource(parameters.message, "parameters.message");
  validateInteger(message.byteLength, "parameters.message.byteLength", 0, MAX_POSITIVE_UINT_32);

  const nonce = getArgon2BufferSource(parameters.nonce, "parameters.nonce");
  validateInteger(nonce.byteLength, "parameters.nonce.byteLength", 8, MAX_POSITIVE_UINT_32);

  validateInteger(parallelism, "parameters.parallelism", 1, 2 ** 24 - 1);
  validateInteger(tagLength, "parameters.tagLength", 4, MAX_POSITIVE_UINT_32);
  validateInteger(memory, "parameters.memory", 8 * parallelism, MAX_POSITIVE_UINT_32);
  validateUint32(passes, "parameters.passes", true);

  let secret = parameters.secret;
  if (secret === undefined) {
    secret = new Uint8Array(0);
  } else {
    secret = getArgon2BufferSource(secret, "parameters.secret");
    validateInteger(secret.byteLength, "parameters.secret.byteLength", 0, MAX_POSITIVE_UINT_32);
  }

  let associatedData = parameters.associatedData;
  if (associatedData === undefined) {
    associatedData = new Uint8Array(0);
  } else {
    associatedData = getArgon2BufferSource(associatedData, "parameters.associatedData");
    validateInteger(associatedData.byteLength, "parameters.associatedData.byteLength", 0, MAX_POSITIVE_UINT_32);
  }

  return { message, nonce, secret, associatedData, tagLength, passes, parallelism, memory, type };
}

crypto_exports.argon2 = function argon2(algorithm, parameters, callback) {
  parameters = checkArgon2(algorithm, parameters);

  validateFunction(callback, "callback");

  _argon2(
    parameters.message,
    parameters.nonce,
    parameters.parallelism,
    parameters.tagLength,
    parameters.memory,
    parameters.passes,
    parameters.secret,
    parameters.associatedData,
    parameters.type,
    (err, result) => {
      if (err !== undefined) return callback(err);
      callback(null, result);
    },
  );
};
crypto_exports.argon2Sync = function argon2Sync(algorithm, parameters) {
  parameters = checkArgon2(algorithm, parameters);

  return _argon2Sync(
    parameters.message,
    parameters.nonce,
    parameters.parallelism,
    parameters.tagLength,
    parameters.memory,
    parameters.passes,
    parameters.secret,
    parameters.associatedData,
    parameters.type,
  );
};

crypto_exports.checkPrime = checkPrime;
crypto_exports.checkPrimeSync = checkPrimeSync;
crypto_exports.generatePrime = generatePrime;
crypto_exports.generatePrimeSync = generatePrimeSync;

crypto_exports.secureHeapUsed = secureHeapUsed;
crypto_exports.setEngine = setEngine;
crypto_exports.getFips = getFips;
crypto_exports.setFips = setFips;
Object.defineProperty(crypto_exports, "fips", {
  __proto__: null,
  get: getFips,
  set: setFips,
});

for (const rng of ["pseudoRandomBytes", "prng", "rng"]) {
  Object.defineProperty(crypto_exports, rng, {
    value: deprecate(randomBytes, `crypto.${rng} is deprecated.`, "DEP0115"),
    enumerable: false,
    configurable: true,
  });
}

function createDiffieHellman(sizeOrKey, keyEncoding, generator, genEncoding) {
  return new DiffieHellman(sizeOrKey, keyEncoding, generator, genEncoding);
}
crypto_exports.DiffieHellmanGroup = DiffieHellmanGroup;
crypto_exports.getDiffieHellman = crypto_exports.createDiffieHellmanGroup = DiffieHellmanGroup;
crypto_exports.createDiffieHellman = createDiffieHellman;
crypto_exports.DiffieHellman = DiffieHellman;

crypto_exports.diffieHellman = diffieHellman;

ECDH.prototype.setPublicKey = deprecate(ECDH.prototype.setPublicKey, "ecdh.setPublicKey() is deprecated.", "DEP0031");
crypto_exports.ECDH = ECDH;
crypto_exports.createECDH = function createECDH(curve) {
  return new ECDH(curve);
};

crypto_exports.Cipheriv = Cipheriv;
crypto_exports.Decipheriv = Decipheriv;
crypto_exports.createCipheriv = function createCipheriv(cipher, key, iv, options) {
  return new Cipheriv(cipher, key, iv, options);
};
crypto_exports.createDecipheriv = function createDecipheriv(cipher, key, iv, options) {
  return new Decipheriv(cipher, key, iv, options);
};
crypto_exports.getCiphers = getCiphers;

crypto_exports.scrypt = scrypt;
crypto_exports.scryptSync = scryptSync;

crypto_exports.publicEncrypt = publicEncrypt;
crypto_exports.publicDecrypt = publicDecrypt;
crypto_exports.privateEncrypt = privateEncrypt;
crypto_exports.privateDecrypt = privateDecrypt;

export default crypto_exports;
