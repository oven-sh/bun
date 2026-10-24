// The function that makes the constructor runs twice: the second prototype object has a setter where the first has a default.
const log = [];
function define(withSetter) {
  function Message(url) {
    this.id = 1;
    this.url = url;
  }
  if (withSetter)
    Object.defineProperty(Message.prototype, "url", { set(v) { log.push("set " + v); }, get() { return "getter"; }, configurable: true });
  else
    Message.prototype.url = "";
  return Message;
}
const First = define(false);
let m;
for (let i = 0; i < 40; i++) m = new First("/" + i);
log.push(Object.keys(m).join(), m.url);
const Second = define(true);
m = new Second("/second");
log.push(Object.keys(m).join(), m.url);
m = new First("/first");
log.push(Object.keys(m).join(), m.url);
const Third = define(false);
m = new Third("/third");
log.push(Object.keys(m).join(), m.url);
console.log(log.join(" | "));
