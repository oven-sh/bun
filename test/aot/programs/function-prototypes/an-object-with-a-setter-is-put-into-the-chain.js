// The chain above the prototype changes: an object with a setter comes between the instances' prototype and what was above it. The default below it still hides it; without the default it is found.
const log = [];
function Base() {}
function Message(url, name) {
  this.url = url;
  this.name = name;
}
Object.setPrototypeOf(Message.prototype, Base.prototype);
Message.prototype.url = "";
function make(n, tag) {
  let last;
  for (let i = 0; i < n; i++) last = new Message(tag + i, tag);
  return last;
}
let m = make(40, "a");
log.push(Object.keys(m).join(), m.url, m.name);
const between = Object.create(Base.prototype, {
  url: { set(v) { log.push("between url " + v); }, configurable: true },
  name: { set(v) { log.push("between name " + v); }, configurable: true },
});
Object.setPrototypeOf(Message.prototype, between);
m = make(2, "b");
log.push(Object.keys(m).join(), m.url, String(m.name));
delete Message.prototype.url;
m = make(1, "c");
log.push(Object.keys(m).join(), String(m.url), String(m.name));
console.log(log.join(" | "));
