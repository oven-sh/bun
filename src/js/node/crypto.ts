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
}: Record<string, any> & {
  certVerifySpkac(spkac: BufferSource): boolean;
  certExportPublicKey(spkac: BufferSource): Buffer | string;
  certExportChallenge(spkac: BufferSource): Buffer | string;
  Sign: new () => $Node.NativeSign;
  Verify: new () => $Node.NativeVerify;
  Hash: new (algorithm: string | $Node.NativeHash, options?: object) => $Node.NativeHash;
  Hmac: new (algorithm: string, key: unknown, options?: object) => $Node.NativeHmac;
  Cipher: new (isDecipher: boolean, cipher: string, key: unknown, iv: unknown, options?: object) => $Node.NativeCipher;
  DiffieHellman: new (sizeOrKey: unknown, keyEncoding?: unknown, generator?: unknown, genEncoding?: unknown) => object;
  ECDH: {
    new (curve: string): object;
    prototype: { setPublicKey(key: CryptoData, encoding?: string): void };
  };
} = $cpp("node_crypto_binding.cpp", "createNodeCryptoBinding");

const {
  pbkdf2,
  pbkdf2Sync,
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
}: Record<string, any> & {
  argon2(
    message: BufferSource,
    nonce: BufferSource,
    parallelism: number,
    tagLength: number,
    memory: number,
    passes: number,
    secret: BufferSource,
    associatedData: BufferSource,
    type: number,
    callback: (error: Error | undefined, result: Buffer) => void,
  ): void;
  argon2Sync(
    message: BufferSource,
    nonce: BufferSource,
    parallelism: number,
    tagLength: number,
    memory: number,
    passes: number,
    secret: BufferSource,
    associatedData: BufferSource,
    type: number,
  ): Buffer;
} = $bindgen("node_crypto_binding.bind.ts", "crypto") as any;

const normalizeEncoding: (encoding: string) => string | undefined = $bindgen(
  "node_util_binding.bind.ts",
  "normalizeEncoding",
);
const timingSafeEqual = $bindgen("Crypto.bind.ts", "timingSafeEqual");

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

type CryptoData = $Node.CryptoData;
type DoneCallback = (error?: Error | null) => void;
type Decoder = InstanceType<typeof StringDecoder>;
type BufferSource = Buffer | ArrayBufferView | ArrayBufferLike;

declare global {
  namespace $Node {
    interface Sign extends Writable {
      [kHandle]: NativeSign;
      update(data: CryptoData, encoding?: string): this;
      sign(options: unknown, encoding?: string): Buffer | string;
    }
    interface Verify extends Writable {
      [kHandle]: NativeVerify;
      update(data: CryptoData, encoding?: string): this;
      verify(options: unknown, signature: CryptoData, signatureEncoding?: string): boolean;
    }
    interface Hash extends Transform {
      [kHandle]: NativeHash;
      copy(options?: TransformOptions): Hash;
      update(data: CryptoData, encoding?: string): this;
      digest(outputEncoding?: string): Buffer | string;
    }
    interface Hmac extends Transform {
      [kHandle]: NativeHmac;
      update(data: CryptoData, encoding?: string): this;
      digest(outputEncoding?: string): Buffer | string;
    }
    /** `Cipheriv` and `Decipheriv`. */
    interface Cipher extends Transform {
      [kHandle]: NativeCipher;
      _decoder: Decoder | null;
      setAutoPadding(autoPadding?: boolean): this;
      getAuthTag(): Buffer;
      setAuthTag(tag: CryptoData, encoding?: string): this;
      setAAD(data: CryptoData, options?: { plaintextLength?: number; encoding?: string }): this;
      update(data: CryptoData, inputEncoding?: string, outputEncoding?: string): Buffer | string;
      final(outputEncoding?: string): Buffer | string;
    }
  }
}

function verifySpkac(spkac: string | BufferSource, encoding?: string) {
  return certVerifySpkac(getArrayBufferOrView(spkac, "spkac", encoding));
}
function exportPublicKey(spkac: string | BufferSource, encoding?: string) {
  return certExportPublicKey(getArrayBufferOrView(spkac, "spkac", encoding));
}
function exportChallenge(spkac: string | BufferSource, encoding?: string) {
  return certExportChallenge(getArrayBufferOrView(spkac, "spkac", encoding));
}

