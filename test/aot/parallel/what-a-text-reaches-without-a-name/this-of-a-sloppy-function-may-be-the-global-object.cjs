// `this` of a sloppy function may be the global object: Link looks through every holder below it and finds Reflect.get under the `get` of the descriptor.
const seen = [];
function Reply(n) { this.code = n; this.sent = false; this.body = true; }
Reply.prototype.sent = true;
const a = new Reply(1);
Object.defineProperty(Reply.prototype, "sent", { set(v) { seen.push(v); }, get() { return "got"; } });
const b = new Reply(2);
console.log(a.sent, Object.keys(a).join(), b.sent, Object.keys(b).join(), seen.join());
