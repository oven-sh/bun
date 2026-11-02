// What `digest()` and `hash()` answer is made by native code: a Buffer or a Uint8Array, a string for an encoding, or the buffer that they were given.
// Its class is reached through `constructor`, and a static member that is named there is in the executable.
const digest = new Bun.CryptoHasher("sha1").update("a").digest();
console.log(digest.constructor === Buffer, digest.constructor.from("b").length, Object.getPrototypeOf(digest).constructor.from("bc").length);
console.log(digest.constructor.alloc(2).length, digest.constructor.concat([digest]).length, digest.constructor.isBuffer(digest));

function lengthOfOneMore(value) {
  return value.constructor.from("b").length;
}
console.log(lengthOfOneMore(JSON.parse("[1]")), lengthOfOneMore(new Bun.CryptoHasher("sha1").update("a").digest()), lengthOfOneMore(Bun.SHA1.hash("a")));

const nameOf = value => (typeof value === "string" ? "string" : value.constructor.name);
const bytes = new Uint8Array(64);
console.log(nameOf(new Bun.CryptoHasher("sha1").update("a").digest("hex")), new Bun.CryptoHasher("sha1").update("a").digest(bytes) === bytes, nameOf(new Bun.CryptoHasher("sha1").update("a").digest(null)));
for (const into of [new ArrayBuffer(64), new DataView(new ArrayBuffer(64)), new Float64Array(8)]) {
  const answered = new Bun.CryptoHasher("sha1").update("a").digest(into);
  console.log(nameOf(into), answered === into);
}
console.log(nameOf(new Bun.SHA1().update("a").digest()), nameOf(new Bun.SHA1().update("a").digest("hex")), new Bun.SHA1().update("a").digest(bytes) === bytes);
console.log(nameOf(Bun.SHA1.hash("a")), nameOf(Bun.SHA1.hash("a", "hex")), Bun.SHA1.hash("a", bytes) === bytes, nameOf(Bun.sha("a")), nameOf(Bun.sha("a", "base64")));
console.log(nameOf(Bun.CryptoHasher.hash("sha1", "a")), nameOf(Bun.CryptoHasher.hash("sha1", "a", "hex")), Bun.CryptoHasher.hash("sha1", "a", bytes) === bytes);
