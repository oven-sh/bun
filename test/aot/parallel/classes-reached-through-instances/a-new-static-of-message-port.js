const hide = value => new CustomEvent("x", { detail: value }).detail;
hide(new MessageChannel().port1).constructor.extra = 41;
function read() {
  return MessagePort.extra;
}
console.log(read());
