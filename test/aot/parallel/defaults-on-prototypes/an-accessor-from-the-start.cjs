const seen = [];
function Reply(n) { this.code = n; this.sent = false; this.body = true; }
Object.defineProperty(Reply.prototype, "sent", { get() { return "got"; }, set(v) { seen.push(v); } });
function run(n) { const out = []; for (let i = 0; i < n; i++) { const r = new Reply(i); out.push(r.sent + ":" + Object.keys(r).join()); } return out.join(" "); }
console.log(run(3), seen.join());
