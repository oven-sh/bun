const hide = value => new CustomEvent("x", { detail: value }).detail;
hide(new FinalizationRegistry(() => {})).constructor.extra = 41;
function read() {
  return FinalizationRegistry.extra;
}
console.log(read());
