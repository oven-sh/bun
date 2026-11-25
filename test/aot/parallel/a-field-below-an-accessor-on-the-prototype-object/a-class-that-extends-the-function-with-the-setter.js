const log = [];
function Message(url) { this.id = 1; this.url = url; }
Object.defineProperty(Message.prototype, "url", { set(v) { log.push(v + ":" + this.more + ":" + this.last); }, get() { return "getter"; }, configurable: true });
class Two extends Message { more = 5; constructor(url) { super(url); this.last = 1; } }
function read(o) { return [o.id, o.url, o.more, o.last, Object.keys(o)].join(); }
let s = "";
for (let i = 0; i < 3; i++)
    s += read(new Two("/" + i)) + ";";
console.log(s, log.join());
