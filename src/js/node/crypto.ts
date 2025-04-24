// Hardcoded module "node:crypto"
const StringDecoder = require("node:string_decoder").StringDecoder;
const LazyTransform = require("internal/streams/lazy_transform");
const { defineCustomPromisifyArgs } = require("internal/promisify");
const Writable = require("internal/streams/writable");
const { CryptoHasher } = (globalThis as any).Bun; // Use Bun namespace from globalThis

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
  Hmac: _Hmac,
  Hash: _Hash,
  ECDH,
  DiffieHellman,
  DiffieHellmanGroup,
  diffieHellman,
  checkPrime,
  checkPrimeSync,
  generatePrime,
  generatePrimeSync,
  Cipher,
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
} = $cpp("node_crypto_binding.cpp", "createNodeCryptoBinding") as any; // Cast to any because the return type is complex and not fully defined

const {
  pbkdf2: _pbkdf2,
  pbkdf2Sync,
  timingSafeEqual,
  randomInt,
  randomUUID,
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
} = $zig("node_crypto_binding.zig", "createNodeCryptoBindingZig") as any; // Cast to any because the return type is complex and not fully defined

const normalizeEncoding = $newZigFunction("node_util_binding.zig", "normalizeEncoding", 1);

const { validateString } = require("internal/validators");
const { inspect } = require("node-inspect-extracted");

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
    // @ts-ignore
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

