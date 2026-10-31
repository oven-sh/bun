crypto.subtle.__proto__.extra = 41;
function read() {
  return SubtleCrypto.prototype.extra;
}
console.log(read());
