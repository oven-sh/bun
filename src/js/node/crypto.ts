// Hardcoded module "node:crypto"
const StringDecoder = require("node:string_decoder").StringDecoder;
const LazyTransform = require("internal/streams/lazy_transform");
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
} = $cpp("node_crypto_binding.cpp", "createNodeCryptoBinding");

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
} = $zig("node_crypto_binding.zig", "createNodeCryptoBindingZig");

const normalizeEncoding = $newZigFunction("node_util_binding.zig", "normalizeEncoding", 1);

const { validateString } = require("internal/validators");

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
  if (buffer instanceof KeyObject) {
    if (buffer.type !== "secret") {
      const error = new TypeError(
        `ERR_CRYPTO_INVALID_KEY_OBJECT_TYPE: Invalid key object type ${key.type}, expected secret`,
      );
      error.code = "ERR_CRYPTO_INVALID_KEY_OBJECT_TYPE";
      throw error;
    }
    buffer = buffer.export();
  }
  if (isAnyArrayBuffer(buffer)) return buffer;
  if (typeof buffer === "string") {
    if (encoding === "buffer") encoding = "utf8";
    return Buffer.from(buffer, encoding);
  }
  if (!isArrayBufferView(buffer)) {
    var error = new TypeError(
      `ERR_INVALID_ARG_TYPE: The "${name}" argument must be of type string or an instance of ArrayBuffer, Buffer, TypedArray, or DataView. Received ` +
        buffer,
    );
    error.code = "ERR_INVALID_ARG_TYPE";
    throw error;
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

// TODO: move this to zig
function pbkdf2(password, salt, iterations, keylen, digest, callback) {
  if (typeof digest === "function") {
    callback = digest;
    digest = undefined;
  }

  const promise = _pbkdf2(password, salt, iterations, keylen, digest, callback);
  if (callback) {
    promise.then(
      result => callback(null, result),
      err => callback(err),
    );
    return;
  }

  promise.then(() => {});
}

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
  function Hash(algorithm, options?): void {
    if (!new.target) {
      return new Hash(algorithm, options);
    }

    const handle = new _Hash(algorithm, options);
    this[kHandle] = handle;

    LazyTransform.$apply(this, [options]);
  }
  $toClass(Hash, "Hash", LazyTransform);

  Hash.prototype.copy = function copy(options) {
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
    decoder ||= new StringDecoder(encoding);
    if (decoder.encoding !== normalizedEncoding) {
      if (normalizedEncoding === undefined) {
        throw $ERR_UNKNOWN_ENCODING(encoding);
      }

      // there's a test for this
      // https://github.com/nodejs/node/blob/6b4255434226491449b7d925038008439e5586b2/lib/internal/crypto/cipher.js#L100
      // https://github.com/nodejs/node/blob/6b4255434226491449b7d925038008439e5586b2/test/parallel/test-crypto-encoding-validation-error.js#L31
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