function Certificate(): void {
  if (!new.target) {
    return new Certificate() as any;
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

function getArrayBufferOrView(buffer: string | BufferSource, name: string, encoding?: string): BufferSource {
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

crypto_exports.hash = function hash(algorithm, input, outputEncoding: import("bun").DigestEncoding = "hex") {
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

function Sign(this: $Node.Sign, algorithm: string, options?: $Node.WritableOptions): void {
  if (!(this instanceof Sign)) {
    return new Sign(algorithm, options) as any;
  }

  validateString(algorithm, "algorithm");
  this[kHandle] = new _Sign();
  this[kHandle].init(algorithm);

  Writable.$apply(this, [options]);
}
$toClass(Sign, "Sign", Writable);

Object.assign(Sign.prototype, {
  _write: function (this: $Node.Sign | $Node.Verify, chunk: CryptoData, encoding: string, callback: DoneCallback) {
    this.update(chunk, encoding);
    callback();
  },
  update: function (this: $Node.Sign | $Node.Verify, data: CryptoData, encoding?: string) {
    return this[kHandle].update(this, data, encoding);
  },
  sign: function (this: $Node.Sign, options: unknown, encoding?: string) {
    return this[kHandle].sign(options, encoding);
  },
});

crypto_exports.Sign = Sign;
crypto_exports.sign = sign;

function createSign(algorithm: string, options?: $Node.WritableOptions): $Node.Sign {
  return new Sign(algorithm, options);
}

crypto_exports.createSign = createSign;

function Verify(this: $Node.Verify, algorithm: string, options?: $Node.WritableOptions): void {
  if (!(this instanceof Verify)) {
    return new Verify(algorithm, options) as any;
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
  verify: function (this: $Node.Verify, options: unknown, signature: CryptoData, sigEncoding?: string) {
    return this[kHandle].verify(options, signature, sigEncoding);
  },
});

crypto_exports.Verify = Verify;
crypto_exports.verify = verify;

function createVerify(algorithm: string, options?: $Node.WritableOptions): $Node.Verify {
  return new Verify(algorithm, options);
}

crypto_exports.createVerify = createVerify;

function Hash(this: $Node.Hash, algorithm: string | $Node.NativeHash, options?: $Node.TransformOptions): void {
  if (!new.target) {
    return new Hash(algorithm, options) as any;
  }

  const handle = new _Hash(algorithm, options);
  this[kHandle] = handle;

  LazyTransform.$apply(this, [options]);
}
$toClass(Hash, "Hash", LazyTransform);

Object.assign(Hash.prototype, {
  copy: function (this: $Node.Hash, options?: $Node.TransformOptions): $Node.Hash {
    return new Hash(this[kHandle], options);
  },
  _transform: function (this: $Node.Hash, chunk: CryptoData, encoding: string, callback: DoneCallback) {
    this[kHandle].update(this, chunk, encoding, false);
    callback();
  },
  _flush: function (this: $Node.Hash, callback: DoneCallback) {
    this.push(this[kHandle].digest(null, false));
    callback();
  },
  update: function (this: $Node.Hash, data: CryptoData, encoding?: string) {
    return this[kHandle].update(this, data, encoding);
  },
  digest: function (this: $Node.Hash, outputEncoding?: string) {
    return this[kHandle].digest(outputEncoding);
  },
});

crypto_exports.Hash = deprecate(Hash, "crypto.Hash constructor is deprecated.", "DEP0179");
crypto_exports.createHash = function createHash(algorithm: string, options?: $Node.TransformOptions): $Node.Hash {
  return new Hash(algorithm, options);
};

function Hmac(this: $Node.Hmac, hmac: string, key: unknown, options?: $Node.TransformOptions): void {
  if (!new.target) {
    return new Hmac(hmac, key, options) as any;
  }

  const handle = new _Hmac(hmac, key, options);
  this[kHandle] = handle;

  LazyTransform.$apply(this, [options]);
}
$toClass(Hmac, "Hmac", LazyTransform);

Object.assign(Hmac.prototype, {
  update: function (this: $Node.Hmac, data: CryptoData, encoding?: string) {
    return this[kHandle].update(this, data, encoding);
  },
  digest: function (this: $Node.Hmac, outputEncoding?: string) {
    return this[kHandle].digest(outputEncoding);
  },
  _transform: function (this: $Node.Hmac, chunk: CryptoData, encoding: string, callback: DoneCallback) {
    this[kHandle].update(this, chunk, encoding, false);
    callback();
  },
  _flush: function (this: $Node.Hmac, callback: DoneCallback) {
    this.push(this[kHandle].digest());
    callback();
  },
});

crypto_exports.Hmac = deprecate(Hmac, "crypto.Hmac constructor is deprecated.", "DEP0181");
crypto_exports.createHmac = function createHmac(
  hmac: string,
  key: unknown,
  options?: $Node.TransformOptions,
): $Node.Hmac {
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
function getArgon2BufferSource(buffer: string | BufferSource, name: string): BufferSource {
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
interface Argon2Parameters {
  message: string | BufferSource;
  nonce: string | BufferSource;
  parallelism: number;
  tagLength: number;
  memory: number;
  passes: number;
  secret?: string | BufferSource;
  associatedData?: string | BufferSource;
  type?: undefined;
}

interface CheckedArgon2Parameters {
  message: BufferSource;
  nonce: BufferSource;
  parallelism: number;
  tagLength: number;
  memory: number;
  passes: number;
  secret: BufferSource;
  associatedData: BufferSource;
  type: number;
}

function checkArgon2(
  algorithm: "argon2d" | "argon2i" | "argon2id",
  parameters: Argon2Parameters | CheckedArgon2Parameters,
): CheckedArgon2Parameters {
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

crypto_exports.argon2 = function argon2(
  algorithm: "argon2d" | "argon2i" | "argon2id",
  parameters: Argon2Parameters | CheckedArgon2Parameters,
  callback: (error: Error | null, result?: Buffer) => void,
) {
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
crypto_exports.argon2Sync = function argon2Sync(
  algorithm: "argon2d" | "argon2i" | "argon2id",
  parameters: Argon2Parameters | CheckedArgon2Parameters,
) {
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

function createDiffieHellman(sizeOrKey: unknown, keyEncoding?: unknown, generator?: unknown, genEncoding?: unknown) {
  return new DiffieHellman(sizeOrKey, keyEncoding, generator, genEncoding);
}
crypto_exports.DiffieHellmanGroup = DiffieHellmanGroup;
crypto_exports.getDiffieHellman = crypto_exports.createDiffieHellmanGroup = DiffieHellmanGroup;
crypto_exports.createDiffieHellman = createDiffieHellman;
crypto_exports.DiffieHellman = DiffieHellman;

crypto_exports.diffieHellman = diffieHellman;

ECDH.prototype.setPublicKey = deprecate(ECDH.prototype.setPublicKey, "ecdh.setPublicKey() is deprecated.", "DEP0031");
crypto_exports.ECDH = ECDH;
crypto_exports.createECDH = function createECDH(curve: string) {
  return new ECDH(curve);
};

{
  function getDecoder(decoder: Decoder | null, encoding: string) {
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

  function Cipheriv(
    this: $Node.Cipher,
    cipher: string,
    key: unknown,
    iv: unknown,
    options?: $Node.TransformOptions,
  ): void {
    if (!new.target) {
      return new Cipheriv(cipher, key, iv, options) as any;
    }

    this[kHandle] = new Cipher(false, cipher, key, iv, options);
    LazyTransform.$apply(this, [options]);
    this._decoder = null;
  }
  $toClass(Cipheriv, "Cipheriv", LazyTransform);

  Object.assign(Cipheriv.prototype, {
    setAutoPadding: function (this: $Node.Cipher, ap?: boolean) {
      this[kHandle].setAutoPadding(ap);
      return this;
    },
    getAuthTag: function (this: $Node.Cipher) {
      return this[kHandle].getAuthTag();
    },
    setAAD: function (
      this: $Node.Cipher,
      aadbuf: CryptoData,
      options?: { plaintextLength?: number; encoding?: string },
    ) {
      this[kHandle].setAAD(aadbuf, options);
      return this;
    },
    _transform: function (this: $Node.Cipher, chunk: CryptoData, encoding: string, callback: DoneCallback) {
      this.push(this[kHandle].update(chunk, encoding));
      callback();
    },
    _flush: function (this: $Node.Cipher, callback: DoneCallback) {
      try {
        this.push(this[kHandle].final());
      } catch (e) {
        callback(e as Error);
        return;
      }
      callback();
    },
    update: function (this: $Node.Cipher, data: CryptoData, inputEncoding?: string, outputEncoding?: string) {
      const res = this[kHandle].update(data, inputEncoding);

      if (outputEncoding && outputEncoding !== "buffer") {
        this._decoder = getDecoder(this._decoder, outputEncoding);
        return this._decoder.write(res);
      }

      return res;
    },
    final: function (this: $Node.Cipher, outputEncoding?: string) {
      const res = this[kHandle].final();

      if (outputEncoding && outputEncoding !== "buffer") {
        this._decoder = getDecoder(this._decoder, outputEncoding);
        return this._decoder.end(res);
      }

      return res;
    },
  });

  function Decipheriv(
    this: $Node.Cipher,
    cipher: string,
    key: unknown,
    iv: unknown,
    options?: $Node.TransformOptions,
  ): void {
    if (!new.target) {
      return new Decipheriv(cipher, key, iv, options) as any;
    }

    this[kHandle] = new Cipher(true, cipher, key, iv, options);
    LazyTransform.$apply(this, [options]);
    this._decoder = null;
  }
  $toClass(Decipheriv, "Decipheriv", LazyTransform);

  Object.assign(Decipheriv.prototype, {
    setAutoPadding: Cipheriv.prototype.setAutoPadding,
    setAuthTag: function (this: $Node.Cipher, tagbuf: CryptoData, encoding?: string) {
      this[kHandle].setAuthTag(tagbuf, encoding);
      return this;
    },
    setAAD: Cipheriv.prototype.setAAD,
    _transform: Cipheriv.prototype._transform,
    _flush: Cipheriv.prototype._flush,
    update: Cipheriv.prototype.update,
    final: Cipheriv.prototype.final,
  });

  crypto_exports.Cipheriv = Cipheriv;
  crypto_exports.Decipheriv = Decipheriv;
  crypto_exports.createCipheriv = function createCipheriv(
    cipher: string,
    key: unknown,
    iv: unknown,
    options?: $Node.TransformOptions,
  ): $Node.Cipher {
    return new Cipheriv(cipher, key, iv, options);
  };
  crypto_exports.createDecipheriv = function createDecipheriv(
    cipher: string,
    key: unknown,
    iv: unknown,
    options?: $Node.TransformOptions,
  ): $Node.Cipher {
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
