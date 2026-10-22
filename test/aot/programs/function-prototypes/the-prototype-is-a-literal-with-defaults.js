// The prototype object is a literal of the program that holds the defaults, an accessor among them.
const log = [];
function Message(url, method, mode) {
  this.url = url;
  this.method = method;
  this.mode = mode;
}
Message.prototype = {
  constructor: Message,
  url: "",
  method: null,
  set mode(v) { log.push("set mode " + v); },
  get mode() { return "mode getter"; },
  describe() { return this.method + " " + this.url + " " + this.mode; },
};
let m;
for (let i = 0; i < 40; i++) m = new Message("/" + i, "GET", i < 2 ? "m" + i : undefined);
log.push(Object.keys(m).join(), m.describe());
Object.defineProperty(Message.prototype, "method", { set(v) { log.push("set method " + v); }, get() { return "method getter"; }, configurable: true });
m = new Message("/x", "POST", "q");
log.push(Object.keys(m).join(), m.describe());
Message.prototype.url = "changed default";
m = new Message("/y", "PUT", "r");
log.push(Object.keys(m).join(), m.describe(), Object.create(Message.prototype).url);
console.log(log.join(" | "));
