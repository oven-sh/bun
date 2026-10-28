// The rest of node:crypto that programs lean on: a hash as a stream, copy, RSA signatures and encryption, elliptic curves, Diffie-Hellman, key objects in PEM, DER and JWK, hkdf, secret keys, random fill, and sign, verify, encrypt and derive through the web's interface.
import crypto from "node:crypto";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";

const hashing = crypto.createHash("sha256");
await pipeline(Readable.from(["a", "b", "c"]), hashing);
console.log(hashing.read().toString("hex").slice(0, 16));
const shared = crypto.createHash("sha1").update("common ");
console.log(shared.copy().update("one").digest("hex").slice(0, 8), shared.copy().update("two").digest("hex").slice(0, 8));
try {
  const used = crypto.createHash("md5");
  used.digest();
  used.update("late");
} catch (error) {
  console.log(error.code);
}

const rsa = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 });
const signature = crypto.createSign("sha256").update("message").sign(rsa.privateKey);
console.log(signature.length, crypto.createVerify("sha256").update("message").verify(rsa.publicKey, signature), crypto.createVerify("sha256").update("other").verify(rsa.publicKey, signature));
console.log(crypto.privateDecrypt(rsa.privateKey, crypto.publicEncrypt(rsa.publicKey, Buffer.from("to the owner of the key"))).toString());
const pem = rsa.publicKey.export({ type: "spki", format: "pem" });
const jwk = rsa.publicKey.export({ format: "jwk" });
console.log(pem.split("\n")[0], jwk.kty, jwk.e, crypto.createPublicKey(pem).equals(rsa.publicKey), crypto.createPublicKey({ key: jwk, format: "jwk" }).equals(rsa.publicKey), crypto.createPublicKey(rsa.privateKey).equals(rsa.publicKey), rsa.privateKey.export({ type: "pkcs8", format: "der" }).length > 1000, rsa.publicKey.asymmetricKeyDetails.modulusLength);

const alice = crypto.createECDH("prime256v1"), bob = crypto.createECDH("prime256v1");
alice.generateKeys();
bob.generateKeys();
console.log(alice.computeSecret(bob.getPublicKey()).equals(bob.computeSecret(alice.getPublicKey())), alice.getPublicKey().length, crypto.getCurves().includes("secp256k1"));
const left = crypto.generateKeyPairSync("x25519"), right = crypto.generateKeyPairSync("x25519");
console.log(crypto.diffieHellman({ privateKey: left.privateKey, publicKey: right.publicKey }).equals(crypto.diffieHellman({ privateKey: right.privateKey, publicKey: left.publicKey })));
const curve = crypto.generateKeyPairSync("ec", { namedCurve: "P-256" });
console.log(crypto.verify("sha256", Buffer.from("ec"), curve.publicKey, crypto.sign("sha256", Buffer.from("ec"), curve.privateKey)), curve.publicKey.asymmetricKeyDetails.namedCurve);

console.log(Buffer.from(crypto.hkdfSync("sha256", "key", "salt", "info", 16)).toString("hex"), crypto.createSecretKey(Buffer.from("secret")).symmetricKeySize, crypto.createSecretKey("secret", "utf8").export().toString(), crypto.generateKeySync("aes", { length: 128 }).type, crypto.generateKeySync("hmac", { length: 64 }).symmetricKeySize);
console.log(crypto.randomFillSync(Buffer.alloc(4)).length, (await new Promise(resolve => crypto.randomFill(new Uint8Array(3), (error, filled) => resolve(filled)))).length, (await new Promise(resolve => crypto.randomBytes(5, (error, bytes) => resolve(bytes)))).length, typeof crypto.constants.RSA_PKCS1_PADDING, crypto.getCipherInfo("aes-128-cbc").keyLength);

const { subtle } = crypto;
const hmacKey = await subtle.importKey("raw", new TextEncoder().encode("key"), { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
const mac = await subtle.sign("HMAC", hmacKey, new TextEncoder().encode("message"));
console.log(Buffer.from(mac).toString("hex").slice(0, 16), await subtle.verify("HMAC", hmacKey, mac, new TextEncoder().encode("message")));
const aes = await subtle.generateKey({ name: "AES-GCM", length: 256 }, true, ["encrypt", "decrypt"]);
const iv = new Uint8Array(12);
console.log(new TextDecoder().decode(await subtle.decrypt({ name: "AES-GCM", iv }, aes, await subtle.encrypt({ name: "AES-GCM", iv }, aes, new TextEncoder().encode("sealed by subtle")))), (await subtle.exportKey("raw", aes)).byteLength, aes.type, aes.extractable, aes.algorithm.name);
const password = await subtle.importKey("raw", new TextEncoder().encode("password"), "PBKDF2", false, ["deriveBits"]);
console.log(Buffer.from(await subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt: new TextEncoder().encode("salt"), iterations: 1000 }, password, 128)).toString("hex"));
const signing = await subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, false, ["sign", "verify"]);
console.log(await subtle.verify({ name: "ECDSA", hash: "SHA-256" }, signing.publicKey, await subtle.sign({ name: "ECDSA", hash: "SHA-256" }, signing.privateKey, iv), iv), await subtle.digest("SHA-999", iv).catch(error => error.name));
