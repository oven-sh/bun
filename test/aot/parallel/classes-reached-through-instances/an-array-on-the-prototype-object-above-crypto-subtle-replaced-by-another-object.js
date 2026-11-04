SubtleCrypto.prototype.list = [1, 2];
Object.getPrototypeOf(crypto.subtle).list = { length: 3 };
function read() {
  return SubtleCrypto.prototype.list.length;
}
console.log(read());
