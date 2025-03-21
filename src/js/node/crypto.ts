// Hardcoded module "node:crypto"
var __getOwnPropNames = Object.getOwnPropertyNames;
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
  Cipher: _Cipher,
} = $cpp("node_crypto_binding.cpp", "createNodeCryptoBinding");

const {
  pbkdf2: _pbkdf2,
  pbkdf2Sync: _pbkdf2Sync,
  timingSafeEqual: _timingSafeEqual,
  randomInt,
  randomUUID,
  randomBytes,
  randomFillSync,
  randomFill,
} = $zig("node_crypto_binding.zig", "createNodeCryptoBindingZig");

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

var __commonJS = (cb, mod: typeof module | undefined = undefined) =>
  function () {
    return mod || (0, cb[__getOwnPropNames(cb)[0]])((mod = { exports: {} }).exports, mod), mod.exports;
  };

// node_modules/browserify-sign/browser/algorithms.json
var require_algorithms = __commonJS({
  "node_modules/browserify-sign/browser/algorithms.json"(exports, module) {
    module.exports = {
      sha224WithRSAEncryption: {
        sign: "rsa",
        hash: "sha224",
        id: "302d300d06096086480165030402040500041c",
      },
      "RSA-SHA224": {
        sign: "ecdsa/rsa",
        hash: "sha224",
        id: "302d300d06096086480165030402040500041c",
      },
      sha256WithRSAEncryption: {
        sign: "rsa",
        hash: "sha256",
        id: "3031300d060960864801650304020105000420",
      },
      "RSA-SHA256": {
        sign: "ecdsa/rsa",
        hash: "sha256",
        id: "3031300d060960864801650304020105000420",
      },
      sha384WithRSAEncryption: {
        sign: "rsa",
        hash: "sha384",
        id: "3041300d060960864801650304020205000430",
      },
      "RSA-SHA384": {
        sign: "ecdsa/rsa",
        hash: "sha384",
        id: "3041300d060960864801650304020205000430",
      },
      sha512WithRSAEncryption: {
        sign: "rsa",
        hash: "sha512",
        id: "3051300d060960864801650304020305000440",
      },
      "RSA-SHA512": {
        sign: "ecdsa/rsa",
        hash: "sha512",
        id: "3051300d060960864801650304020305000440",
      },
      "RSA-SHA1": {
        sign: "rsa",
        hash: "sha1",
        id: "3021300906052b0e03021a05000414",
      },
      "ecdsa-with-SHA1": {
        sign: "ecdsa",
        hash: "sha1",
        id: "3021300906052b0e03021a05000414",
      },
      sha1: {
        sign: "ecdsa/rsa",
        hash: "sha1",
        id: "3021300906052b0e03021a05000414",
      },
      sha256: {
        sign: "ecdsa/rsa",
        hash: "sha256",
        id: "3031300d060960864801650304020105000420",
      },
      sha224: {
        sign: "ecdsa/rsa",
        hash: "sha224",
        id: "302d300d06096086480165030402040500041c",
      },
      sha384: {
        sign: "ecdsa/rsa",
        hash: "sha384",
        id: "3041300d060960864801650304020205000430",
      },
      sha512: {
        sign: "ecdsa/rsa",
        hash: "sha512",
        id: "3051300d060960864801650304020305000440",
      },
      "DSA-SHA": {
        sign: "dsa",
        hash: "sha1",
        id: "",
      },
      "DSA-SHA1": {
        sign: "dsa",
        hash: "sha1",
        id: "",
      },
      DSA: {
        sign: "dsa",
        hash: "sha1",
        id: "",
      },
      "DSA-WITH-SHA224": {
        sign: "dsa",
        hash: "sha224",
        id: "",
      },
      "DSA-SHA224": {
        sign: "dsa",
        hash: "sha224",
        id: "",
      },
      "DSA-WITH-SHA256": {
        sign: "dsa",
        hash: "sha256",
        id: "",
      },
      "DSA-SHA256": {
        sign: "dsa",
        hash: "sha256",
        id: "",
      },
      "DSA-WITH-SHA384": {
        sign: "dsa",
        hash: "sha384",
        id: "",
      },
      "DSA-SHA384": {
        sign: "dsa",
        hash: "sha384",
        id: "",
      },
      "DSA-WITH-SHA512": {
        sign: "dsa",
        hash: "sha512",
        id: "",
      },
      "DSA-SHA512": {
        sign: "dsa",
        hash: "sha512",
        id: "",
      },
      "DSA-RIPEMD160": {
        sign: "dsa",
        hash: "rmd160",
        id: "",
      },
      ripemd160WithRSA: {
        sign: "rsa",
        hash: "rmd160",
        id: "3021300906052b2403020105000414",
      },
      "RSA-RIPEMD160": {
        sign: "rsa",
        hash: "rmd160",
        id: "3021300906052b2403020105000414",
      },
      md5WithRSAEncryption: {
        sign: "rsa",
        hash: "md5",
        id: "3020300c06082a864886f70d020505000410",
      },
      "RSA-MD5": {
        sign: "rsa",
        hash: "md5",
        id: "3020300c06082a864886f70d020505000410",
      },
    };
  },
});

