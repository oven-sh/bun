// Hardcoded module "node:crypto"
var __getOwnPropNames = Object.getOwnPropertyNames;
const StreamModule = require("node:stream");
const BufferModule = require("node:buffer");
const StringDecoder = require("node:string_decoder").StringDecoder;
const StringPrototypeToLowerCase = String.prototype.toLowerCase;
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
} = $cpp("node_crypto_binding.cpp", "createNodeCryptoBinding");

const {
  pbkdf2: _pbkdf2,
  pbkdf2Sync: _pbkdf2Sync,
  timingSafeEqual: _timingSafeEqual,
  randomInt,
  randomUUID: _randomUUID,
  randomBytes: _randomBytes,
  randomFillSync,
  randomFill: _randomFill,
} = $zig("node_crypto_binding.zig", "createNodeCryptoBindingZig");

const { validateObject, validateString, validateInt32 } = require("internal/validators");

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
const EMPTY_BUFFER = Buffer.alloc(0);
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
const globalCrypto = crypto;

var __commonJS = (cb, mod: typeof module | undefined = undefined) =>
  function () {
    return mod || (0, cb[__getOwnPropNames(cb)[0]])((mod = { exports: {} }).exports, mod), mod.exports;
  };

// node_modules/safe-buffer/index.js
var require_safe_buffer = __commonJS({
  "node_modules/safe-buffer/index.js"(exports, module) {
    var buffer = BufferModule,
      Buffer2 = buffer.Buffer;
    function copyProps(src, dst) {
      for (var key in src) dst[key] = src[key];
    }
    Buffer2.from && Buffer2.alloc && Buffer2.allocUnsafe && Buffer2.allocUnsafeSlow
      ? (module.exports = buffer)
      : (copyProps(buffer, exports), (exports.Buffer = SafeBuffer));
    function SafeBuffer(arg, encodingOrOffset, length) {
      return Buffer2(arg, encodingOrOffset, length);
    }
    SafeBuffer.prototype = Object.create(Buffer2.prototype);
    copyProps(Buffer2, SafeBuffer);
    SafeBuffer.from = function (arg, encodingOrOffset, length) {
      if (typeof arg == "number") throw new TypeError("Argument must not be a number");
      return Buffer2(arg, encodingOrOffset, length);
    };
    SafeBuffer.alloc = function (size, fill, encoding) {
      if (typeof size != "number") throw new TypeError("Argument must be a number");
      var buf = Buffer2(size);
      return (
        fill !== void 0 ? (typeof encoding == "string" ? buf.fill(fill, encoding) : buf.fill(fill)) : buf.fill(0), buf
      );
    };
    SafeBuffer.allocUnsafe = function (size) {
      if (typeof size != "number") throw new TypeError("Argument must be a number");
      return Buffer2(size);
    };
    SafeBuffer.allocUnsafeSlow = function (size) {
      if (typeof size != "number") throw new TypeError("Argument must be a number");
      return buffer.SlowBuffer(size);
    };
  },
});

// node_modules/inherits/inherits_browser.js
var require_inherits_browser = __commonJS({
  "node_modules/inherits/inherits_browser.js"(exports, module) {
    module.exports = function (ctor, superCtor) {
      superCtor &&
        ((ctor.super_ = superCtor),
        (ctor.prototype = Object.create(superCtor.prototype, {
          constructor: {
            value: ctor,
            enumerable: !1,
            writable: !0,
            configurable: !0,
          },
        })));
    };
  },
});

// node_modules/cipher-base/index.js
var require_cipher_base = __commonJS({
  "node_modules/cipher-base/index.js"(exports, module) {
    var Buffer2 = require_safe_buffer().Buffer,
      inherits = require_inherits_browser();
    function CipherBase(hashMode) {
      StreamModule.Transform.$call(this),
        (this.hashMode = typeof hashMode == "string"),
        this.hashMode ? (this[hashMode] = this._finalOrDigest) : (this.final = this._finalOrDigest),
        this._final && ((this.__final = this._final), (this._final = null)),
        (this._decoder = null),
        (this._encoding = null);
      this._finalized = !1;
    }
    inherits(CipherBase, StreamModule.Transform);
    CipherBase.prototype.update = function (data, inputEnc, outputEnc) {
      if (outputEnc === "buffer") outputEnc = undefined;
      typeof data == "string" && (data = Buffer2.from(data, inputEnc));
      var outData = this._update(data);
      return this.hashMode ? this : (outputEnc && (outData = this._toString(outData, outputEnc)), outData);
    };
    CipherBase.prototype.setAutoPadding = function () {};
    CipherBase.prototype.getAuthTag = function () {
      throw new Error("trying to get auth tag in unsupported state");
    };
    CipherBase.prototype.setAuthTag = function () {
      throw new Error("trying to set auth tag in unsupported state");
    };
    CipherBase.prototype.setAAD = function () {
      throw new Error("trying to set aad in unsupported state");
    };
    CipherBase.prototype._transform = function (data, _, next) {
      var err;
      try {
        this.hashMode ? this._update(data) : this.push(this._update(data));
      } catch (e) {
        err = e;
      } finally {
        next(err);
      }
    };
    CipherBase.prototype._flush = function (done) {
      var err;
      try {
        this.push(this.__final());
      } catch (e) {
        err = e;
      }
      done(err);
    };
    CipherBase.prototype._finalOrDigest = function (outputEnc) {
      if (outputEnc === "buffer") outputEnc = undefined;
      if (this._finalized) {
        if (!this._encoding) return Buffer2.alloc(0);
        return "";
      }

      this._finalized = !0;
      var outData = this.__final() || Buffer2.alloc(0);
      return outputEnc && (outData = this._toString(outData, outputEnc, !0)), outData;
    };
    CipherBase.prototype._toString = function (value, enc, fin) {
      if ((this._decoder || ((this._decoder = new StringDecoder(enc)), (this._encoding = enc)), this._encoding !== enc))
        throw new Error("can't switch encodings");
      var out = this._decoder.write(value);
      return fin && (out += this._decoder.end()), out;
    };
    module.exports = CipherBase;
  },
});

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

