import crypto from "node:crypto";

console.log(crypto.createHash("sha256").update("hello").digest("hex"));
console.log(crypto.createHash("md5").update("hel").update(Buffer.from("lo")).digest("base64"), crypto.createHash("sha1").update("").digest().length);
console.log(crypto.createHmac("sha256", "secret").update("message").digest("hex"));
console.log(crypto.hash?.("sha1", "hello"), crypto.getHashes().includes("sha512"));
console.log(crypto.randomBytes(16).length, /^[0-9a-f-]{36}$/.test(crypto.randomUUID()), crypto.randomInt(5, 6), crypto.randomFillSync(new Uint8Array(4)).length);
console.log(crypto.timingSafeEqual(Buffer.from("same"), Buffer.from("same")), crypto.timingSafeEqual(Buffer.from("same"), Buffer.from("sama")));
console.log(crypto.pbkdf2Sync("password", "salt", 1000, 16, "sha256").toString("hex"), crypto.scryptSync("password", "salt", 16, { N: 1024 }).toString("hex"));

const key = Buffer.alloc(32, 7);
const iv = Buffer.alloc(12, 9);
const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
const sealed = Buffer.concat([cipher.update("a secret text", "utf8"), cipher.final()]);
const tag = cipher.getAuthTag();
console.log(sealed.toString("hex"), tag.length);
const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
decipher.setAuthTag(tag);
console.log(decipher.update(sealed, undefined, "utf8") + decipher.final("utf8"));
const forged = crypto.createDecipheriv("aes-256-gcm", key, iv);
forged.setAuthTag(Buffer.alloc(16));
try {
  forged.update(sealed);
  forged.final();
} catch (error) {
  console.log("refused", error instanceof Error);
}
try {
  crypto.createHash("no-such-hash");
} catch (error) {
  console.log(error.name, typeof error.message);
}
const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode("hello"));
console.log(Buffer.from(digest).toString("hex").slice(0, 16), digest.byteLength);
crypto.pbkdf2("password", "salt", 10, 8, "sha1", (error, derived) => console.log(error, derived.toString("hex")));
