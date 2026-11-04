const hide = value => new CustomEvent("x", { detail: value }).detail;
hide(new MessageChannel()).constructor.extra = 41;
function read() {
  return MessageChannel.extra;
}
console.log(read());