// node_modules/des.js/lib/des/utils.js
var require_utils = __commonJS({
  "node_modules/des.js/lib/des/utils.js"(exports) {
    "use strict";
    exports.readUInt32BE = function (bytes, off) {
      var res = (bytes[0 + off] << 24) | (bytes[1 + off] << 16) | (bytes[2 + off] << 8) | bytes[3 + off];
      return res >>> 0;
    };
    exports.writeUInt32BE = function (bytes, value, off) {
      (bytes[0 + off] = value >>> 24),
        (bytes[1 + off] = (value >>> 16) & 255),
        (bytes[2 + off] = (value >>> 8) & 255),
        (bytes[3 + off] = value & 255);
    };
    exports.ip = function (inL, inR, out, off) {
      for (var outL = 0, outR = 0, i = 6; i >= 0; i -= 2) {
        for (var j = 0; j <= 24; j += 8) (outL <<= 1), (outL |= (inR >>> (j + i)) & 1);
        for (var j = 0; j <= 24; j += 8) (outL <<= 1), (outL |= (inL >>> (j + i)) & 1);
      }
      for (var i = 6; i >= 0; i -= 2) {
        for (var j = 1; j <= 25; j += 8) (outR <<= 1), (outR |= (inR >>> (j + i)) & 1);
        for (var j = 1; j <= 25; j += 8) (outR <<= 1), (outR |= (inL >>> (j + i)) & 1);
      }
      (out[off + 0] = outL >>> 0), (out[off + 1] = outR >>> 0);
    };
    exports.rip = function (inL, inR, out, off) {
      for (var outL = 0, outR = 0, i = 0; i < 4; i++)
        for (var j = 24; j >= 0; j -= 8)
          (outL <<= 1), (outL |= (inR >>> (j + i)) & 1), (outL <<= 1), (outL |= (inL >>> (j + i)) & 1);
      for (var i = 4; i < 8; i++)
        for (var j = 24; j >= 0; j -= 8)
          (outR <<= 1), (outR |= (inR >>> (j + i)) & 1), (outR <<= 1), (outR |= (inL >>> (j + i)) & 1);
      (out[off + 0] = outL >>> 0), (out[off + 1] = outR >>> 0);
    };
    exports.pc1 = function (inL, inR, out, off) {
      for (var outL = 0, outR = 0, i = 7; i >= 5; i--) {
        for (var j = 0; j <= 24; j += 8) (outL <<= 1), (outL |= (inR >> (j + i)) & 1);
        for (var j = 0; j <= 24; j += 8) (outL <<= 1), (outL |= (inL >> (j + i)) & 1);
      }
      for (var j = 0; j <= 24; j += 8) (outL <<= 1), (outL |= (inR >> (j + i)) & 1);
      for (var i = 1; i <= 3; i++) {
        for (var j = 0; j <= 24; j += 8) (outR <<= 1), (outR |= (inR >> (j + i)) & 1);
        for (var j = 0; j <= 24; j += 8) (outR <<= 1), (outR |= (inL >> (j + i)) & 1);
      }
      for (var j = 0; j <= 24; j += 8) (outR <<= 1), (outR |= (inL >> (j + i)) & 1);
      (out[off + 0] = outL >>> 0), (out[off + 1] = outR >>> 0);
    };
    exports.r28shl = function (num, shift) {
      return ((num << shift) & 268435455) | (num >>> (28 - shift));
    };
    var pc2table = [
      14, 11, 17, 4, 27, 23, 25, 0, 13, 22, 7, 18, 5, 9, 16, 24, 2, 20, 12, 21, 1, 8, 15, 26, 15, 4, 25, 19, 9, 1, 26,
      16, 5, 11, 23, 8, 12, 7, 17, 0, 22, 3, 10, 14, 6, 20, 27, 24,
    ];
    exports.pc2 = function (inL, inR, out, off) {
      for (var outL = 0, outR = 0, len = pc2table.length >>> 1, i = 0; i < len; i++)
        (outL <<= 1), (outL |= (inL >>> pc2table[i]) & 1);
      for (var i = len; i < pc2table.length; i++) (outR <<= 1), (outR |= (inR >>> pc2table[i]) & 1);
      (out[off + 0] = outL >>> 0), (out[off + 1] = outR >>> 0);
    };
    exports.expand = function (r, out, off) {
      var outL = 0,
        outR = 0;
      outL = ((r & 1) << 5) | (r >>> 27);
      for (var i = 23; i >= 15; i -= 4) (outL <<= 6), (outL |= (r >>> i) & 63);
      for (var i = 11; i >= 3; i -= 4) (outR |= (r >>> i) & 63), (outR <<= 6);
      (outR |= ((r & 31) << 1) | (r >>> 31)), (out[off + 0] = outL >>> 0), (out[off + 1] = outR >>> 0);
    };
    var sTable = [
      14, 0, 4, 15, 13, 7, 1, 4, 2, 14, 15, 2, 11, 13, 8, 1, 3, 10, 10, 6, 6, 12, 12, 11, 5, 9, 9, 5, 0, 3, 7, 8, 4, 15,
      1, 12, 14, 8, 8, 2, 13, 4, 6, 9, 2, 1, 11, 7, 15, 5, 12, 11, 9, 3, 7, 14, 3, 10, 10, 0, 5, 6, 0, 13, 15, 3, 1, 13,
      8, 4, 14, 7, 6, 15, 11, 2, 3, 8, 4, 14, 9, 12, 7, 0, 2, 1, 13, 10, 12, 6, 0, 9, 5, 11, 10, 5, 0, 13, 14, 8, 7, 10,
      11, 1, 10, 3, 4, 15, 13, 4, 1, 2, 5, 11, 8, 6, 12, 7, 6, 12, 9, 0, 3, 5, 2, 14, 15, 9, 10, 13, 0, 7, 9, 0, 14, 9,
      6, 3, 3, 4, 15, 6, 5, 10, 1, 2, 13, 8, 12, 5, 7, 14, 11, 12, 4, 11, 2, 15, 8, 1, 13, 1, 6, 10, 4, 13, 9, 0, 8, 6,
      15, 9, 3, 8, 0, 7, 11, 4, 1, 15, 2, 14, 12, 3, 5, 11, 10, 5, 14, 2, 7, 12, 7, 13, 13, 8, 14, 11, 3, 5, 0, 6, 6,
      15, 9, 0, 10, 3, 1, 4, 2, 7, 8, 2, 5, 12, 11, 1, 12, 10, 4, 14, 15, 9, 10, 3, 6, 15, 9, 0, 0, 6, 12, 10, 11, 1, 7,
      13, 13, 8, 15, 9, 1, 4, 3, 5, 14, 11, 5, 12, 2, 7, 8, 2, 4, 14, 2, 14, 12, 11, 4, 2, 1, 12, 7, 4, 10, 7, 11, 13,
      6, 1, 8, 5, 5, 0, 3, 15, 15, 10, 13, 3, 0, 9, 14, 8, 9, 6, 4, 11, 2, 8, 1, 12, 11, 7, 10, 1, 13, 14, 7, 2, 8, 13,
      15, 6, 9, 15, 12, 0, 5, 9, 6, 10, 3, 4, 0, 5, 14, 3, 12, 10, 1, 15, 10, 4, 15, 2, 9, 7, 2, 12, 6, 9, 8, 5, 0, 6,
      13, 1, 3, 13, 4, 14, 14, 0, 7, 11, 5, 3, 11, 8, 9, 4, 14, 3, 15, 2, 5, 12, 2, 9, 8, 5, 12, 15, 3, 10, 7, 11, 0,
      14, 4, 1, 10, 7, 1, 6, 13, 0, 11, 8, 6, 13, 4, 13, 11, 0, 2, 11, 14, 7, 15, 4, 0, 9, 8, 1, 13, 10, 3, 14, 12, 3,
      9, 5, 7, 12, 5, 2, 10, 15, 6, 8, 1, 6, 1, 6, 4, 11, 11, 13, 13, 8, 12, 1, 3, 4, 7, 10, 14, 7, 10, 9, 15, 5, 6, 0,
      8, 15, 0, 14, 5, 2, 9, 3, 2, 12, 13, 1, 2, 15, 8, 13, 4, 8, 6, 10, 15, 3, 11, 7, 1, 4, 10, 12, 9, 5, 3, 6, 14, 11,
      5, 0, 0, 14, 12, 9, 7, 2, 7, 2, 11, 1, 4, 14, 1, 7, 9, 4, 12, 10, 14, 8, 2, 13, 0, 15, 6, 12, 10, 9, 13, 0, 15, 3,
      3, 5, 5, 6, 8, 11,
    ];
    exports.substitute = function (inL, inR) {
      for (var out = 0, i = 0; i < 4; i++) {
        var b = (inL >>> (18 - i * 6)) & 63,
          sb = sTable[i * 64 + b];
        (out <<= 4), (out |= sb);
      }
      for (var i = 0; i < 4; i++) {
        var b = (inR >>> (18 - i * 6)) & 63,
          sb = sTable[4 * 64 + i * 64 + b];
        (out <<= 4), (out |= sb);
      }
      return out >>> 0;
    };
    var permuteTable = [
      16, 25, 12, 11, 3, 20, 4, 15, 31, 17, 9, 6, 27, 14, 1, 22, 30, 24, 8, 18, 0, 5, 29, 23, 13, 19, 2, 26, 10, 21, 28,
      7,
    ];
    exports.permute = function (num) {
      for (var out = 0, i = 0; i < permuteTable.length; i++) (out <<= 1), (out |= (num >>> permuteTable[i]) & 1);
      return out >>> 0;
    };
    exports.padSplit = function (num, size, group) {
      for (var str = num.toString(2); str.length < size; ) str = "0" + str;
      for (var out = [], i = 0; i < size; i += group) out.push(str.slice(i, i + group));
      return out.join(" ");
    };
  },
});

// node_modules/minimalistic-assert/index.js
var require_minimalistic_assert = __commonJS({
  "node_modules/minimalistic-assert/index.js"(exports, module) {
    module.exports = assert;
    function assert(val, msg) {
      if (!val) throw new Error(msg || "Assertion failed");
    }
    assert.equal = function (l, r, msg) {
      if (l != r) throw new Error(msg || "Assertion failed: " + l + " != " + r);
    };
  },
});

