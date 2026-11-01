const hide = value => new CustomEvent("x", { detail: value }).detail;
hide(new AbortController().signal).constructor.extra = 41;
function read() {
  return AbortSignal.extra;
}
console.log(read());
