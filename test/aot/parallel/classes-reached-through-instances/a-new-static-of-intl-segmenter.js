const hide = value => new CustomEvent("x", { detail: value }).detail;
hide(new Intl.Segmenter()).constructor.extra = 41;
function read() {
  return Intl.Segmenter.extra;
}
console.log(read());