// Helper function to convert input to ArrayBuffer or ArrayBufferView
// Handles strings, ArrayBuffers, TypedArrays, DataViews, Buffers, and KeyObjects
function getArrayBufferOrView(
  inputBuffer: unknown,
  name: string,
  encoding?: BufferEncoding | "buffer",
): ArrayBuffer | ArrayBufferView {
  // Check for KeyObject first
  // Cast needed because KeyObject is defined as any in the binding return type
  if (inputBuffer instanceof (KeyObject as any)) {
    // Cast inputBuffer to KeyObject to satisfy TS18046
    const keyObject = inputBuffer as typeof KeyObject;
    if (keyObject.type !== "secret") {
      // The definition for $ERR_CRYPTO_INVALID_KEY_OBJECT_TYPE takes `any` for the first arg.
      throw $ERR_CRYPTO_INVALID_KEY_OBJECT_TYPE(keyObject.type, "secret");
    }
    // Assume KeyObject.export() returns ArrayBuffer | ArrayBufferView
    // Cast needed because KeyObject.export() return type is not precisely defined in bindings
    return keyObject.export() as ArrayBuffer | ArrayBufferView;
  } else if (isAnyArrayBuffer(inputBuffer)) {
    // isAnyArrayBuffer -> ArrayBuffer | SharedArrayBuffer
    // Cast to ArrayBuffer, assuming SharedArrayBuffer is either not expected
    // or implicitly handled downstream. This matches the original code's apparent intent.
    // The return type ArrayBuffer | ArrayBufferView covers ArrayBuffer.
    return inputBuffer as ArrayBuffer;
  } else if (typeof inputBuffer === "string") {
    const normalizedEncoding = encoding === "buffer" ? "utf8" : normalizeEncoding(encoding);
    if (normalizedEncoding === undefined) {
      // encoding must be non-null here if normalizedEncoding is undefined
      throw $ERR_UNKNOWN_ENCODING(encoding!);
    }
    return Buffer.from(inputBuffer, normalizedEncoding); // Buffer is ArrayBufferView
  } else if (isArrayBufferView(inputBuffer)) {
    // isArrayBufferView -> ArrayBufferView (TypedArray | DataView)
    return inputBuffer;
  } else {
    // All other types are invalid
    // The call is valid as $ERR_INVALID_ARG_TYPE accepts `any` for the third argument.
    throw $ERR_INVALID_ARG_TYPE(
      name,
      ["string", "ArrayBuffer", "Buffer", "TypedArray", "DataView", "KeyObject"],
      inputBuffer,
    );
  }
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

crypto_exports.webcrypto = crypto;
var _subtle = crypto.subtle;

type DigestEncoding = "hex" | "base64" | "latin1" | "binary";
type BlobOrStringOrBuffer = Blob | string | ArrayBuffer | ArrayBufferView;
type SupportedCryptoAlgorithms = string;

crypto_exports.hash = function hash(
  algorithm: SupportedCryptoAlgorithms,
  input: BlobOrStringOrBuffer,
  outputEncoding: DigestEncoding = "hex",
): string {
  // CryptoHasher.hash takes (unknown, unknown, unknown) and returns unknown
  const result = CryptoHasher.hash(algorithm as any, input as any, outputEncoding as any);
  // Cast to unknown first, then to string, as suggested by TS2352 for intentional unsafe casts.
  // This assumes the Zig implementation returns a string when outputEncoding is 'hex', 'base64', etc.
  return result as unknown as string;
};

// Wrapper for _pbkdf2 to handle both callback and promise styles
function pbkdf2(password, salt, iterations, keylen, digest, callback) {
  // Argument shuffling for optional 'digest'
  if (typeof digest === "function") {
    callback = digest;
    digest = undefined;
  }

  // Call the native function. Assume types are handled correctly by the binding.
  // _pbkdf2 returns unknown (likely any from Zig)
  const promiseOrResult = _pbkdf2(password, salt, iterations, keylen, digest, callback);

  if (typeof callback === "function") {
    // Callback style
    if (promiseOrResult instanceof Promise) {
      // If it returned a promise even with a callback (unusual but possible), handle potential errors.
      promiseOrResult.catch(() => {}); // Prevent unhandled rejection if callback throws
    }
    // Node.js callback style returns undefined
    return;
  } else {
    // Promise style
    if (!(promiseOrResult instanceof Promise)) {
      // If _pbkdf2 didn't return a promise without a callback, it's an internal error.
      return Promise.reject($ERR_INTERNAL_ASSERTION("_pbkdf2 did not return a promise when no callback was provided"));
    }
    // Cast to Promise<any> to satisfy the return type expectation
    return promiseOrResult as Promise<any>;
  }
}

crypto_exports.pbkdf2 = pbkdf2;
crypto_exports.pbkdf2Sync = pbkdf2Sync;

crypto_exports.hkdf = hkdf;
crypto_exports.hkdfSync = hkdfSync;

crypto_exports.getCurves = getCurves;
crypto_exports.getCipherInfo = getCipherInfo;
crypto_exports.timingSafeEqual = timingSafeEqual;
crypto_exports.webcrypto = crypto;
crypto_exports.subtle = _subtle;
crypto_exports.X509Certificate = X509Certificate;
crypto_exports.Certificate = Certificate;

function Sign(algorithm, options): void {
  if (!(this instanceof Sign)) {
    // @ts-ignore
    return new Sign(algorithm, options);
  }

  validateString(algorithm, "algorithm");
  this[kHandle] = new _Sign();
  this[kHandle].init(algorithm);

  Writable.$apply(this, [options]);
}
$toClass(Sign, "Sign", Writable);

Sign.prototype._write = function _write(chunk, encoding, callback) {
  this.update(chunk, encoding);
  callback();
};

Sign.prototype.update = function update(data, encoding) {
  return this[kHandle].update(this, data, encoding);
};

Sign.prototype.sign = function sign(options, encoding) {
  return this[kHandle].sign(options, encoding);
};

crypto_exports.Sign = Sign;
crypto_exports.sign = sign;

function createSign(algorithm, options?) {
  return new Sign(algorithm, options);
}

crypto_exports.createSign = createSign;

function Verify(algorithm, options): void {
  if (!(this instanceof Verify)) {
    // @ts-ignore
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

Verify.prototype.verify = function verify(options, signature, sigEncoding) {
  return this[kHandle].verify(options, signature, sigEncoding);
};

crypto_exports.Verify = Verify;
crypto_exports.verify = verify;

function createVerify(algorithm, options?) {
  return new Verify(algorithm, options);
}

crypto_exports.createVerify = createVerify;

{
  // Explicitly type the algorithm parameter to accept string or the internal handle type _Hash
  function Hash(algorithm: string | typeof _Hash, options?): void {
    if (!new.target) {
      // @ts-ignore - new.target check implies constructor call
      return new Hash(algorithm, options);
    }

    // Cast algorithm to any for the internal call, assuming C++ _Hash constructor handles string | handle
    const handle = new _Hash(algorithm as any, options);
    this[kHandle] = handle;

    LazyTransform.$apply(this, [options]);
  }
  $toClass(Hash, "Hash", LazyTransform);

  Hash.prototype.copy = function copy(options) {
    // Pass the internal handle to the constructor for copying
    // This relies on the assumption that the _Hash constructor or the Hash wrapper handles this.
    return new Hash(this[kHandle], options);
  };

  Hash.prototype._transform = function _transform(chunk, encoding, callback) {
    this[kHandle].update(this, chunk, encoding);
    callback();
  };

  Hash.prototype._flush = function _flush(callback) {
    this.push(this[kHandle].digest(null, false));
    callback();
  };

  Hash.prototype.update = function update(data, encoding) {
    return this[kHandle].update(this, data, encoding);
  };

  Hash.prototype.digest = function digest(outputEncoding) {
    return this[kHandle].digest(outputEncoding);
  };

  crypto_exports.Hash = Hash;
  crypto_exports.createHash = function createHash(algorithm, options) {
    return new Hash(algorithm, options);
  };
}

{
  function Hmac(hmac, key, options?): void {
    if (!new.target) {
      // @ts-ignore
      return new Hmac(hmac, key, options);
    }

    const handle = new _Hmac(hmac, key, options);
    this[kHandle] = handle;

    LazyTransform.$apply(this, [options]);
  }
  $toClass(Hmac, "Hmac", LazyTransform);

  Hmac.prototype.update = function update(data, encoding) {
    return this[kHandle].update(this, data, encoding);
  };

  Hmac.prototype.digest = function digest(outputEncoding) {
    return this[kHandle].digest(outputEncoding);
  };

  Hmac.prototype._transform = function _transform(chunk, encoding, callback) {
    this[kHandle].update(this, chunk, encoding);
    callback();
  };
  Hmac.prototype._flush = function _flush(callback) {
    this.push(this[kHandle].digest());
    callback();
  };

  crypto_exports.Hmac = Hmac;
  crypto_exports.createHmac = function createHmac(hmac, key, options) {
    return new Hmac(hmac, key, options);
  };
}

crypto_exports.getHashes = getHashes;

crypto_exports.randomInt = randomInt;
crypto_exports.randomFill = randomFill;
crypto_exports.randomFillSync = randomFillSync;
crypto_exports.randomBytes = randomBytes;
crypto_exports.randomUUID = randomUUID;

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
    value: randomBytes,
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

crypto_exports.ECDH = ECDH;
crypto_exports.createECDH = function createECDH(curve) {
  return new ECDH(curve);
};

{
  function getDecoder(decoder, encoding) {
    const normalizedEncoding = normalizeEncoding(encoding);
    // Ensure decoder is initialized if null/undefined
    decoder = decoder || new StringDecoder(encoding);
    if (decoder.encoding !== normalizedEncoding) {
      if (normalizedEncoding === undefined) {
        throw $ERR_UNKNOWN_ENCODING(encoding);
      }

      // Node.js throws ERR_INTERNAL_ASSERTION here in some tests.
      throw $ERR_INTERNAL_ASSERTION("Cannot change encoding");
    }
    return decoder;
  }

  function setAutoPadding(ap) {
    this[kHandle].setAutoPadding(ap);
    return this;
  }

  function getAuthTag() {
    return this[kHandle].getAuthTag();
  }

  function setAuthTag(tagbuf, encoding) {
    this[kHandle].setAuthTag(tagbuf, encoding);
    return this;
  }

  function setAAD(aadbuf, options) {
    this[kHandle].setAAD(aadbuf, options);
    return this;
  }

  function _transform(chunk, encoding, callback) {
    this.push(this[kHandle].update(chunk, encoding));
    callback();
  }

  function _flush(callback) {
    try {
      this.push(this[kHandle].final());
    } catch (e) {
      callback(e);
      return;
    }
    callback();
  }

  function update(data, inputEncoding, outputEncoding) {
    const res = this[kHandle].update(data, inputEncoding);

    if (outputEncoding && outputEncoding !== "buffer") {
      this._decoder = getDecoder(this._decoder, outputEncoding);
      return this._decoder.write(res);
    }

    return res;
  }

  function final(outputEncoding) {
    const res = this[kHandle].final();

    if (outputEncoding && outputEncoding !== "buffer") {
      this._decoder = getDecoder(this._decoder, outputEncoding);
      return this._decoder.end(res);
    }

    return res;
  }

  function Cipheriv(cipher, key, iv, options): void {
    if (!new.target) {
      // @ts-ignore
      return new Cipheriv(cipher, key, iv, options);
    }

    this[kHandle] = new Cipher(false, cipher, key, iv, options);
    LazyTransform.$apply(this, [options]);
    this._decoder = null;
  }
  $toClass(Cipheriv, "Cipheriv", LazyTransform);

  Cipheriv.prototype.setAutoPadding = setAutoPadding;
  Cipheriv.prototype.getAuthTag = getAuthTag;
  Cipheriv.prototype.setAAD = setAAD;
  Cipheriv.prototype._transform = _transform;
  Cipheriv.prototype._flush = _flush;
  Cipheriv.prototype.update = update;
  Cipheriv.prototype.final = final;

  function Decipheriv(cipher, key, iv, options): void {
    if (!new.target) {
      // @ts-ignore
      return new Decipheriv(cipher, key, iv, options);
    }

    this[kHandle] = new Cipher(true, cipher, key, iv, options);
    LazyTransform.$apply(this, [options]);
    this._decoder = null;
  }
  $toClass(Decipheriv, "Decipheriv", LazyTransform);

  Decipheriv.prototype.setAutoPadding = setAutoPadding;
  Decipheriv.prototype.setAuthTag = setAuthTag;
  Decipheriv.prototype.setAAD = setAAD;
  Decipheriv.prototype._transform = _transform;
  Decipheriv.prototype._flush = _flush;
  Decipheriv.prototype.update = update;
  Decipheriv.prototype.final = final;

  crypto_exports.Cipheriv = Cipheriv;
  crypto_exports.Decipheriv = Decipheriv;
  crypto_exports.createCipheriv = function createCipheriv(cipher, key, iv, options) {
    return new Cipheriv(cipher, key, iv, options);
  };
  crypto_exports.createDecipheriv = function createDecipheriv(cipher, key, iv, options) {
    return new Decipheriv(cipher, key, iv, options);
  };
  crypto_exports.getCiphers = getCiphers;
}

crypto_exports.scrypt = scrypt;
crypto_exports.scryptSync = scryptSync;

crypto_exports.publicEncrypt = publicEncrypt;
crypto_exports.publicDecrypt = publicDecrypt;
crypto_exports.privateEncrypt = privateEncrypt;
crypto_exports.privateDecrypt = privateDecrypt;

export default crypto_exports;