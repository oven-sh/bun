function Reply() { this.flag = 1; }
Object.defineProperty(Reply.prototype, "sent", { set(v) { this.kept = v; }, get() { return "got " + this.kept; }, configurable: true });
function make(v) { const o = Object.create(Reply.prototype); o.sent = v; o.last = 2; return o; }
function read(o) { return o.sent; }
let s = "";
for (let i = 0; i < 3; i++)
    s += read(make(i)) + ":" + Object.keys(make(i)).join() + ";";
console.log(s);
