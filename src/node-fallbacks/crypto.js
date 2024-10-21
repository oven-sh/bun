/**
 * Browser polyfill for the `"crypto"` module.
 *
 * Imported on usage in `bun build --target=browser`
 */

export * from "crypto-browserify";
import * as cryptoBrowserify from "crypto-browserify";

export var DEFAULT_ENCODING = "buffer";

// we deliberately reference crypto. directly here because we want to preserve the This binding
export const getRandomValues = array => {
  return crypto.getRandomValues(array);
};

export const randomUUID = () => {
  return crypto.randomUUID();
};

const harcoded_curves = [
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
  return harcoded_curves;
}

export const timingSafeEqual =
  "timingSafeEqual" in crypto
    ? (a, b) => {
        const { byteLength: byteLengthA } = a;
        const { byteLength: byteLengthB } = b;
        if (typeof byteLengthA !== "number" || typeof byteLengthB !== "number") {
          throw new TypeError("Input must be an array buffer view");
        }

        if (byteLengthA !== byteLengthB) {
          throw new RangeError("Input buffers must have the same length");
        }

        // these error checks are also performed in the function
        // however there is a bug where exceptions return no value
        return crypto.timingSafeEqual(a, b);
      }
    : undefined;

export const scryptSync =
  "scryptSync" in crypto
    ? (password, salt, keylen, options) => {
        const res = crypto.scryptSync(password, salt, keylen, options);
        return DEFAULT_ENCODING !== "buffer" ? new Buffer(res).toString(DEFAULT_ENCODING) : new Buffer(res);
      }
    : undefined;

export const scrypt =
  "scryptSync" in crypto
    ? function (password, salt, keylen, options, callback) {
        if (typeof options === "function") {
          callback = options;
          options = undefined;
        }

        if (typeof callback !== "function") {
          var err = new TypeError("callback must be a function");
          err.code = "ERR_INVALID_CALLBACK";
          throw err;
        }

        try {
          const result = crypto.scryptSync(password, salt, keylen, options);
          process.nextTick(
            callback,
            null,
            DEFAULT_ENCODING !== "buffer" ? new Buffer(result).toString(DEFAULT_ENCODING) : new Buffer(result),
          );
        } catch (err) {
          throw err;
        }
      }
    : undefined;

if (timingSafeEqual) {
  // hide it from stack trace
  Object.defineProperty(timingSafeEqual, "name", {
    value: "::bunternal::",
  });
  Object.defineProperty(scrypt, "name", {
    value: "::bunternal::",
  });
  Object.defineProperty(scryptSync, "name", {
    value: "::bunternal::",
  });
}

export const webcrypto = crypto;

export default {
  ...cryptoBrowserify,
  getRandomValues,
  randomUUID,
  timingSafeEqual,
  scryptSync,
  scrypt,
  webcrypto,
  getCurves,
};
