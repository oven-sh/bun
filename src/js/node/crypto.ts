// Hardcoded module "node:crypto"
const StreamModule = require("node:stream");
const StringDecoder = require("node:string_decoder").StringDecoder;
const LazyTransform = require("internal/streams/lazy_transform");
const { CryptoHasher } = Bun;

const {
  symmetricKeySize,
  asymmetricKeyDetails,
  asymmetricKeyType,
  equals,
  exports,
  createSecretKey,
  createPublicKey,
  createPrivateKey,
  generateKeySync,
  generateKeyPairSync,
  publicEncrypt,
  privateDecrypt,
  privateEncrypt,
  publicDecrypt,
  X509Certificate,
} = $cpp("KeyObject.cpp", "createKeyObjectBinding");

const {
  statelessDH,
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
  DiffieHellman: _DiffieHellman,
  DiffieHellmanGroup: _DiffieHellmanGroup,
  checkPrime,
  checkPrimeSync,
  generatePrime,
  generatePrimeSync,
  Cipher,
  hkdf,
  hkdfSync,
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

const { validateObject, validateString } = require("internal/validators");

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

class KeyObject {
  // we use $bunNativePtr so that util.types.isKeyObject can detect it
  $bunNativePtr = undefined;
  constructor(key) {
    // TODO: check why this is fails
    // if(!(key instanceof CryptoKey)) {
    //   throw new TypeError("The \"key\" argument must be an instance of CryptoKey.");
    // }
    if (typeof key !== "object") {
      throw new TypeError('The "key" argument must be an instance of CryptoKey.');
    }
    this.$bunNativePtr = key;
  }

  get [Symbol.toStringTag]() {
    return "KeyObject";
  }

  static from(key) {
    if (key instanceof KeyObject) {
      key = key.$bunNativePtr;
    }
    return new KeyObject(key);
  }

  get asymmetricKeyDetails() {
    return asymmetricKeyDetails(this.$bunNativePtr);
  }

  get symmetricKeySize() {
    return symmetricKeySize(this.$bunNativePtr);
  }

  get asymmetricKeyType() {
    return asymmetricKeyType(this.$bunNativePtr);
  }

  ["export"](options) {
    switch (arguments.length) {
      case 0:
        switch (this.type) {
          case "secret":
            options = {
              format: "buffer",
            };
            break;
          case "public":
            options = {
              format: "pem",
              type: "spki",
            };
            break;
          case "private":
            options = {
              format: "pem",
              type: "pkcs8",
            };
            break;
        }
        break;
      case 1:
        if (typeof options === "object" && !options.format) {
          switch (this.type) {
            case "secret":
              options.format = "buffer";
              break;
            default:
              options.format = "pem";
              break;
          }
        }
    }
    return exports(this.$bunNativePtr, options);
  }

  equals(otherKey) {
    if (!(otherKey instanceof KeyObject)) {
      throw new TypeError("otherKey must be a KeyObject");
    }
    return equals(this.$bunNativePtr, otherKey.$bunNativePtr);
  }

  get type() {
    return this.$bunNativePtr.type;
  }
}

crypto_exports.generateKeySync = function (algorithm, options) {
  return KeyObject.from(generateKeySync(algorithm, options?.length));
};

crypto_exports.generateKey = function (algorithm, options, callback) {
  try {
    const key = KeyObject.from(generateKeySync(algorithm, options?.length));
    typeof callback === "function" && callback(null, KeyObject.from(key));
  } catch (err) {
    typeof callback === "function" && callback(err);
  }
};

function _generateKeyPairSync(algorithm, options) {
  const result = generateKeyPairSync(algorithm, options);
  if (result) {
    const publicKeyEncoding = options?.publicKeyEncoding;
    const privateKeyEncoding = options?.privateKeyEncoding;
    result.publicKey = publicKeyEncoding
      ? KeyObject.from(result.publicKey).export(publicKeyEncoding)
      : KeyObject.from(result.publicKey);
    result.privateKey = privateKeyEncoding
      ? KeyObject.from(result.privateKey).export(privateKeyEncoding)
      : KeyObject.from(result.privateKey);
  }
  return result;
}
crypto_exports.generateKeyPairSync = _generateKeyPairSync;

function _generateKeyPair(algorithm, options, callback) {
  try {
    const result = _generateKeyPairSync(algorithm, options);
    typeof callback === "function" && callback(null, result.publicKey, result.privateKey);
  } catch (err) {
    typeof callback === "function" && callback(err);
  }
}
const { defineCustomPromisifyArgs } = require("internal/promisify");
defineCustomPromisifyArgs(_generateKeyPair, ["publicKey", "privateKey"]);
crypto_exports.generateKeyPair = _generateKeyPair;

crypto_exports.createSecretKey = function (key, encoding) {
  if (key instanceof KeyObject || key instanceof CryptoKey) {
    if (key.type !== "secret") {
      const error = new TypeError(
        `ERR_CRYPTO_INVALID_KEY_OBJECT_TYPE: Invalid key object type ${key.type}, expected secret`,
      );
      error.code = "ERR_CRYPTO_INVALID_KEY_OBJECT_TYPE";
      throw error;
    }
    return KeyObject.from(key);
  }

  const buffer = getArrayBufferOrView(key, encoding || "utf8");
  return KeyObject.from(createSecretKey(buffer));
};

function _createPrivateKey(key) {
  if (typeof key === "string") {
    key = Buffer.from(key, "utf8");
    return KeyObject.from(createPrivateKey({ key, format: "pem" }));
  } else if (isAnyArrayBuffer(key) || isArrayBufferView(key)) {
    return KeyObject.from(createPrivateKey({ key, format: "pem" }));
  } else if (typeof key === "object") {
    if (key instanceof KeyObject || key instanceof CryptoKey) {
      const error = new TypeError(`ERR_CRYPTO_INVALID_KEY_OBJECT_TYPE: Invalid key object type ${key.type}`);
      error.code = "ERR_CRYPTO_INVALID_KEY_OBJECT_TYPE";
      throw error;
    } else {
      let actual_key = key.key;
      if (typeof actual_key === "string") {
        actual_key = Buffer.from(actual_key, key.encoding || "utf8");
        key.key = actual_key;
      } else if (actual_key instanceof KeyObject || actual_key instanceof CryptoKey) {
        const error = new TypeError(`ERR_CRYPTO_INVALID_KEY_OBJECT_TYPE: Invalid key object type ${key.type}`);
        error.code = "ERR_CRYPTO_INVALID_KEY_OBJECT_TYPE";
        throw error;
      }
      if (!isAnyArrayBuffer(actual_key) && !isArrayBufferView(actual_key) && typeof actual_key !== "object") {
        var error = new TypeError(
          `ERR_INVALID_ARG_TYPE: The "key" argument must be of type string or an instance of ArrayBuffer, Buffer, TypedArray, DataView or object. Received ` +
            actual_key,
        );
        error.code = "ERR_INVALID_ARG_TYPE";
        throw error;
      }
      if (!key.format) {
        key.format = "pem";
      }
      return KeyObject.from(createPrivateKey(key));
    }
  } else {
    var error = new TypeError(
      `ERR_INVALID_ARG_TYPE: The "key" argument must be of type string or an instance of ArrayBuffer, Buffer, TypedArray, DataView or object. Received ` +
        key,
    );
    error.code = "ERR_INVALID_ARG_TYPE";
    throw error;
  }
}
crypto_exports.createPrivateKey = _createPrivateKey;

function _createPublicKey(key) {
  if (typeof key === "string") {
    key = Buffer.from(key, "utf8");
    return KeyObject.from(createPublicKey({ key, format: "pem" }));
  } else if (isAnyArrayBuffer(key) || isArrayBufferView(key)) {
    return KeyObject.from(createPublicKey({ key, format: "pem" }));
  } else if (typeof key === "object") {
    if (key instanceof KeyObject || key instanceof CryptoKey) {
      if (key.type === "private") {
        return KeyObject.from(createPublicKey({ key: key.$bunNativePtr || key, format: "" }));
      }
      const error = new TypeError(
        `ERR_CRYPTO_INVALID_KEY_OBJECT_TYPE: Invalid key object type ${key.type}, expected private`,
      );
      error.code = "ERR_CRYPTO_INVALID_KEY_OBJECT_TYPE";
      throw error;
    } else {
      // must be an encrypted private key (this option is not documented at all)
      if (key.passphrase) {
        //TODO: handle encrypted keys in one native call
        let actual_key = key.key;
        if (typeof actual_key === "string") {
          actual_key = Buffer.from(actual_key, key.encoding || "utf8");
        }
        return KeyObject.from(
          createPublicKey({
            key: createPrivateKey({ key: actual_key, format: key.format || "pem", passphrase: key.passphrase }),
            format: "",
          }),
        );
      }
      let actual_key = key.key;
      if (typeof actual_key === "string") {
        actual_key = Buffer.from(actual_key, key.encoding || "utf8");
        key.key = actual_key;
      } else if (actual_key instanceof KeyObject || actual_key instanceof CryptoKey) {
        if (actual_key.type === "private") {
          return KeyObject.from(createPublicKey({ key: actual_key.$bunNativePtr || actual_key, format: "" }));
        }
        const error = new TypeError(
          `ERR_CRYPTO_INVALID_KEY_OBJECT_TYPE: Invalid key object type ${actual_key.type}, expected private`,
        );
        error.code = "ERR_CRYPTO_INVALID_KEY_OBJECT_TYPE";
        throw error;
      }
      if (!isAnyArrayBuffer(actual_key) && !isArrayBufferView(actual_key) && typeof actual_key !== "object") {
        var error = new TypeError(
          `ERR_INVALID_ARG_TYPE: The "key" argument must be of type string or an instance of ArrayBuffer, Buffer, TypedArray, DataView or object. Received ` +
            key,
        );
        error.code = "ERR_INVALID_ARG_TYPE";
        throw error;
      }
      if (!key.format) {
        key.format = "pem";
      }
      return KeyObject.from(createPublicKey(key));
    }
  } else {
    var error = new TypeError(
      `ERR_INVALID_ARG_TYPE: The "key" argument must be of type string or an instance of ArrayBuffer, Buffer, TypedArray, DataView or object. Received ` +
        key,
    );
    error.code = "ERR_INVALID_ARG_TYPE";
    throw error;
  }
}
crypto_exports.createPublicKey = _createPublicKey;
crypto_exports.KeyObject = KeyObject;
var webcrypto = crypto;
var _subtle = webcrypto.subtle;

// We are not allowed to call createPublicKey/createPrivateKey when we're already working with a
// KeyObject/CryptoKey of the same type (public/private).
function toCryptoKey(key, asPublic) {
  // Top level CryptoKey.
  if (key instanceof KeyObject || key instanceof CryptoKey) {
    if (asPublic && key.type === "private") {
      return _createPublicKey(key).$bunNativePtr;
    }
    return key.$bunNativePtr || key;
  }

  // Nested CryptoKey.
  if (key.key instanceof KeyObject || key.key instanceof CryptoKey) {
    if (asPublic && key.key.type === "private") {
      return _createPublicKey(key.key).$bunNativePtr;
    }
    return key.key.$bunNativePtr || key.key;
  }

  // One of string, ArrayBuffer, Buffer, TypedArray, DataView, or Object.
  return asPublic ? _createPublicKey(key).$bunNativePtr : _createPrivateKey(key).$bunNativePtr;
}

function doAsymmetricCipher(key, message, operation, isEncrypt) {
  // Our crypto bindings expect the key to be a `JSCryptoKey` property within an object.
  const cryptoKey = toCryptoKey(key, isEncrypt);
  const oaepLabel = typeof key.oaepLabel === "string" ? Buffer.from(key.oaepLabel, key.encoding) : key.oaepLabel;
  const keyObject = {
    key: cryptoKey,
    oaepHash: key.oaepHash,
    oaepLabel,
    padding: key.padding,
  };
  const buffer = typeof message === "string" ? Buffer.from(message, key.encoding) : message;
  return operation(keyObject, buffer);
}

crypto_exports.publicEncrypt = function (key, message) {
  return doAsymmetricCipher(key, message, publicEncrypt, true);
};

crypto_exports.privateDecrypt = function (key, message) {
  return doAsymmetricCipher(key, message, privateDecrypt, false);
};

function doAsymmetricSign(key, message, operation, isEncrypt) {
  // Our crypto bindings expect the key to be a `JSCryptoKey` property within an object.
  const cryptoKey = toCryptoKey(key, isEncrypt);
  const buffer = typeof message === "string" ? Buffer.from(message, key.encoding) : message;
  return operation(cryptoKey, buffer, key.padding);
}

crypto_exports.privateEncrypt = function (key, message) {
  return doAsymmetricSign(key, message, privateEncrypt, false);
};

crypto_exports.publicDecrypt = function (key, message) {
  return doAsymmetricSign(key, message, publicDecrypt, true);
};

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

  StreamModule.Writable.$apply(this, [options]);
}
$toClass(Sign, "Sign", StreamModule.Writable);

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

  StreamModule.Writable.$apply(this, [options]);
}
$toClass(Verify, "Verify", StreamModule.Writable);

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

