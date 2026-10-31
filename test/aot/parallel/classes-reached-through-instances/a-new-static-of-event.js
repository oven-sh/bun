const hide = value => new CustomEvent("x", { detail: value }).detail;
hide(new Event("x")).constructor.extra = 41;
function read() {
  return Event.extra;
}
console.log(read());
