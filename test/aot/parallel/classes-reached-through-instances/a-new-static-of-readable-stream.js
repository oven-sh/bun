const hide = value => new CustomEvent("x", { detail: value }).detail;
hide(new ReadableStream()).constructor.extra = 41;
function read() {
  return ReadableStream.extra;
}
console.log(read());
