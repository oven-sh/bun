import crypto from "node:crypto";
import { bench, run } from "../runner.mjs";

function generateTestKeyPairs() {
  const curves = crypto.getCurves();
  const keys = {};

  for (const curve of curves) {
    const ecdh = crypto.createECDH(curve);
    ecdh.generateKeys();

    keys[curve] = {
      compressed: ecdh.getPublicKey("hex", "compressed"),
      uncompressed: ecdh.getPublicKey("hex", "uncompressed"),
      instance: ecdh,
    };
  }

  return keys;
}

const testKeys = generateTestKeyPairs();

bench("ECDH key format - P256 compressed to uncompressed", () => {
  const publicKey = testKeys["prime256v1"].compressed;
  return crypto.ECDH.convertKey(publicKey, "prime256v1", "hex", "hex", "uncompressed");
});

bench("ECDH key format - P256 uncompressed to compressed", () => {
  const publicKey = testKeys["prime256v1"].uncompressed;
  return crypto.ECDH.convertKey(publicKey, "prime256v1", "hex", "hex", "compressed");
});

bench("ECDH key format - P384 compressed to uncompressed", () => {
  const publicKey = testKeys["secp384r1"].compressed;
  return crypto.ECDH.convertKey(publicKey, "secp384r1", "hex", "hex", "uncompressed");
});

bench("ECDH key format - P384 uncompressed to compressed", () => {
  const publicKey = testKeys["secp384r1"].uncompressed;
  return crypto.ECDH.convertKey(publicKey, "secp384r1", "hex", "hex", "compressed");
});

await run();
