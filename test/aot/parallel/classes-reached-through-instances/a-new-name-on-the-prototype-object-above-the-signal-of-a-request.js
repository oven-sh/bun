Object.getPrototypeOf(new Request("http://a/").signal).extra = 41;
function read() {
  return AbortSignal.prototype.extra;
}
console.log(read());
