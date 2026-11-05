// Hashes, signers and verifiers are written to as streams. A chunk that comes after digest() is dropped.
const crypto = require("node:crypto");
const hash = crypto.createHash("md5");
hash.on("readable", () => {
  const digest = hash.read();
  if (digest) console.log("hash", digest.toString("hex"));
});
hash.write("a");
hash.write(Buffer.from("b"));
hash.end();
const hmac = crypto.createHmac("md5", "k");
hmac.setEncoding("hex");
hmac.on("data", digest => console.log("hmac", digest));
hmac.end("ab");
const late = crypto.createHash("md5");
console.log(late.update("a").digest("hex"));
late.write("b", () => console.log("written after digest"));
const keys = crypto.generateKeyPairSync("rsa", { modulusLength: 1024 });
const signer = crypto.createSign("sha256");
signer.write("a");
signer.end("b");
const verifier = crypto.createVerify("sha256");
verifier.end("ab");
console.log(verifier.verify(keys.publicKey, signer.sign(keys.privateKey)));
