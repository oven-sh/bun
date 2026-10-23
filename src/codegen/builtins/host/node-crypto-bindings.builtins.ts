// The object that node:crypto takes from src/jsc/bindings/node/crypto/node_crypto_binding.cpp when it is evaluated. src/runtime/node/node_crypto_binding.bind.ts describes the other.
import * as b from "bun-builtins-table";
import { answers, bagOfFunctions, undeclaredClasses, undeclaredFunctions } from "./native-bags.ts";

const cppBinding = "%NodeCryptoBinding%";

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

  // They compute over bytes and keys, and call the callbacks that they are handed. None evaluates a text or loads a module.
  b.seenCodeOnly({ holders: [cppBinding] }),
);