// node_modules/des.js/lib/des/cipher.js
var require_cipher = __commonJS({
  "node_modules/des.js/lib/des/cipher.js"(exports, module) {
    "use strict";
    var assert = require_minimalistic_assert();
    function Cipher(options) {
      (this.options = options),
        (this.type = this.options.type),
        (this.blockSize = 8),
        this._init(),
        (this.buffer = new Array(this.blockSize)),
        (this.bufferOff = 0);
    }
    Cipher.prototype = {};
    module.exports = Cipher;
    Cipher.prototype._init = function () {};
    Cipher.prototype.update = function (data) {
      return data.length === 0 ? [] : this.type === "decrypt" ? this._updateDecrypt(data) : this._updateEncrypt(data);
    };
    Cipher.prototype._buffer = function (data, off) {
      for (var min = Math.min(this.buffer.length - this.bufferOff, data.length - off), i = 0; i < min; i++)
        this.buffer[this.bufferOff + i] = data[off + i];
      return (this.bufferOff += min), min;
    };
    Cipher.prototype._flushBuffer = function (out, off) {
      return this._update(this.buffer, 0, out, off), (this.bufferOff = 0), this.blockSize;
    };
    Cipher.prototype._updateEncrypt = function (data) {
      var inputOff = 0,
        outputOff = 0,
        count = ((this.bufferOff + data.length) / this.blockSize) | 0,
        out = new Array(count * this.blockSize);
      this.bufferOff !== 0 &&
        ((inputOff += this._buffer(data, inputOff)),
        this.bufferOff === this.buffer.length && (outputOff += this._flushBuffer(out, outputOff)));
      for (
        var max = data.length - ((data.length - inputOff) % this.blockSize);
        inputOff < max;
        inputOff += this.blockSize
      )
        this._update(data, inputOff, out, outputOff), (outputOff += this.blockSize);
      for (; inputOff < data.length; inputOff++, this.bufferOff++) this.buffer[this.bufferOff] = data[inputOff];
      return out;
    };
    Cipher.prototype._updateDecrypt = function (data) {
      for (
        var inputOff = 0,
          outputOff = 0,
          count = Math.ceil((this.bufferOff + data.length) / this.blockSize) - 1,
          out = new Array(count * this.blockSize);
        count > 0;
        count--
      )
        (inputOff += this._buffer(data, inputOff)), (outputOff += this._flushBuffer(out, outputOff));
      return (inputOff += this._buffer(data, inputOff)), out;
    };
    Cipher.prototype.final = function (buffer) {
      var first;
      buffer && (first = this.update(buffer));
      var last;
      return (
        this.type === "encrypt" ? (last = this._finalEncrypt()) : (last = this._finalDecrypt()),
        first ? first.concat(last) : last
      );
    };
    Cipher.prototype._pad = function (buffer, off) {
      if (off === 0) return !1;
      for (; off < buffer.length; ) buffer[off++] = 0;
      return !0;
    };
    Cipher.prototype._finalEncrypt = function () {
      if (!this._pad(this.buffer, this.bufferOff)) return [];
      var out = new Array(this.blockSize);
      return this._update(this.buffer, 0, out, 0), out;
    };
    Cipher.prototype._unpad = function (buffer) {
      return buffer;
    };
    Cipher.prototype._finalDecrypt = function () {
      assert.equal(this.bufferOff, this.blockSize, "Not enough data to decrypt");
      var out = new Array(this.blockSize);
      return this._flushBuffer(out, 0), this._unpad(out);
    };
  },
});

// node_modules/des.js/lib/des/des.js
var require_des = __commonJS({
  "node_modules/des.js/lib/des/des.js"(exports, module) {
    "use strict";
    var assert = require_minimalistic_assert(),
      inherits = require_inherits_browser(),
      utils = require_utils(),
      Cipher = require_cipher();
    function DESState() {
      (this.tmp = new Array(2)), (this.keys = null);
    }
    function DES(options) {
      Cipher.$call(this, options);
      var state = new DESState();
      (this._desState = state), this.deriveKeys(state, options.key);
    }
    inherits(DES, Cipher);
    module.exports = DES;
    DES.create = function (options) {
      return new DES(options);
    };
    var shiftTable = [1, 1, 2, 2, 2, 2, 2, 2, 1, 2, 2, 2, 2, 2, 2, 1];
    DES.prototype.deriveKeys = function (state, key) {
      (state.keys = new Array(16 * 2)), assert.equal(key.length, this.blockSize, "Invalid key length");
      var kL = utils.readUInt32BE(key, 0),
        kR = utils.readUInt32BE(key, 4);
      utils.pc1(kL, kR, state.tmp, 0), (kL = state.tmp[0]), (kR = state.tmp[1]);
      for (var i = 0; i < state.keys.length; i += 2) {
        var shift = shiftTable[i >>> 1];
        (kL = utils.r28shl(kL, shift)), (kR = utils.r28shl(kR, shift)), utils.pc2(kL, kR, state.keys, i);
      }
    };
    DES.prototype._update = function (inp, inOff, out, outOff) {
      var state = this._desState,
        l = utils.readUInt32BE(inp, inOff),
        r = utils.readUInt32BE(inp, inOff + 4);
      utils.ip(l, r, state.tmp, 0),
        (l = state.tmp[0]),
        (r = state.tmp[1]),
        this.type === "encrypt" ? this._encrypt(state, l, r, state.tmp, 0) : this._decrypt(state, l, r, state.tmp, 0),
        (l = state.tmp[0]),
        (r = state.tmp[1]),
        utils.writeUInt32BE(out, l, outOff),
        utils.writeUInt32BE(out, r, outOff + 4);
    };
    DES.prototype._pad = function (buffer, off) {
      for (var value = buffer.length - off, i = off; i < buffer.length; i++) buffer[i] = value;
      return !0;
    };
    DES.prototype._unpad = function (buffer) {
      for (var pad = buffer[buffer.length - 1], i = buffer.length - pad; i < buffer.length; i++)
        assert.equal(buffer[i], pad);
      return buffer.slice(0, buffer.length - pad);
    };
    DES.prototype._encrypt = function (state, lStart, rStart, out, off) {
      for (var l = lStart, r = rStart, i = 0; i < state.keys.length; i += 2) {
        var keyL = state.keys[i],
          keyR = state.keys[i + 1];
        utils.expand(r, state.tmp, 0), (keyL ^= state.tmp[0]), (keyR ^= state.tmp[1]);
        var s = utils.substitute(keyL, keyR),
          f = utils.permute(s),
          t = r;
        (r = (l ^ f) >>> 0), (l = t);
      }
      utils.rip(r, l, out, off);
    };
    DES.prototype._decrypt = function (state, lStart, rStart, out, off) {
      for (var l = rStart, r = lStart, i = state.keys.length - 2; i >= 0; i -= 2) {
        var keyL = state.keys[i],
          keyR = state.keys[i + 1];
        utils.expand(l, state.tmp, 0), (keyL ^= state.tmp[0]), (keyR ^= state.tmp[1]);
        var s = utils.substitute(keyL, keyR),
          f = utils.permute(s),
          t = l;
        (l = (r ^ f) >>> 0), (r = t);
      }
      utils.rip(l, r, out, off);
    };
  },
});

// node_modules/des.js/lib/des/cbc.js
var require_cbc = __commonJS({
  "node_modules/des.js/lib/des/cbc.js"(exports) {
    "use strict";
    var assert = require_minimalistic_assert(),
      inherits = require_inherits_browser(),
      proto = {};
    function CBCState(iv) {
      assert.equal(iv.length, 8, "Invalid IV length"), (this.iv = new Array(8));
      for (var i = 0; i < this.iv.length; i++) this.iv[i] = iv[i];
    }
    function instantiate(Base) {
      function CBC(options) {
        Base.$call(this, options), this._cbcInit();
      }
      inherits(CBC, Base);
      for (var keys = Object.keys(proto), i = 0; i < keys.length; i++) {
        var key = keys[i];
        CBC.prototype[key] = proto[key];
      }
      return (
        (CBC.create = function (options) {
          return new CBC(options);
        }),
        CBC
      );
    }
    exports.instantiate = instantiate;
    proto._cbcInit = function () {
      var state = new CBCState(this.options.iv);
      this._cbcState = state;
    };
    proto._update = function (inp, inOff, out, outOff) {
      var state = this._cbcState,
        superProto = this.constructor.super_.prototype,
        iv = state.iv;
      if (this.type === "encrypt") {
        for (var i = 0; i < this.blockSize; i++) iv[i] ^= inp[inOff + i];
        superProto._update.$call(this, iv, 0, out, outOff);
        for (var i = 0; i < this.blockSize; i++) iv[i] = out[outOff + i];
      } else {
        superProto._update.$call(this, inp, inOff, out, outOff);
        for (var i = 0; i < this.blockSize; i++) out[outOff + i] ^= iv[i];
        for (var i = 0; i < this.blockSize; i++) iv[i] = inp[inOff + i];
      }
    };
  },
});

// node_modules/des.js/lib/des/ede.js
var require_ede = __commonJS({
  "node_modules/des.js/lib/des/ede.js"(exports, module) {
    "use strict";
    var assert = require_minimalistic_assert(),
      inherits = require_inherits_browser(),
      Cipher = require_cipher(),
      DES = require_des();
    function EDEState(type, key) {
      assert.equal(key.length, 24, "Invalid key length");
      var k1 = key.slice(0, 8),
        k2 = key.slice(8, 16),
        k3 = key.slice(16, 24);
      type === "encrypt"
        ? (this.ciphers = [
            DES.create({ type: "encrypt", key: k1 }),
            DES.create({ type: "decrypt", key: k2 }),
            DES.create({ type: "encrypt", key: k3 }),
          ])
        : (this.ciphers = [
            DES.create({ type: "decrypt", key: k3 }),
            DES.create({ type: "encrypt", key: k2 }),
            DES.create({ type: "decrypt", key: k1 }),
          ]);
    }
    function EDE(options) {
      Cipher.$call(this, options);
      var state = new EDEState(this.type, this.options.key);
      this._edeState = state;
    }
    inherits(EDE, Cipher);
    module.exports = EDE;
    EDE.create = function (options) {
      return new EDE(options);
    };
    EDE.prototype._update = function (inp, inOff, out, outOff) {
      var state = this._edeState;
      state.ciphers[0]._update(inp, inOff, out, outOff),
        state.ciphers[1]._update(out, outOff, out, outOff),
        state.ciphers[2]._update(out, outOff, out, outOff);
    };
    EDE.prototype._pad = DES.prototype._pad;
    EDE.prototype._unpad = DES.prototype._unpad;
  },
});