// node_modules/browserify-sign/algos.js
var require_algos = __commonJS({
  "node_modules/browserify-sign/algos.js"(exports, module) {
    module.exports = require_algorithms();
  },
});
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

function pbkdf2Sync(password, salt, iterations, keylen, digest) {
  return _pbkdf2Sync(password, salt, iterations, keylen, digest);
}

// node_modules/crypto-browserify/index.js
var require_crypto_browserify2 = __commonJS({
  "node_modules/crypto-browserify/index.js"(exports) {
    "use strict";
    var algos = require_algos(),
      algoKeys = Object.keys(algos),
      hashes = ["sha1", "sha224", "sha256", "sha384", "sha512", "md5", "rmd160"].concat(algoKeys);
    exports.getHashes = function () {
      return hashes;
    };
    exports.pbkdf2Sync = pbkdf2Sync;
    exports.pbkdf2 = pbkdf2;

    exports.getRandomValues = values => crypto.getRandomValues(values);
    exports.constants = $processBindingConstants.crypto;
  },
});

// crypto.js
var crypto_exports = require_crypto_browserify2();

var scryptSync =
    "scryptSync" in crypto
      ? (password, salt, keylen, options) => {
          let res = crypto.scryptSync(password, salt, keylen, options);
          return new Buffer(res);
        }
      : void 0,
  scrypt =
    "scryptSync" in crypto
      ? function (password, salt, keylen, options, callback) {
          if (
            (typeof options == "function" && ((callback = options), (options = void 0)), typeof callback != "function")
          ) {
            var err = new TypeError("callback must be a function");
            throw ((err.code = "ERR_INVALID_CALLBACK"), err);
          }
          try {
            let result = crypto.scryptSync(password, salt, keylen, options);
            process.nextTick(callback, null, new Buffer(result));
          } catch (err2) {
            throw err2;
          }
        }
      : void 0;
scrypt &&
  Object.defineProperty(scrypt, "name", {
    value: "::bunternal::",
  }),
  scryptSync &&
    Object.defineProperty(scryptSync, "name", {
      value: "::bunternal::",
    });

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

crypto_exports.getFips = function getFips() {
  return 0;
};

crypto_exports.getCurves = getCurves;
crypto_exports.getCipherInfo = getCipherInfo;
crypto_exports.scrypt = scrypt;
crypto_exports.scryptSync = scryptSync;
crypto_exports.timingSafeEqual = _timingSafeEqual;
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

crypto_exports.randomInt = randomInt;
crypto_exports.randomFill = randomFill;
crypto_exports.randomFillSync = randomFillSync;
crypto_exports.randomBytes = randomBytes;
crypto_exports.randomUUID = randomUUID;

crypto_exports.checkPrime = checkPrime;
crypto_exports.checkPrimeSync = checkPrimeSync;
crypto_exports.generatePrime = generatePrime;
crypto_exports.generatePrimeSync = generatePrimeSync;

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
    throw $ERR_CRYPTO_INCOMPATIBLE_KEY(`Incompatible key types for Diffie-Hellman: ${privateType} and ${publicType}`);
  }

  return statelessDH(privateKey.$bunNativePtr, publicKey.$bunNativePtr);
};

crypto_exports.ECDH = ECDH;
crypto_exports.createECDH = function createECDH(curve) {
  return new ECDH(curve);
};

{
  function getDecoder(decoder, encoding) {
    // const normalizedEncoding = normalizeEncoding(encoding);
    decoder ||= new StringDecoder(encoding);
    if (decoder.encoding !== encoding) {
      if (encoding === undefined) {
        throw $ERR_UNKNOWN_ENCODING(encoding);
      }
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

    this[kHandle] = new _Cipher(false, cipher, key, iv, options);
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

    this[kHandle] = new _Cipher(true, cipher, key, iv, options);
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
