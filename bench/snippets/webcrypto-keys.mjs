import { bench, group, run } from "../runner.mjs";

const { subtle } = crypto;

const raw = new Uint8Array(32).fill(1);
const k = Buffer.from(raw).toString("base64url");
const usages = ["encrypt", "decrypt"];
const everyUsage = [
  ...usages,
  "sign",
  "verify",
  "deriveKey",
  "deriveBits",
  "wrapKey",
  "unwrapKey",
  "encapsulateKey",
  "encapsulateBits",
  "decapsulateKey",
  "decapsulateBits",
];
const aesJwk = key_ops => ({ kty: "oct", k, key_ops });
const aesJwks = [
  ["no key_ops", aesJwk(undefined)],
  ["1 key_ops", aesJwk(["encrypt"])],
  ["2 key_ops", aesJwk(usages)],
  ["12 key_ops", aesJwk(everyUsage)],
  ["2 key_ops and one that is not a KeyUsage", aesJwk([...usages, "urn:example:op"])],
];
const hmac = { name: "HMAC", hash: "SHA-256" };
const hmacJwk = { kty: "oct", k, key_ops: ["sign", "verify"] };
const ecdsa = { name: "ECDSA", namedCurve: "P-256" };
const ecdsaJwk = {
  kty: "EC",
  crv: "P-256",
  x: "3DyR3pdz7BDZtoAVvm4Mn55Ashdl84LCJB9kcUI3IrQ",
  y: "r6xDaTpWl7d958Y4HMq6OR4F8PLe1wl7m41I2ZX1yoU",
  key_ops: ["verify"],
};

const aesKey = await subtle.importKey("raw", raw, "AES-GCM", true, usages);
const ecdsaKey = await subtle.importKey("jwk", ecdsaJwk, ecdsa, true, ["verify"]);
const wrapAlgorithm = { name: "AES-GCM", iv: new Uint8Array(12).fill(2) };
const wrappingKey = await subtle.importKey("raw", raw, "AES-GCM", false, ["wrapKey", "unwrapKey"]);
const wrapped = await subtle.wrapKey("jwk", aesKey, wrappingKey, wrapAlgorithm);

group("importKey", () => {
  bench("importKey raw AES-GCM", async () => {
    await subtle.importKey("raw", raw, "AES-GCM", true, usages);
  });
  for (const [name, jwk] of aesJwks) {
    bench(`importKey jwk AES-GCM, ${name}`, async () => {
      await subtle.importKey("jwk", jwk, "AES-GCM", true, ["encrypt"]);
    });
  }
  bench("importKey jwk HMAC, 2 key_ops", async () => {
    await subtle.importKey("jwk", hmacJwk, hmac, true, ["sign"]);
  });
  bench("importKey jwk ECDSA public, 1 key_ops", async () => {
    await subtle.importKey("jwk", ecdsaJwk, ecdsa, true, ["verify"]);
  });
});

group("unwrapKey", () => {
  bench("unwrapKey jwk AES-GCM, 2 key_ops", async () => {
    await subtle.unwrapKey("jwk", wrapped, wrappingKey, wrapAlgorithm, "AES-GCM", true, usages);
  });
});

group("exportKey", () => {
  bench("exportKey jwk AES-GCM", async () => {
    await subtle.exportKey("jwk", aesKey);
  });
  bench("exportKey jwk ECDSA public", async () => {
    await subtle.exportKey("jwk", ecdsaKey);
  });
});

group("generateKey", () => {
  bench("generateKey AES-GCM 256", async () => {
    await subtle.generateKey({ name: "AES-GCM", length: 256 }, true, usages);
  });
});

await run();