// node_modules/des.js/lib/des.js
var require_des2 = __commonJS({
  "node_modules/des.js/lib/des.js"(exports) {
    "use strict";
    exports.utils = require_utils();
    exports.Cipher = require_cipher();
    exports.DES = require_des();
    exports.CBC = require_cbc();
    exports.EDE = require_ede();
  },
});

// node_modules/browserify-des/index.js
var require_browserify_des = __commonJS({
  "node_modules/browserify-des/index.js"(exports, module) {
    var CipherBase = require_cipher_base(),
      des = require_des2(),
      inherits = require_inherits_browser(),
      Buffer2 = require_safe_buffer().Buffer,
      modes = {
        "des-ede3-cbc": des.CBC.instantiate(des.EDE),
        "des-ede3": des.EDE,
        "des-ede-cbc": des.CBC.instantiate(des.EDE),
        "des-ede": des.EDE,
        "des-cbc": des.CBC.instantiate(des.DES),
        "des-ecb": des.DES,
      };
    modes.des = modes["des-cbc"];
    modes.des3 = modes["des-ede3-cbc"];
    module.exports = DES;
    inherits(DES, CipherBase);
    function DES(opts) {
      CipherBase.$call(this);
      var modeName = opts.mode.toLowerCase(),
        mode = modes[modeName],
        type;
      opts.decrypt ? (type = "decrypt") : (type = "encrypt");
      var key = opts.key;
      Buffer2.isBuffer(key) || (key = Buffer2.from(key)),
        (modeName === "des-ede" || modeName === "des-ede-cbc") && (key = Buffer2.concat([key, key.slice(0, 8)]));
      var iv = opts.iv;
      Buffer2.isBuffer(iv) || (iv = Buffer2.from(iv)),
        (this._des = mode.create({
          key,
          iv,
          type,
        }));
    }
    DES.prototype._update = function (data) {
      return Buffer2.from(this._des.update(data));
    };
    DES.prototype._final = function () {
      return Buffer2.from(this._des.final());
    };
  },
});

// node_modules/browserify-aes/modes/ecb.js
var require_ecb = __commonJS({
  "node_modules/browserify-aes/modes/ecb.js"(exports) {
    exports.encrypt = function (self2, block) {
      return self2._cipher.encryptBlock(block);
    };
    exports.decrypt = function (self2, block) {
      return self2._cipher.decryptBlock(block);
    };
  },
});

// node_modules/buffer-xor/index.js
var require_buffer_xor = __commonJS({
  "node_modules/buffer-xor/index.js"(exports, module) {
    module.exports = function (a, b) {
      for (var length = Math.min(a.length, b.length), buffer = new Buffer(length), i = 0; i < length; ++i)
        buffer[i] = a[i] ^ b[i];
      return buffer;
    };
  },
});

// node_modules/browserify-aes/modes/cbc.js
var require_cbc2 = __commonJS({
  "node_modules/browserify-aes/modes/cbc.js"(exports) {
    var xor = require_buffer_xor();
    exports.encrypt = function (self2, block) {
      var data = xor(block, self2._prev);
      return (self2._prev = self2._cipher.encryptBlock(data)), self2._prev;
    };
    exports.decrypt = function (self2, block) {
      var pad = self2._prev;
      self2._prev = block;
      var out = self2._cipher.decryptBlock(block);
      return xor(out, pad);
    };
  },
});

// node_modules/browserify-aes/modes/cfb.js
var require_cfb = __commonJS({
  "node_modules/browserify-aes/modes/cfb.js"(exports) {
    var Buffer2 = require_safe_buffer().Buffer,
      xor = require_buffer_xor();
    function encryptStart(self2, data, decrypt) {
      var len = data.length,
        out = xor(data, self2._cache);
      return (
        (self2._cache = self2._cache.slice(len)),
        (self2._prev = Buffer2.concat([self2._prev, decrypt ? data : out])),
        out
      );
    }
    exports.encrypt = function (self2, data, decrypt) {
      for (var out = Buffer2.allocUnsafe(0), len; data.length; )
        if (
          (self2._cache.length === 0 &&
            ((self2._cache = self2._cipher.encryptBlock(self2._prev)), (self2._prev = Buffer2.allocUnsafe(0))),
          self2._cache.length <= data.length)
        )
          (len = self2._cache.length),
            (out = Buffer2.concat([out, encryptStart(self2, data.slice(0, len), decrypt)])),
            (data = data.slice(len));
        else {
          out = Buffer2.concat([out, encryptStart(self2, data, decrypt)]);
          break;
        }
      return out;
    };
  },
});

// node_modules/browserify-aes/modes/cfb8.js
var require_cfb8 = __commonJS({
  "node_modules/browserify-aes/modes/cfb8.js"(exports) {
    var Buffer2 = require_safe_buffer().Buffer;
    function encryptByte(self2, byteParam, decrypt) {
      var pad = self2._cipher.encryptBlock(self2._prev),
        out = pad[0] ^ byteParam;
      return (self2._prev = Buffer2.concat([self2._prev.slice(1), Buffer2.from([decrypt ? byteParam : out])])), out;
    }
    exports.encrypt = function (self2, chunk, decrypt) {
      for (var len = chunk.length, out = Buffer2.allocUnsafe(len), i = -1; ++i < len; )
        out[i] = encryptByte(self2, chunk[i], decrypt);
      return out;
    };
  },
});

// node_modules/browserify-aes/modes/cfb1.js
var require_cfb1 = __commonJS({
  "node_modules/browserify-aes/modes/cfb1.js"(exports) {
    var Buffer2 = require_safe_buffer().Buffer;
    function encryptByte(self2, byteParam, decrypt) {
      for (var pad, i = -1, len = 8, out = 0, bit, value; ++i < len; )
        (pad = self2._cipher.encryptBlock(self2._prev)),
          (bit = byteParam & (1 << (7 - i)) ? 128 : 0),
          (value = pad[0] ^ bit),
          (out += (value & 128) >> i % 8),
          (self2._prev = shiftIn(self2._prev, decrypt ? bit : value));
      return out;
    }
    function shiftIn(buffer, value) {
      var len = buffer.length,
        i = -1,
        out = Buffer2.allocUnsafe(buffer.length);
      for (buffer = Buffer2.concat([buffer, Buffer2.from([value])]); ++i < len; )
        out[i] = (buffer[i] << 1) | (buffer[i + 1] >> 7);
      return out;
    }
    exports.encrypt = function (self2, chunk, decrypt) {
      for (var len = chunk.length, out = Buffer2.allocUnsafe(len), i = -1; ++i < len; )
        out[i] = encryptByte(self2, chunk[i], decrypt);
      return out;
    };
  },
});

// node_modules/browserify-aes/modes/ofb.js
var require_ofb = __commonJS({
  "node_modules/browserify-aes/modes/ofb.js"(exports) {
    var xor = require_buffer_xor();
    function getBlock(self2) {
      return (self2._prev = self2._cipher.encryptBlock(self2._prev)), self2._prev;
    }
    exports.encrypt = function (self2, chunk) {
      for (; self2._cache.length < chunk.length; ) self2._cache = Buffer.concat([self2._cache, getBlock(self2)]);
      var pad = self2._cache.slice(0, chunk.length);
      return (self2._cache = self2._cache.slice(chunk.length)), xor(chunk, pad);
    };
  },
});

// node_modules/browserify-aes/incr32.js
var require_incr32 = __commonJS({
  "node_modules/browserify-aes/incr32.js"(exports, module) {
    function incr32(iv) {
      for (var len = iv.length, item; len--; )
        if (((item = iv.readUInt8(len)), item === 255)) iv.writeUInt8(0, len);
        else {
          item++, iv.writeUInt8(item, len);
          break;
        }
    }
    module.exports = incr32;
  },
});

// node_modules/browserify-aes/modes/ctr.js
var require_ctr = __commonJS({
  "node_modules/browserify-aes/modes/ctr.js"(exports) {
    var xor = require_buffer_xor(),
      Buffer2 = require_safe_buffer().Buffer,
      incr32 = require_incr32();
    function getBlock(self2) {
      var out = self2._cipher.encryptBlockRaw(self2._prev);
      return incr32(self2._prev), out;
    }
    var blockSize = 16;
    exports.encrypt = function (self2, chunk) {
      var chunkNum = Math.ceil(chunk.length / blockSize),
        start = self2._cache.length;
      self2._cache = Buffer2.concat([self2._cache, Buffer2.allocUnsafe(chunkNum * blockSize)]);
      for (var i = 0; i < chunkNum; i++) {
        var out = getBlock(self2),
          offset = start + i * blockSize;
        self2._cache.writeUInt32BE(out[0], offset + 0),
          self2._cache.writeUInt32BE(out[1], offset + 4),
          self2._cache.writeUInt32BE(out[2], offset + 8),
          self2._cache.writeUInt32BE(out[3], offset + 12);
      }
      var pad = self2._cache.slice(0, chunk.length);
      return (self2._cache = self2._cache.slice(chunk.length)), xor(chunk, pad);
    };
  },
});

