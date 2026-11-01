// The deprecated members of node:crypto: what the wrappers look like, what they answer, and one warning a code, also where util.deprecate() has used the code first.
process.noDeprecation = false;
const crypto = require("node:crypto");
const util = require("node:util");
const warnings = [];
process.on("warning", warning => warnings.push([warning.name, warning.code, warning.message].join(" ")));
process.on("exit", () => console.log(warnings.join("\n")));
const attempt = run => {
  try {
    return run();
  } catch (error) {
    return error.name + " " + error.code;
  }
};
const show = wrapper =>
  [
    typeof wrapper,
    wrapper.name,
    JSON.stringify(Object.getOwnPropertyDescriptor(wrapper, "length")),
    JSON.stringify(Object.getOwnPropertyDescriptor(wrapper, "prototype") ?? null, (key, value) =>
      key === "value" ? typeof value : value,
    ),
    Object.getPrototypeOf(wrapper).name,
  ].join(" | ");
for (const name of ["Hash", "Hmac", "prng", "rng", "pseudoRandomBytes"]) console.log(name, show(crypto[name]));
console.log("setPublicKey", show(crypto.ECDH.prototype.setPublicKey));
console.log(
  new crypto.Hash("md5").update("a").digest("hex"),
  crypto.Hash("md5").update("a").digest("hex"),
  new crypto.Hash("md5") instanceof crypto.Hash,
);
console.log(new crypto.Hmac("md5", "k").update("a").digest("hex"), crypto.Hmac("md5", "k") instanceof crypto.Hmac);
console.log(
  crypto.createHash("md5") instanceof crypto.Hash,
  crypto.Hash.prototype === Object.getPrototypeOf(crypto.createHash("md5")),
);
console.log(crypto.prng(4).length, crypto.rng(3).length, crypto.pseudoRandomBytes(2).length);
const mine = util.deprecate(function mine(a, b) {}, "mine is deprecated", "DEP0031");
mine();
const first = crypto.createECDH("prime256v1");
first.generateKeys();
const second = crypto.createECDH("prime256v1");
second.setPrivateKey(first.getPrivateKey());
second.setPublicKey(first.getPublicKey());
console.log(second.getPublicKey("hex") === first.getPublicKey("hex"));
console.log(
  attempt(() => new crypto.ECDH.prototype.setPublicKey()),
  attempt(() => crypto.ECDH.prototype.setPublicKey.call({}, first.getPublicKey())),
);