export default crypto_exports;
/*! safe-buffer. MIT License. Feross Aboukhadijeh <https://feross.org/opensource> */

function createDiffieHellman(sizeOrKey, keyEncoding, generator, genEncoding) {
  return new _DiffieHellman(sizeOrKey, keyEncoding, generator, genEncoding);
}
crypto_exports.DiffieHellmanGroup = _DiffieHellmanGroup;
crypto_exports.getDiffieHellman = crypto_exports.createDiffieHellmanGroup = _DiffieHellmanGroup;
crypto_exports.createDiffieHellman = createDiffieHellman;
crypto_exports.DiffieHellman = _DiffieHellman;

crypto_exports.diffieHellman = function diffieHellman(options) {
  validateObject(options, "options");

  const { privateKey, publicKey } = options;

  if (!(privateKey instanceof KeyObject)) {
    throw $ERR_INVALID_ARG_VALUE("options.privateKey", privateKey);
  }

  if (!(publicKey instanceof KeyObject)) {
    throw $ERR_INVALID_ARG_VALUE("options.publicKey", publicKey);
  }

  if (privateKey.type !== "private") {
    throw $ERR_CRYPTO_INVALID_KEY_OBJECT_TYPE(privateKey.type, "private");
  }

  const publicKeyType = publicKey.type;
  if (publicKeyType !== "public" && publicKeyType !== "private") {
    throw $ERR_CRYPTO_INVALID_KEY_OBJECT_TYPE(publicKeyType, "private or public");
  }

  const privateType = privateKey.asymmetricKeyType;
  const publicType = publicKey.asymmetricKeyType;
  if (privateType !== publicType || !["dh", "ec", "x448", "x25519"].includes(privateType)) {
    throw $ERR_CRYPTO_INCOMPATIBLE_KEY("key types for Diffie-Hellman", `${privateType} and ${publicType}`);
  }

  return statelessDH(privateKey.$bunNativePtr, publicKey.$bunNativePtr);
};

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
