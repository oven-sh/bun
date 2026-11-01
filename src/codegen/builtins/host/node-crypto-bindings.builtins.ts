// The object that node:crypto takes from src/jsc/bindings/node/crypto/node_crypto_binding.cpp when it is evaluated. src/runtime/node/node_crypto_binding.bind.ts describes the other.
import * as b from "bun-builtins-table";
import { answers, bagOfFunctions, undeclaredClasses, undeclaredFunction, undeclaredFunctions } from "./native-bags.ts";
import { answering, constructing } from "./native-code.ts";

const cppBinding = "%NodeCryptoBinding%";
const bytesOfKey = b.union(b.instance("Buffer"), b.string, b.undefined);

export default b.declarations(
  bagOfFunctions(cppBinding, {
    certVerifySpkac: answering(b.union(b.bool, b.string, b.undefined)),
    certExportPublicKey: answering(bytesOfKey),
    certExportChallenge: answering(bytesOfKey),
    ...undeclaredFunctions(
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
  }),
  undeclaredClasses(
    cppBinding,
    "Sign",
    "Verify",
    "Hmac",
    "Hash",
    "DiffieHellman",
    "DiffieHellmanGroup",
    "Cipher",
    "KeyObject",
    "X509Certificate",
  ),
  // node:crypto wraps this method on the prototype, and native code calls no method of it.
  b.class(`${cppBinding}.ECDH`, { namesReadByNativeCodeOnPrototype: [], proto: { setPublicKey: undeclaredFunction } }),
  ["Sign", "Verify", "Hmac", "Hash", "DiffieHellman", "Cipher", "ECDH"].flatMap(name => [
    ...b.construction(`${cppBinding}.${name}`, constructing(b.instance(`NodeCryptoBinding.${name}`), b.hostCall)),
    ...b.callOfConstructor(`${cppBinding}.${name}`, answering(b.instance(`NodeCryptoBinding.${name}`), b.hostCall)),
  ]),
  answers("native:Cpp:node_crypto_binding.cpp:createNodeCryptoBinding", b.builtin(cppBinding)),

  // They compute over bytes and keys, and call the callbacks that they are handed. None evaluates a text or loads a module.
  b.seenCodeOnly({ holders: [cppBinding] }),
);
