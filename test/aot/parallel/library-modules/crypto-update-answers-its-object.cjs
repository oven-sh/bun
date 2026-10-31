// update() of a hash, an HMAC, a signer and a verifier answers the object it was called on.
const crypto = require("node:crypto");
const attempt = run => {
  try {
    return run();
  } catch (error) {
    return error.name + " " + error.code;
  }
};
const hash = crypto.createHash("sha256");
console.log(
  hash.update("a") === hash,
  hash.update(Buffer.from("b"), undefined) === hash,
  hash.copy().digest("hex"),
  hash.digest("hex"),
);
console.log(
  attempt(() => hash.update("c")),
  attempt(() => crypto.createHash("md5").update(5)),
  attempt(() => crypto.createHash("md5").update()),
);
const hmac = crypto.createHmac("sha1", "key");
console.log(
  hmac.update("a") === hmac,
  hmac.update("b", "utf8").digest("base64"),
  attempt(() => hmac.update("c")),
);
const keys = crypto.generateKeyPairSync("rsa", { modulusLength: 1024 });
const signer = crypto.createSign("sha256");
console.log(signer.update("a") === signer, signer.update("b", "utf8") === signer);
const verifier = crypto.createVerify("sha256");
console.log(
  verifier.update("a") === verifier,
  verifier.update("b") === verifier,
  verifier.verify(keys.publicKey, signer.sign(keys.privateKey)),
);
