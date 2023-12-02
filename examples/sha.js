import { SHA1, SHA256, SHA512, SHA384, SHA512_256, MD5, MD4, RIPEMD160, sha } from "bun";

const input = "Hello World";
const [first, second] = input.split(" ");

const log = (name, ...args) => console.log(`${name}:`.padStart("SHA512_256: ".length), ...args);

console.log("");
// This is SHA512-256:
// This function is shorthand for SHA512_256.hash(input)
log("Bun.sha()", sha(input, "base64"));

log("SHA1", SHA1.hash(input, "hex"));
log("SHA256", SHA256.hash(input, "hex"));
log("SHA384", SHA384.hash(input, "hex"));
log("SHA512", SHA512.hash(input, "hex"));
log("SHA512_256", SHA512_256.hash(input, "hex"));
log("RIPEMD160", RIPEMD160.hash(input, "hex"));

console.log("");
console.log("---- Chunked ----");
console.log("");

// You can also do updates in chunks:
// const hash = new Hash();
for (let Hash of [SHA1, SHA256, SHA384, SHA512, SHA512_256, RIPEMD160]) {
  const hash = new Hash();
  hash.update(first);
  hash.update(" " + second);
  log(Hash.name, hash.digest("hex"));
}

console.log("");
console.log("---- Base64 ----");
console.log("");

// base64 or hex
for (let Hash of [SHA1, SHA256, SHA384, SHA512, SHA512_256]) {
  const hash = new Hash();
  hash.update(first);
  hash.update(" " + second);
  log(Hash.name, hash.digest("base64"));
}

console.log("");
console.log("---- Uint8Array ----");
console.log("");

// Uint8Array by default
for (let Hash of [SHA1, SHA256, SHA384, SHA512, SHA512_256]) {
  const hash = new Hash();
  hash.update(first);
  hash.update(" " + second);
  log(Hash.name, hash.digest());
}

console.log("");
console.log("---- Uint8Array can be updated in-place ----");
console.log("");

var oneBuf = new Uint8Array(1024);
// Update Uint8Array in-place instead of allocating a new one
for (let Hash of [SHA1, SHA256, SHA384, SHA512, SHA512_256]) {
  const hash = new Hash();
  hash.update(first);
  hash.update(" " + second);
  log(Hash.name, hash.digest(oneBuf).subarray(0, Hash.byteLength));
}