// node_modules/browserify-aes/modes/list.json
var require_list = __commonJS({
  "node_modules/browserify-aes/modes/list.json"(exports, module) {
    module.exports = {
      "aes-128-ecb": {
        cipher: "AES",
        key: 128,
        iv: 0,
        mode: "ECB",
        type: "block",
      },
      "aes-192-ecb": {
        cipher: "AES",
        key: 192,
        iv: 0,
        mode: "ECB",
        type: "block",
      },
      "aes-256-ecb": {
        cipher: "AES",
        key: 256,
        iv: 0,
        mode: "ECB",
        type: "block",
      },
      "aes-128-cbc": {
        cipher: "AES",
        key: 128,
        iv: 16,
        mode: "CBC",
        type: "block",
      },
      "aes-192-cbc": {
        cipher: "AES",
        key: 192,
        iv: 16,
        mode: "CBC",
        type: "block",
      },
      "aes-256-cbc": {
        cipher: "AES",
        key: 256,
        iv: 16,
        mode: "CBC",
        type: "block",
      },
      aes128: {
        cipher: "AES",
        key: 128,
        iv: 16,
        mode: "CBC",
        type: "block",
      },
      aes192: {
        cipher: "AES",
        key: 192,
        iv: 16,
        mode: "CBC",
        type: "block",
      },
      aes256: {
        cipher: "AES",
        key: 256,
        iv: 16,
        mode: "CBC",
        type: "block",
      },
      "aes-128-cfb": {
        cipher: "AES",
        key: 128,
        iv: 16,
        mode: "CFB",
        type: "stream",
      },
      "aes-192-cfb": {
        cipher: "AES",
        key: 192,
        iv: 16,
        mode: "CFB",
        type: "stream",
      },
      "aes-256-cfb": {
        cipher: "AES",
        key: 256,
        iv: 16,
        mode: "CFB",
        type: "stream",
      },
      "aes-128-cfb8": {
        cipher: "AES",
        key: 128,
        iv: 16,
        mode: "CFB8",
        type: "stream",
      },
      "aes-192-cfb8": {
        cipher: "AES",
        key: 192,
        iv: 16,
        mode: "CFB8",
        type: "stream",
      },
      "aes-256-cfb8": {
        cipher: "AES",
        key: 256,
        iv: 16,
        mode: "CFB8",
        type: "stream",
      },
      "aes-128-cfb1": {
        cipher: "AES",
        key: 128,
        iv: 16,
        mode: "CFB1",
        type: "stream",
      },
      "aes-192-cfb1": {
        cipher: "AES",
        key: 192,
        iv: 16,
        mode: "CFB1",
        type: "stream",
      },
      "aes-256-cfb1": {
        cipher: "AES",
        key: 256,
        iv: 16,
        mode: "CFB1",
        type: "stream",
      },
      "aes-128-ofb": {
        cipher: "AES",
        key: 128,
        iv: 16,
        mode: "OFB",
        type: "stream",
      },
      "aes-192-ofb": {
        cipher: "AES",
        key: 192,
        iv: 16,
        mode: "OFB",
        type: "stream",
      },
      "aes-256-ofb": {
        cipher: "AES",
        key: 256,
        iv: 16,
        mode: "OFB",
        type: "stream",
      },
      "aes-128-ctr": {
        cipher: "AES",
        key: 128,
        iv: 16,
        mode: "CTR",
        type: "stream",
      },
      "aes-192-ctr": {
        cipher: "AES",
        key: 192,
        iv: 16,
        mode: "CTR",
        type: "stream",
      },
      "aes-256-ctr": {
        cipher: "AES",
        key: 256,
        iv: 16,
        mode: "CTR",
        type: "stream",
      },
      "aes-128-gcm": {
        cipher: "AES",
        key: 128,
        iv: 12,
        mode: "GCM",
        type: "auth",
      },
      "aes-192-gcm": {
        cipher: "AES",
        key: 192,
        iv: 12,
        mode: "GCM",
        type: "auth",
      },
      "aes-256-gcm": {
        cipher: "AES",
        key: 256,
        iv: 12,
        mode: "GCM",
        type: "auth",
      },
    };
  },
});

// node_modules/browserify-aes/modes/index.js
var require_modes = __commonJS({
  "node_modules/browserify-aes/modes/index.js"(exports, module) {
    var modeModules = {
        ECB: require_ecb(),
        CBC: require_cbc2(),
        CFB: require_cfb(),
        CFB8: require_cfb8(),
        CFB1: require_cfb1(),
        OFB: require_ofb(),
        CTR: require_ctr(),
        GCM: require_ctr(),
      },
      modes = require_list();
    for (key in modes) modes[key].module = modeModules[modes[key].mode];
    var key;
    module.exports = modes;
  },
});

