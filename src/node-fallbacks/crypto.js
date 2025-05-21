import cryptoBrowserify from "crypto-browserify";

export const prng = cryptoBrowserify.prng;
export const pseudoRandomBytes = cryptoBrowserify.pseudoRandomBytes;
export const rng = cryptoBrowserify.rng;
export const randomBytes = cryptoBrowserify.randomBytes;
export const Hash = cryptoBrowserify.Hash;
export const createHash = cryptoBrowserify.createHash;
export const Hmac = cryptoBrowserify.Hmac;
export const createHmac = cryptoBrowserify.createHmac;
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
export const randomFill = cryptoBrowserify.randomFill;
export const randomFillSync = cryptoBrowserify.randomFillSync;
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
