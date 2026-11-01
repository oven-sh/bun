const hide = value => new CustomEvent("x", { detail: value }).detail;
hide(new MessageEvent("x")).constructor.extra = 41;
function read() {
  return MessageEvent.extra;
}
console.log(read());