// node_modules/browserify-aes/aes.js
var require_aes = __commonJS({
  "node_modules/browserify-aes/aes.js"(exports, module) {
    var Buffer2 = require_safe_buffer().Buffer;
    function asUInt32Array(buf) {
      if (buf instanceof KeyObject) {
        buf = buf.export();
      } else if (buf instanceof CryptoKey) {
        buf = KeyObject.from(buf).export();
      }
      Buffer2.isBuffer(buf) || (buf = Buffer2.from(buf));
      for (var len = (buf.length / 4) | 0, out = new Array(len), i = 0; i < len; i++) out[i] = buf.readUInt32BE(i * 4);
      return out;
    }
    function scrubVec(v) {
      for (var i = 0; i < v.length; v++) v[i] = 0;
    }
    function cryptBlock(M, keySchedule, SUB_MIX, SBOX, nRounds) {
      for (
        var SUB_MIX0 = SUB_MIX[0],
          SUB_MIX1 = SUB_MIX[1],
          SUB_MIX2 = SUB_MIX[2],
          SUB_MIX3 = SUB_MIX[3],
          s0 = M[0] ^ keySchedule[0],
          s1 = M[1] ^ keySchedule[1],
          s2 = M[2] ^ keySchedule[2],
          s3 = M[3] ^ keySchedule[3],
          t0,
          t1,
          t2,
          t3,
          ksRow = 4,
          round = 1;
        round < nRounds;
        round++
      )
        (t0 =
          SUB_MIX0[s0 >>> 24] ^
          SUB_MIX1[(s1 >>> 16) & 255] ^
          SUB_MIX2[(s2 >>> 8) & 255] ^
          SUB_MIX3[s3 & 255] ^
          keySchedule[ksRow++]),
          (t1 =
            SUB_MIX0[s1 >>> 24] ^
            SUB_MIX1[(s2 >>> 16) & 255] ^
            SUB_MIX2[(s3 >>> 8) & 255] ^
            SUB_MIX3[s0 & 255] ^
            keySchedule[ksRow++]),
          (t2 =
            SUB_MIX0[s2 >>> 24] ^
            SUB_MIX1[(s3 >>> 16) & 255] ^
            SUB_MIX2[(s0 >>> 8) & 255] ^
            SUB_MIX3[s1 & 255] ^
            keySchedule[ksRow++]),
          (t3 =
            SUB_MIX0[s3 >>> 24] ^
            SUB_MIX1[(s0 >>> 16) & 255] ^
            SUB_MIX2[(s1 >>> 8) & 255] ^
            SUB_MIX3[s2 & 255] ^
            keySchedule[ksRow++]),
          (s0 = t0),
          (s1 = t1),
          (s2 = t2),
          (s3 = t3);
      return (
        (t0 =
          ((SBOX[s0 >>> 24] << 24) | (SBOX[(s1 >>> 16) & 255] << 16) | (SBOX[(s2 >>> 8) & 255] << 8) | SBOX[s3 & 255]) ^
          keySchedule[ksRow++]),
        (t1 =
          ((SBOX[s1 >>> 24] << 24) | (SBOX[(s2 >>> 16) & 255] << 16) | (SBOX[(s3 >>> 8) & 255] << 8) | SBOX[s0 & 255]) ^
          keySchedule[ksRow++]),
        (t2 =
          ((SBOX[s2 >>> 24] << 24) | (SBOX[(s3 >>> 16) & 255] << 16) | (SBOX[(s0 >>> 8) & 255] << 8) | SBOX[s1 & 255]) ^
          keySchedule[ksRow++]),
        (t3 =
          ((SBOX[s3 >>> 24] << 24) | (SBOX[(s0 >>> 16) & 255] << 16) | (SBOX[(s1 >>> 8) & 255] << 8) | SBOX[s2 & 255]) ^
          keySchedule[ksRow++]),
        (t0 = t0 >>> 0),
        (t1 = t1 >>> 0),
        (t2 = t2 >>> 0),
        (t3 = t3 >>> 0),
        [t0, t1, t2, t3]
      );
    }
    var RCON = [0, 1, 2, 4, 8, 16, 32, 64, 128, 27, 54],
      G = (function () {
        for (var d = new Array(256), j = 0; j < 256; j++) j < 128 ? (d[j] = j << 1) : (d[j] = (j << 1) ^ 283);
        for (
          var SBOX = [],
            INV_SBOX = [],
            SUB_MIX = [[], [], [], []],
            INV_SUB_MIX = [[], [], [], []],
            x = 0,
            xi = 0,
            i = 0;
          i < 256;
          ++i
        ) {
          var sx = xi ^ (xi << 1) ^ (xi << 2) ^ (xi << 3) ^ (xi << 4);
          (sx = (sx >>> 8) ^ (sx & 255) ^ 99), (SBOX[x] = sx), (INV_SBOX[sx] = x);
          var x2 = d[x],
            x4 = d[x2],
            x8 = d[x4],
            t = (d[sx] * 257) ^ (sx * 16843008);
          (SUB_MIX[0][x] = (t << 24) | (t >>> 8)),
            (SUB_MIX[1][x] = (t << 16) | (t >>> 16)),
            (SUB_MIX[2][x] = (t << 8) | (t >>> 24)),
            (SUB_MIX[3][x] = t),
            (t = (x8 * 16843009) ^ (x4 * 65537) ^ (x2 * 257) ^ (x * 16843008)),
            (INV_SUB_MIX[0][sx] = (t << 24) | (t >>> 8)),
            (INV_SUB_MIX[1][sx] = (t << 16) | (t >>> 16)),
            (INV_SUB_MIX[2][sx] = (t << 8) | (t >>> 24)),
            (INV_SUB_MIX[3][sx] = t),
            x === 0 ? (x = xi = 1) : ((x = x2 ^ d[d[d[x8 ^ x2]]]), (xi ^= d[d[xi]]));
        }
        return {
          SBOX,
          INV_SBOX,
          SUB_MIX,
          INV_SUB_MIX,
        };
      })();
    function AES(key) {
      (this._key = asUInt32Array(key)), this._reset();
    }
    AES.prototype = {};
    AES.blockSize = 4 * 4;
    AES.keySize = 256 / 8;
    AES.prototype.blockSize = AES.blockSize;
    AES.prototype.keySize = AES.keySize;
    AES.prototype._reset = function () {
      for (
        var keyWords = this._key,
          keySize = keyWords.length,
          nRounds = keySize + 6,
          ksRows = (nRounds + 1) * 4,
          keySchedule = [],
          k = 0;
        k < keySize;
        k++
      )
        keySchedule[k] = keyWords[k];
      for (k = keySize; k < ksRows; k++) {
        var t = keySchedule[k - 1];
        k % keySize === 0
          ? ((t = (t << 8) | (t >>> 24)),
            (t =
              (G.SBOX[t >>> 24] << 24) |
              (G.SBOX[(t >>> 16) & 255] << 16) |
              (G.SBOX[(t >>> 8) & 255] << 8) |
              G.SBOX[t & 255]),
            (t ^= RCON[(k / keySize) | 0] << 24))
          : keySize > 6 &&
            k % keySize === 4 &&
            (t =
              (G.SBOX[t >>> 24] << 24) |
              (G.SBOX[(t >>> 16) & 255] << 16) |
              (G.SBOX[(t >>> 8) & 255] << 8) |
              G.SBOX[t & 255]),
          (keySchedule[k] = keySchedule[k - keySize] ^ t);
      }
      for (var invKeySchedule = [], ik = 0; ik < ksRows; ik++) {
        var ksR = ksRows - ik,
          tt = keySchedule[ksR - (ik % 4 ? 0 : 4)];
        ik < 4 || ksR <= 4
          ? (invKeySchedule[ik] = tt)
          : (invKeySchedule[ik] =
              G.INV_SUB_MIX[0][G.SBOX[tt >>> 24]] ^
              G.INV_SUB_MIX[1][G.SBOX[(tt >>> 16) & 255]] ^
              G.INV_SUB_MIX[2][G.SBOX[(tt >>> 8) & 255]] ^
              G.INV_SUB_MIX[3][G.SBOX[tt & 255]]);
      }
      (this._nRounds = nRounds), (this._keySchedule = keySchedule), (this._invKeySchedule = invKeySchedule);
    };
    AES.prototype.encryptBlockRaw = function (M) {
      return (M = asUInt32Array(M)), cryptBlock(M, this._keySchedule, G.SUB_MIX, G.SBOX, this._nRounds);
    };
    AES.prototype.encryptBlock = function (M) {
      var out = this.encryptBlockRaw(M),
        buf = Buffer2.allocUnsafe(16);
      return (
        buf.writeUInt32BE(out[0], 0),
        buf.writeUInt32BE(out[1], 4),
        buf.writeUInt32BE(out[2], 8),
        buf.writeUInt32BE(out[3], 12),
        buf
      );
    };
    AES.prototype.decryptBlock = function (M) {
      M = asUInt32Array(M);
      var m1 = M[1];
      (M[1] = M[3]), (M[3] = m1);
      var out = cryptBlock(M, this._invKeySchedule, G.INV_SUB_MIX, G.INV_SBOX, this._nRounds),
        buf = Buffer2.allocUnsafe(16);
      return (
        buf.writeUInt32BE(out[0], 0),
        buf.writeUInt32BE(out[3], 4),
        buf.writeUInt32BE(out[2], 8),
        buf.writeUInt32BE(out[1], 12),
        buf
      );
    };
    AES.prototype.scrub = function () {
      scrubVec(this._keySchedule), scrubVec(this._invKeySchedule), scrubVec(this._key);
    };
    module.exports.AES = AES;
  },
});

// node_modules/browserify-aes/ghash.js
var require_ghash = __commonJS({
  "node_modules/browserify-aes/ghash.js"(exports, module) {
    var Buffer2 = require_safe_buffer().Buffer,
      ZEROES = Buffer2.alloc(16, 0);
    function toArray(buf) {
      return [buf.readUInt32BE(0), buf.readUInt32BE(4), buf.readUInt32BE(8), buf.readUInt32BE(12)];
    }
    function fromArray(out) {
      var buf = Buffer2.allocUnsafe(16);
      return (
        buf.writeUInt32BE(out[0] >>> 0, 0),
        buf.writeUInt32BE(out[1] >>> 0, 4),
        buf.writeUInt32BE(out[2] >>> 0, 8),
        buf.writeUInt32BE(out[3] >>> 0, 12),
        buf
      );
    }
    function GHASH(key) {
      (this.h = key), (this.state = Buffer2.alloc(16, 0)), (this.cache = Buffer2.allocUnsafe(0));
    }
    GHASH.prototype = {};
    GHASH.prototype.ghash = function (block) {
      for (var i = -1; ++i < block.length; ) this.state[i] ^= block[i];
      this._multiply();
    };
    GHASH.prototype._multiply = function () {
      for (var Vi = toArray(this.h), Zi = [0, 0, 0, 0], j, xi, lsbVi, i = -1; ++i < 128; ) {
        for (
          xi = (this.state[~~(i / 8)] & (1 << (7 - (i % 8)))) !== 0,
            xi && ((Zi[0] ^= Vi[0]), (Zi[1] ^= Vi[1]), (Zi[2] ^= Vi[2]), (Zi[3] ^= Vi[3])),
            lsbVi = (Vi[3] & 1) !== 0,
            j = 3;
          j > 0;
          j--
        )
          Vi[j] = (Vi[j] >>> 1) | ((Vi[j - 1] & 1) << 31);
        (Vi[0] = Vi[0] >>> 1), lsbVi && (Vi[0] = Vi[0] ^ (225 << 24));
      }
      this.state = fromArray(Zi);
    };
    GHASH.prototype.update = function (buf) {
      this.cache = Buffer2.concat([this.cache, buf]);
      for (var chunk; this.cache.length >= 16; )
        (chunk = this.cache.slice(0, 16)), (this.cache = this.cache.slice(16)), this.ghash(chunk);
    };
    GHASH.prototype.final = function (abl, bl) {
      return (
        this.cache.length && this.ghash(Buffer2.concat([this.cache, ZEROES], 16)),
        this.ghash(fromArray([0, abl, 0, bl])),
        this.state
      );
    };
    module.exports = GHASH;
  },
});

