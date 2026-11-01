Object.getPrototypeOf(crypto.subtle).extra = 41;
function read() {
  return SubtleCrypto.prototype.extra;
}
console.log(read());
