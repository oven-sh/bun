const crypto = require("node:crypto");
let out = "";
const small = Buffer.from("the quick brown fox jumps over the lazy dog"), large = Buffer.alloc(1 << 20, 3);
for (const name of ["md5", "sha1", "sha256", "sha512"]) {
  let last = small;
  for (let i = 0; i < 6666; i++) last = crypto.createHash(name).update(last).digest();
  out += last.toString("hex").slice(0, 8) + " ";
  out += crypto.createHash(name).update(large).update(large).digest("base64").slice(0, 8) + " ";
}
let mac = small;
for (let i = 0; i < 6666; i++) mac = crypto.createHmac("sha256", "key").update(mac).digest();
out += mac.toString("hex").slice(0, 8) + " ";
out += crypto.pbkdf2Sync("password", "salt", 20000, 32, "sha256").toString("hex").slice(0, 8) + " ";
const key = Buffer.alloc(32, 1), iv = Buffer.alloc(12, 2);
let text = small;
for (let i = 0; i < 1666; i++) {
  const c = crypto.createCipheriv("aes-256-gcm", key, iv); const e = Buffer.concat([c.update(small), c.final()]); const tag = c.getAuthTag();
  const d = crypto.createDecipheriv("aes-256-gcm", key, iv); d.setAuthTag(tag); text = Buffer.concat([d.update(e), d.final()]);
}
out += text.length + " ";
let n = 0;
for (let i = 0; i < 16666; i++) n += crypto.randomUUID().length + crypto.randomBytes(16).length + crypto.randomInt(10, 11);
out += n + " ";
let h = 0n;
for (let i = 0; i < 66666; i++) h ^= BigInt(Bun.hash("key" + i));
out += h.toString(16) + " ";
let hasher = "";
for (let i = 0; i < 6666; i++) hasher = new Bun.CryptoHasher("sha256").update(hasher + i).digest("hex");
out += hasher.slice(0, 8) + " ";
out += Bun.SHA256.hash(large, "hex").slice(0, 8) + " ";
(async () => {
  let d = small;
  for (let i = 0; i < 1666; i++) d = new Uint8Array(await crypto.subtle.digest("SHA-256", d));
  out += Buffer.from(d).toString("hex").slice(0, 8);
  const pair = crypto.generateKeyPairSync("ed25519");
  let ok = 0;
  for (let i = 0; i < 100; i++) ok += crypto.verify(null, small, pair.publicKey, crypto.sign(null, small, pair.privateKey)) ? 1 : 0;
  console.log("crypto", out, ok);
})();