// node_modules/browserify-aes/authCipher.js
var require_authCipher = __commonJS({
  "node_modules/browserify-aes/authCipher.js"(exports, module) {
    var aes = require_aes(),
      Buffer2 = require_safe_buffer().Buffer,
      Transform = require_cipher_base(),
      inherits = require_inherits_browser(),
      GHASH = require_ghash(),
      xor = require_buffer_xor(),
      incr32 = require_incr32();
    function xorTest(a, b) {
      var out = 0;
      a.length !== b.length && out++;
      for (var len = Math.min(a.length, b.length), i = 0; i < len; ++i) out += a[i] ^ b[i];
      return out;
    }
    function calcIv(self2, iv, ck) {
      if (iv.length === 12)
        return (
          (self2._finID = Buffer2.concat([iv, Buffer2.from([0, 0, 0, 1])])),
          Buffer2.concat([iv, Buffer2.from([0, 0, 0, 2])])
        );
      var ghash = new GHASH(ck),
        len = iv.length,
        toPad = len % 16;
      ghash.update(iv),
        toPad && ((toPad = 16 - toPad), ghash.update(Buffer2.alloc(toPad, 0))),
        ghash.update(Buffer2.alloc(8, 0));
      var ivBits = len * 8,
        tail = Buffer2.alloc(8);
      tail.writeUIntBE(ivBits, 2, 6), ghash.update(tail), (self2._finID = ghash.state);
      var out = Buffer2.from(self2._finID);
      return incr32(out), out;
    }
    function StreamCipher(mode, key, iv, decrypt) {
      Transform.$call(this);
      var h = Buffer2.alloc(4, 0);
      this._cipher = new aes.AES(key);
      var ck = this._cipher.encryptBlock(h);
      (this._ghash = new GHASH(ck)),
        (iv = calcIv(this, iv, ck)),
        (this._prev = Buffer2.from(iv)),
        (this._cache = Buffer2.allocUnsafe(0)),
        (this._secCache = Buffer2.allocUnsafe(0)),
        (this._decrypt = decrypt),
        (this._alen = 0),
        (this._len = 0),
        (this._mode = mode),
        (this._authTag = null),
        (this._called = !1);
    }
    inherits(StreamCipher, Transform);
    StreamCipher.prototype._update = function (chunk) {
      if (!this._called && this._alen) {
        var rump = 16 - (this._alen % 16);
        rump < 16 && ((rump = Buffer2.alloc(rump, 0)), this._ghash.update(rump));
      }
      this._called = !0;
      var out = this._mode.encrypt(this, chunk);
      return this._decrypt ? this._ghash.update(chunk) : this._ghash.update(out), (this._len += chunk.length), out;
    };
    StreamCipher.prototype._final = function () {
      if (this._decrypt && !this._authTag) throw new Error("Unsupported state or unable to authenticate data");
      var tag = xor(this._ghash.final(this._alen * 8, this._len * 8), this._cipher.encryptBlock(this._finID));
      if (this._decrypt && xorTest(tag, this._authTag))
        throw new Error("Unsupported state or unable to authenticate data");
      (this._authTag = tag), this._cipher.scrub();
    };
    StreamCipher.prototype.getAuthTag = function () {
      if (this._decrypt || !Buffer2.isBuffer(this._authTag))
        throw new Error("Attempting to get auth tag in unsupported state");
      return this._authTag;
    };
    StreamCipher.prototype.setAuthTag = function (tag) {
      if (!this._decrypt) throw new Error("Attempting to set auth tag in unsupported state");
      this._authTag = tag;
    };
    StreamCipher.prototype.setAAD = function (buf) {
      if (this._called) throw new Error("Attempting to set AAD in unsupported state");
      this._ghash.update(buf), (this._alen += buf.length);
    };
    module.exports = StreamCipher;
  },
});

// node_modules/browserify-aes/streamCipher.js
var require_streamCipher = __commonJS({
  "node_modules/browserify-aes/streamCipher.js"(exports, module) {
    var aes = require_aes(),
      Buffer2 = require_safe_buffer().Buffer,
      Transform = require_cipher_base(),
      inherits = require_inherits_browser();
    function StreamCipher(mode, key, iv, decrypt) {
      Transform.$call(this),
        (this._cipher = new aes.AES(key)),
        (this._prev = Buffer2.from(iv)),
        (this._cache = Buffer2.allocUnsafe(0)),
        (this._secCache = Buffer2.allocUnsafe(0)),
        (this._decrypt = decrypt),
        (this._mode = mode);
    }
    inherits(StreamCipher, Transform);
    StreamCipher.prototype._update = function (chunk) {
      return this._mode.encrypt(this, chunk, this._decrypt);
    };
    StreamCipher.prototype._final = function () {
      this._cipher.scrub();
    };
    module.exports = StreamCipher;
  },
});

// node_modules/evp_bytestokey/index.js
var require_evp_bytestokey = __commonJS({
  "node_modules/evp_bytestokey/index.js"(exports, module) {
    var Buffer2 = require_safe_buffer().Buffer;
    function EVP_BytesToKey(password, salt, keyBits, ivLen) {
      if (
        (Buffer2.isBuffer(password) || (password = Buffer2.from(password, "binary")),
        salt && (Buffer2.isBuffer(salt) || (salt = Buffer2.from(salt, "binary")), salt.length !== 8))
      )
        throw new RangeError("salt should be Buffer with 8 byte length");
      for (
        var keyLen = keyBits / 8, key = Buffer2.alloc(keyLen), iv = Buffer2.alloc(ivLen || 0), tmp = Buffer2.alloc(0);
        keyLen > 0 || ivLen > 0;

      ) {
        var hash = new Hash("md5");
        hash.update(tmp), hash.update(password), salt && hash.update(salt), (tmp = hash.digest());
        var used = 0;
        if (keyLen > 0) {
          var keyStart = key.length - keyLen;
          (used = Math.min(keyLen, tmp.length)), tmp.copy(key, keyStart, 0, used), (keyLen -= used);
        }
        if (used < tmp.length && ivLen > 0) {
          var ivStart = iv.length - ivLen,
            length = Math.min(ivLen, tmp.length - used);
          tmp.copy(iv, ivStart, used, used + length), (ivLen -= length);
        }
      }
      return tmp.fill(0), { key, iv };
    }
    module.exports = EVP_BytesToKey;
  },
});

// node_modules/browserify-aes/encrypter.js
var require_encrypter = __commonJS({
  "node_modules/browserify-aes/encrypter.js"(exports) {
    var MODES = require_modes(),
      AuthCipher = require_authCipher(),
      Buffer2 = require_safe_buffer().Buffer,
      StreamCipher = require_streamCipher(),
      Transform = require_cipher_base(),
      aes = require_aes(),
      ebtk = require_evp_bytestokey(),
      inherits = require_inherits_browser();
    function Cipher(mode, key, iv) {
      Transform.$call(this),
        (this._cache = new Splitter()),
        (this._cipher = new aes.AES(key)),
        (this._prev = Buffer2.from(iv)),
        (this._mode = mode),
        (this._autopadding = !0);
    }
    inherits(Cipher, Transform);
    Cipher.prototype._update = function (data) {
      this._cache.add(data);
      for (var chunk, thing, out = []; (chunk = this._cache.get()); )
        (thing = this._mode.encrypt(this, chunk)), out.push(thing);
      return Buffer2.concat(out);
    };
    var PADDING = Buffer2.alloc(16, 16);
    Cipher.prototype._final = function () {
      var chunk = this._cache.flush();
      if (this._autopadding) return (chunk = this._mode.encrypt(this, chunk)), this._cipher.scrub(), chunk;
      if (!chunk.equals(PADDING)) throw (this._cipher.scrub(), new Error("data not multiple of block length"));
    };
    Cipher.prototype.setAutoPadding = function (setTo) {
      return (this._autopadding = !!setTo), this;
    };
    function Splitter() {
      this.cache = Buffer2.allocUnsafe(0);
    }
    Splitter.prototype = {};
    Splitter.prototype.add = function (data) {
      this.cache = Buffer2.concat([this.cache, data]);
    };
    Splitter.prototype.get = function () {
      if (this.cache.length > 15) {
        var out = this.cache.slice(0, 16);
        return (this.cache = this.cache.slice(16)), out;
      }
      return null;
    };
    Splitter.prototype.flush = function () {
      for (var len = 16 - this.cache.length, padBuff = Buffer2.allocUnsafe(len), i = -1; ++i < len; )
        padBuff.writeUInt8(len, i);
      return Buffer2.concat([this.cache, padBuff]);
    };
    function createCipheriv(suite, password, iv) {
      var config = MODES[suite.toLowerCase()];
      if (!config) throw new TypeError("invalid suite type");
      password = getArrayBufferOrView(password, "password");
      const iv_length = iv?.length || 0;
      const required_iv_length = config.iv || 0;
      iv = iv === null ? EMPTY_BUFFER : getArrayBufferOrView(iv, "iv");

      if (password?.length !== config.key / 8) {
        var error = new RangeError("Invalid key length");
        error.code = "ERR_CRYPTO_INVALID_KEYLEN";
        throw error;
      }
      if (config.mode !== "GCM" && iv_length !== required_iv_length) {
        var error = new RangeError("Invalid key length");
        error.code = "ERR_CRYPTO_INVALID_KEYLEN";
        throw error;
      }

      return config.type === "stream"
        ? new StreamCipher(config.module, password, iv)
        : config.type === "auth"
          ? new AuthCipher(config.module, password, iv)
          : new Cipher(config.module, password, iv);
    }
    function createCipher(suite, password) {
      var config = MODES[suite.toLowerCase()];
      if (!config) throw new TypeError("invalid suite type");
      var keys = ebtk(password, !1, config.key, config.iv);
      return createCipheriv(suite, keys.key, keys.iv);
    }
    exports.createCipheriv = createCipheriv;
    exports.createCipher = createCipher;
  },
});

