// The base's prototype has a setter. Until the default is stored on the derived prototype the store calls the setter, afterwards it creates a property, and when the default is deleted it calls the setter again.
const log = [];
function Base() {}
Object.defineProperty(Base.prototype, "url", {
  set(v) { log.push("base set " + v); },
  get() { return "base get"; },
  configurable: true,
});
function Message(url) {
  Base.call(this);
  this.id = 1;
  this.url = url;
}
Object.setPrototypeOf(Message.prototype, Base.prototype);
function make(n, tag) {
  let last;
  for (let i = 0; i < n; i++) last = new Message(tag + i);
  return last;
}
let m = make(2, "a");
log.push(Object.keys(m).join(), m.url);
Object.defineProperty(Message.prototype, "url", { value: "", writable: true, enumerable: true, configurable: true });
m = make(40, "b");
log.push(Object.keys(m).join(), m.url);
delete Message.prototype.url;
m = make(2, "c");
log.push(Object.keys(m).join(), m.url);
console.log(log.join(" | "));
