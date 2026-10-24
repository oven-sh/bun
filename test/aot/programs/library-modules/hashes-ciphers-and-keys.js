// node:crypto: hashes and HMACs in several encodings, updates in pieces, key derivation, ciphers with and without authentication, signatures, random values, comparison in constant time, and the web's subtle interface.
import crypto from "node:crypto";

for (const name of ["md5", "sha1", "sha256", "sha512"]) console.log(name, crypto.createHash(name).update("abc").digest("hex").slice(0, 16));
console.log(crypto.createHash("sha256").update("a").update(Buffer.from("b")).update(new Uint8Array([99])).digest("base64"));
console.log(crypto.createHmac("sha256", "key").update("message").digest("hex").slice(0, 16), crypto.hash?.("sha1", "abc").slice(0, 8));
console.log(crypto.pbkdf2Sync("password", "salt", 1000, 16, "sha256").toString("hex"), crypto.scryptSync("password", "salt", 16, { N: 16 }).toString("hex"));
console.log((await new Promise(resolve => crypto.pbkdf2("password", "salt", 10, 8, "sha1", (error, key) => resolve(key)))).toString("hex"));

const key = Buffer.alloc(32, 1), iv = Buffer.alloc(16, 2);
const cipher = crypto.createCipheriv("aes-256-cbc", key, iv);
const secret = Buffer.concat([cipher.update("attack at dawn"), cipher.final()]);
const decipher = crypto.createDecipheriv("aes-256-cbc", key, iv);
console.log(secret.toString("hex"), Buffer.concat([decipher.update(secret), decipher.final()]).toString());

const sealed = crypto.createCipheriv("aes-256-gcm", key, iv.subarray(0, 12));
sealed.setAAD(Buffer.from("header"));
const box = Buffer.concat([sealed.update("sealed"), sealed.final()]), tag = sealed.getAuthTag();
const opened = crypto.createDecipheriv("aes-256-gcm", key, iv.subarray(0, 12)).setAAD(Buffer.from("header")).setAuthTag(tag);
console.log(box.toString("hex"), tag.length, Buffer.concat([opened.update(box), opened.final()]).toString());
const forged = crypto.createDecipheriv("aes-256-gcm", key, iv.subarray(0, 12)).setAAD(Buffer.from("other")).setAuthTag(tag);
forged.update(box);
try {
  forged.final();
} catch (error) {
  console.log("forged:", error instanceof Error);
}

const pair = crypto.generateKeyPairSync("ed25519");
const signature = crypto.sign(null, Buffer.from("signed"), pair.privateKey);
console.log(signature.length, crypto.verify(null, Buffer.from("signed"), pair.publicKey, signature), crypto.verify(null, Buffer.from("changed"), pair.publicKey, signature));
console.log(pair.publicKey.type, pair.privateKey.asymmetricKeyType, pair.publicKey.export({ type: "spki", format: "pem" }).split("\n")[0]);

console.log(crypto.randomBytes(8).length, /^[0-9a-f-]{36}$/.test(crypto.randomUUID()), crypto.randomInt(5) < 5, crypto.getRandomValues(new Uint8Array(4)).length);
console.log(crypto.timingSafeEqual(Buffer.from("same"), Buffer.from("same")), crypto.timingSafeEqual(Buffer.from("same"), Buffer.from("diff")));
console.log(Buffer.from(await crypto.subtle.digest("SHA-256", new TextEncoder().encode("abc"))).toString("hex").slice(0, 16), crypto.webcrypto.subtle === crypto.subtle);
console.log(crypto.getHashes().includes("sha256"), crypto.getCiphers().includes("aes-256-gcm"));
try {
  crypto.createHash("no-such-hash");
} catch (error) {
  console.log(error instanceof Error);
}