// node_modules/browserify-aes/decrypter.js
var require_decrypter = __commonJS({
  "node_modules/browserify-aes/decrypter.js"(exports) {
    var AuthCipher = require_authCipher(),
      Buffer2 = require_safe_buffer().Buffer,
      MODES = require_modes(),
      StreamCipher = require_streamCipher(),
      Transform = require_cipher_base(),
      aes = require_aes(),
      ebtk = require_evp_bytestokey(),
      inherits = require_inherits_browser();
    function Decipher(mode, key, iv) {
      Transform.$call(this),
        (this._cache = new Splitter()),
        (this._last = void 0),
        (this._cipher = new aes.AES(key)),
        (this._prev = Buffer2.from(iv)),
        (this._mode = mode),
        (this._autopadding = !0);
    }
    inherits(Decipher, Transform);
    Decipher.prototype._update = function (data) {
      this._cache.add(data);
      for (var chunk, thing, out = []; (chunk = this._cache.get(this._autopadding)); )
        (thing = this._mode.decrypt(this, chunk)), out.push(thing);
      return Buffer2.concat(out);
    };
    Decipher.prototype._final = function () {
      var chunk = this._cache.flush();
      if (this._autopadding) return unpad(this._mode.decrypt(this, chunk));
      if (chunk) throw new Error("data not multiple of block length");
    };
    Decipher.prototype.setAutoPadding = function (setTo) {
      return (this._autopadding = !!setTo), this;
    };
    function Splitter() {
      this.cache = Buffer2.allocUnsafe(0);
    }
    Splitter.prototype = {};
    Splitter.prototype.add = function (data) {
      this.cache = Buffer2.concat([this.cache, data]);
    };
    Splitter.prototype.get = function (autoPadding) {
      var out;
      if (autoPadding) {
        if (this.cache.length > 16) return (out = this.cache.slice(0, 16)), (this.cache = this.cache.slice(16)), out;
      } else if (this.cache.length >= 16)
        return (out = this.cache.slice(0, 16)), (this.cache = this.cache.slice(16)), out;
      return null;
    };
    Splitter.prototype.flush = function () {
      if (this.cache.length) return this.cache;
    };
    function unpad(last) {
      var padded = last[15];
      if (padded < 1 || padded > 16) throw new Error("unable to decrypt data");
      for (var i = -1; ++i < padded; )
        if (last[i + (16 - padded)] !== padded) throw new Error("unable to decrypt data");
      if (padded !== 16) return last.slice(0, 16 - padded);
    }
    function createDecipheriv(suite, password, iv) {
      var config = MODES[suite.toLowerCase()];
      if (!config) throw new TypeError("invalid suite type");

      password = getArrayBufferOrView(password, "password");
      const iv_length = iv?.length || 0;
      const required_iv_length = config.iv || 0;
      iv = iv === null ? EMPTY_BUFFER : getArrayBufferOrView(iv, "iv");

      if (config.mode !== "GCM" && iv_length !== required_iv_length) {
        var error = new RangeError("Invalid key length");
        error.code = "ERR_CRYPTO_INVALID_KEYLEN";
        throw error;
      }
      if (password.length !== config.key / 8) {
        var error = new RangeError("Invalid key length");
        error.code = "ERR_CRYPTO_INVALID_KEYLEN";
        throw error;
      }
      return config.type === "stream"
        ? new StreamCipher(config.module, password, iv, !0)
        : config.type === "auth"
          ? new AuthCipher(config.module, password, iv, !0)
          : new Decipher(config.module, password, iv);
    }
    function createDecipher(suite, password) {
      var config = MODES[suite.toLowerCase()];
      if (!config) throw new TypeError("invalid suite type");
      var keys = ebtk(password, !1, config.key, config.iv);
      return createDecipheriv(suite, keys.key, keys.iv);
    }
    exports.createDecipher = createDecipher;
    exports.createDecipheriv = createDecipheriv;
  },
});

// node_modules/browserify-aes/browser.js
var require_browser5 = __commonJS({
  "node_modules/browserify-aes/browser.js"(exports) {
    var ciphers = require_encrypter(),
      deciphers = require_decrypter();
    exports.createCipher = exports.Cipher = ciphers.createCipher;
    exports.createCipheriv = exports.Cipheriv = ciphers.createCipheriv;
    exports.createDecipher = exports.Decipher = deciphers.createDecipher;
    exports.createDecipheriv = exports.Decipheriv = deciphers.createDecipheriv;
    exports.listCiphers = exports.getCiphers = getCiphers;
  },
});

// node_modules/browserify-des/modes.js
var require_modes2 = __commonJS({
  "node_modules/browserify-des/modes.js"(exports) {
    exports["des-ecb"] = {
      key: 8,
      iv: 0,
    };
    exports["des-cbc"] = exports.des = {
      key: 8,
      iv: 8,
    };
    exports["des-ede3-cbc"] = exports.des3 = {
      key: 24,
      iv: 8,
    };
    exports["des-ede3"] = {
      key: 24,
      iv: 0,
    };
    exports["des-ede-cbc"] = {
      key: 16,
      iv: 8,
    };
    exports["des-ede"] = {
      key: 16,
      iv: 0,
    };
  },
});

// node_modules/browserify-cipher/browser.js
var require_browser6 = __commonJS({
  "node_modules/browserify-cipher/browser.js"(exports) {
    var DES = require_browserify_des(),
      aes = require_browser5(),
      aesModes = require_modes(),
      desModes = require_modes2(),
      ebtk = require_evp_bytestokey();
    function createCipher(suite, password) {
      suite = suite.toLowerCase();
      var keyLen, ivLen;
      if (aesModes[suite]) (keyLen = aesModes[suite].key), (ivLen = aesModes[suite].iv);
      else if (desModes[suite]) (keyLen = desModes[suite].key * 8), (ivLen = desModes[suite].iv);
      else throw new TypeError("invalid suite type");
      var keys = ebtk(password, !1, keyLen, ivLen);
      return createCipheriv(suite, keys.key, keys.iv);
    }
    function createDecipher(suite, password) {
      suite = suite.toLowerCase();
      var keyLen, ivLen;
      if (aesModes[suite]) (keyLen = aesModes[suite].key), (ivLen = aesModes[suite].iv);
      else if (desModes[suite]) (keyLen = desModes[suite].key * 8), (ivLen = desModes[suite].iv);
      else throw new TypeError("invalid suite type");
      var keys = ebtk(password, !1, keyLen, ivLen);
      return createDecipheriv(suite, keys.key, keys.iv);
    }
    function createCipheriv(suite, key, iv) {
      if (((suite = suite.toLowerCase()), aesModes[suite])) return aes.createCipheriv(suite, key, iv);
      if (desModes[suite]) return new DES({ key, iv, mode: suite });
      throw new TypeError("invalid suite type");
    }
    function createDecipheriv(suite, key, iv) {
      if (((suite = suite.toLowerCase()), aesModes[suite])) return aes.createDecipheriv(suite, key, iv);
      if (desModes[suite]) return new DES({ key, iv, mode: suite, decrypt: !0 });
      throw new TypeError("invalid suite type");
    }
    exports.createCipher = exports.Cipher = createCipher;
    exports.createCipheriv = exports.Cipheriv = createCipheriv;
    exports.createDecipher = exports.Decipher = createDecipher;
    exports.createDecipheriv = exports.Decipheriv = createDecipheriv;
    exports.listCiphers = exports.getCiphers = getCiphers;
  },
});

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
    var aes = require_browser6();
    exports.Cipher = aes.Cipher;
    exports.createCipher = aes.createCipher;
    exports.Cipheriv = aes.Cipheriv;
    exports.createCipheriv = aes.createCipheriv;
    exports.Decipher = aes.Decipher;
    exports.createDecipher = aes.createDecipher;
    exports.Decipheriv = aes.Decipheriv;
    exports.createDecipheriv = aes.createDecipheriv;
    exports.getCiphers = getCiphers;
    exports.listCiphers = aes.listCiphers;

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

crypto_exports.randomUUID = _randomUUID;
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

function randomBytes(size, callback) {
  if (callback === undefined) {
    return _randomBytes(size);
  }

  // Crypto random promise job is guaranteed to resolve.
  _randomBytes(size, callback).then(buf => {
    callback(null, buf);
  });
}

crypto_exports.randomBytes = randomBytes;

for (const rng of ["pseudoRandomBytes", "prng", "rng"]) {
  Object.defineProperty(crypto_exports, rng, {
    value: randomBytes,
    enumerable: false,
    configurable: true,
  });
}

crypto_exports.randomInt = randomInt;

function randomFill(buf, offset, size, callback) {
  if (!isAnyArrayBuffer(buf) && !isArrayBufferView(buf)) {
    throw $ERR_INVALID_ARG_TYPE("buf", ["ArrayBuffer", "ArrayBufferView"], buf);
  }

  if (typeof offset === "function") {
    callback = offset;
    offset = 0;
    size = buf.length;
  } else if (typeof size === "function") {
    callback = size;
    size = buf.length - offset;
  }

  // Crypto random promise job is guaranteed to resolve.
  _randomFill(buf, offset, size, callback).then(() => {
    callback(null, buf);
  });
}

crypto_exports.randomFill = randomFill;
crypto_exports.randomFillSync = randomFillSync;

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
