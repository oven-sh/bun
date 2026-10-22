const encode = text => new TextEncoder().encode(text);
const hex = buffer => Buffer.from(buffer).toString("hex");

const hmacKey = await crypto.subtle.importKey("raw", encode("a shared secret"), { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
const signature = await crypto.subtle.sign("HMAC", hmacKey, encode("message"));
console.log(hex(signature), await crypto.subtle.verify("HMAC", hmacKey, signature, encode("message")), await crypto.subtle.verify("HMAC", hmacKey, signature, encode("other")), hmacKey.type, hmacKey.extractable, hmacKey.algorithm.name, hmacKey.usages);
console.log(await crypto.subtle.exportKey("raw", hmacKey).catch(error => error.name));

const aesKey = await crypto.subtle.importKey("raw", new Uint8Array(32).fill(3), "AES-GCM", true, ["encrypt", "decrypt"]);
const iv = new Uint8Array(12).fill(1);
const sealed = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, aesKey, encode("private words"));
console.log(hex(sealed), new TextDecoder().decode(await crypto.subtle.decrypt({ name: "AES-GCM", iv }, aesKey, sealed)), (await crypto.subtle.exportKey("jwk", aesKey)).alg);
const damaged = new Uint8Array(sealed);
damaged[0] ^= 1;
console.log(await crypto.subtle.decrypt({ name: "AES-GCM", iv }, aesKey, damaged).catch(error => error.name));

const pair = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
const signed = await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, pair.privateKey, encode("document"));
console.log(signed.byteLength, await crypto.subtle.verify({ name: "ECDSA", hash: "SHA-256" }, pair.publicKey, signed, encode("document")), pair.publicKey.type, (await crypto.subtle.exportKey("jwk", pair.publicKey)).crv, (await crypto.subtle.exportKey("spki", pair.publicKey)).byteLength);

const base = await crypto.subtle.importKey("raw", encode("password"), "PBKDF2", false, ["deriveBits", "deriveKey"]);
console.log(hex(await crypto.subtle.deriveBits({ name: "PBKDF2", salt: encode("salt"), iterations: 1000, hash: "SHA-256" }, base, 128)));
const derived = await crypto.subtle.deriveKey({ name: "PBKDF2", salt: encode("salt"), iterations: 10, hash: "SHA-1" }, base, { name: "AES-CBC", length: 128 }, true, ["encrypt"]);
console.log(hex(await crypto.subtle.exportKey("raw", derived)), derived.algorithm.length);
for (const name of ["SHA-1", "SHA-256", "SHA-384", "SHA-512"]) console.log(name, hex(await crypto.subtle.digest(name, encode("abc"))).slice(0, 16));
console.log(await crypto.subtle.digest("MD5", encode("x")).catch(error => error.name), crypto.getRandomValues(new Uint32Array(3)).length, typeof crypto.randomUUID(), crypto.subtle instanceof SubtleCrypto, hmacKey instanceof CryptoKey);
try {
  crypto.getRandomValues(new Float64Array(1));
} catch (error) {
  console.log(error.name);
}
try {
  crypto.getRandomValues(new Uint8Array(65537));
} catch (error) {
  console.log(error.name);
}
