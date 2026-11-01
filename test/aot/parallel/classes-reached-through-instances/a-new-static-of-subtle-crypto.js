const hide = value => new CustomEvent("x", { detail: value }).detail;
hide(crypto.subtle).constructor.extra = 41;
function read() {
  return SubtleCrypto.extra;
}
console.log(read());
