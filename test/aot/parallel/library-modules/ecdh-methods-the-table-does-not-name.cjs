// The table names one method of ECDH's prototype. A method that a program stores there under another name is found, and an object below the prototype finds what the prototype holds.
const crypto = require("node:crypto");
const { ECDH } = crypto;
process.on("warning", warning => console.log("warning", warning.code));
const attempt = run => {
  try {
    return run();
  } catch (error) {
    return error.name + " " + error.code;
  }
};
const first = crypto.createECDH("prime256v1");
first.generateKeys();
const original = ECDH.prototype.computeSecret;
ECDH.prototype.computeSecret = function mine(key) {
  return "mine " + typeof this + " " + original.call(this, key).length;
};
const second = crypto.createECDH("prime256v1");
second.generateKeys();
console.log(second.computeSecret(first.getPublicKey()));
const below = Object.setPrototypeOf({}, ECDH.prototype);
console.log(
  typeof below.setPublicKey,
  below.setPublicKey.name,
  attempt(() => below.setPublicKey(first.getPublicKey())),
);
const name = process.argv[2] ?? ["set", "Public", "Key"].join("");
second.setPrivateKey(first.getPrivateKey());
second[name](first.getPublicKey());
console.log(second.getPublicKey("hex") === first.getPublicKey("hex"));
console.log(Object.getOwnPropertyNames(ECDH.prototype).sort().join());
class Mine extends ECDH {
  setPublicKey(key) {
    console.log("mine");
    return super.setPublicKey(key);
  }
}
const third = new Mine("prime256v1");
third.setPrivateKey(first.getPrivateKey());
third.setPublicKey(first.getPublicKey());
console.log(third instanceof ECDH);
