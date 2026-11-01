const hide = value => new CustomEvent("x", { detail: value }).detail;
hide(new Bun.CryptoHasher("md5")).constructor.extra = 41;
function read() {
  return Bun.CryptoHasher.extra;
}
console.log(read());
