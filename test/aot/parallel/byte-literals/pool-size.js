// Buffer.poolSize can be read and written. Its value does not change the offset or the buffer of bytes made from a literal.
// STATISTIC: ByteLiteralsEncoded = 4
function where(bytes) {
  return [bytes.byteOffset, bytes.buffer.byteLength, bytes.length].join(" ");
}
function make() {
  return [where(Buffer.from("a")), where(Buffer.from("hello, world")), where(Buffer.from("6869", "hex")), where(Buffer.from([1, 2, 3])), where(Buffer.from("aGk=", "base64"))].join(" | ");
}
console.log(Buffer.poolSize, "|", make());
Buffer.poolSize = 0;
console.log(Buffer.poolSize, "|", make());
Buffer.poolSize = 1 << 20;
console.log(Buffer.poolSize, "|", make());
