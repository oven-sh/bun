const hide = value => new CustomEvent("x", { detail: value }).detail;
hide(new EventTarget()).constructor.extra = 41;
function read() {
  return EventTarget.extra;
}
console.log(read());
