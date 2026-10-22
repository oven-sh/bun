// The prototype holds a default. Later the default is redefined as an accessor: from then on the constructor's store calls the setter.
const log = [];
function Message(url) {
  this.id = 1;
  this.url = url;
}
Message.prototype.url = "";
function make(n) {
  let last;
  for (let i = 0; i < n; i++) last = new Message("/" + i);
  return last;
}
let m = make(50);
log.push(Object.keys(m).join(), m.url);
Object.defineProperty(Message.prototype, "url", {
  set(v) { log.push("set " + v); },
  get() { return "from getter"; },
  configurable: true,
});
m = make(2);
log.push(Object.keys(m).join(), m.url);
delete Message.prototype.url;
m = make(2);
log.push(Object.keys(m).join(), m.url);
Message.prototype.url = "again";
m = make(2);
log.push(Object.keys(m).join(), m.url, Object.create(Message.prototype).url);
console.log(log.join(" | "));
