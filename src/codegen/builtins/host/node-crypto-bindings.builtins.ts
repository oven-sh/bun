// The two objects that node:crypto takes from native code when it is evaluated: src/jsc/bindings/node/crypto/node_crypto_binding.cpp and src/runtime/node/node_crypto_binding.rs.
import * as b from "bun-builtins-table";
import { answers, bagOfFunctions, undeclaredClasses, undeclaredFunctions } from "./native-bags.ts";
import { handedOver } from "./native-code.ts";

const cppBinding = "%NodeCryptoBinding%";
const rustBinding = "%NodeCryptoRustBinding%";

// The bytes of the view that it is handed, before the call returns or once the operation has ended. node:crypto exports the two as they are.
const fillsView = {
  args: { operands: b.any.rest },
  returns: b.any,
  capability: "js",
  throws: true,
  uses: { operands: [...handedOver, b.writesContents()] },
  implementation: b.generic,
} satisfies b.FunctionField;

export default b.declarations(
  bagOfFunctions(
    cppBinding,
    undeclaredFunctions(
      "certVerifySpkac",
      "certExportPublicKey",
      "certExportChallenge",
      "getCurves",
      "getCiphers",
      "getCipherInfo",
      "sign",
      "verify",
      "diffieHellman",
      "generatePrime",
      "generatePrimeSync",
      "checkPrime",
      "checkPrimeSync",
      "hkdf",
      "hkdfSync",
      "publicEncrypt",
      "publicDecrypt",
      "privateEncrypt",
      "privateDecrypt",
      "createSecretKey",
      "createPublicKey",
      "createPrivateKey",
      "generateKey",
      "generateKeySync",
      "generateKeyPair",
      "generateKeyPairSync",
    ),
  ),
  undeclaredClasses(
    cppBinding,
    "Sign",
    "Verify",
    "Hmac",
    "Hash",
    "ECDH",
    "DiffieHellman",
    "DiffieHellmanGroup",
    "Cipher",
    "KeyObject",
    "X509Certificate",
  ),
  answers("native:Cpp:node_crypto_binding.cpp:createNodeCryptoBinding", b.builtin(cppBinding)),

  bagOfFunctions(rustBinding, {
    randomFill: fillsView,
    randomFillSync: fillsView,
    ...undeclaredFunctions(
      "pbkdf2",
      "pbkdf2Sync",
      "randomInt",
      "randomUUID",
      "randomUUIDv7",
      "randomBytes",
      "timingSafeEqual",
      "secureHeapUsed",
      "getFips",
      "setFips",
      "setEngine",
      "getHashes",
      "scrypt",
      "scryptSync",
      "argon2",
      "argon2Sync",
    ),
  }),
  answers("native:Rust:node_crypto_binding.rs:createNodeCryptoBindingZig", b.builtin(rustBinding)),
  // They compute over bytes and keys, and call the callbacks that they are handed. None evaluates a text or loads a module.
  b.seenCodeOnly({ holders: [cppBinding, rustBinding] }),
);
