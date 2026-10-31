const hide = value => new CustomEvent("x", { detail: value }).detail;
hide(crypto).constructor.extra = 41;
function read() {
  return Crypto.extra;
}
console.log(read());
