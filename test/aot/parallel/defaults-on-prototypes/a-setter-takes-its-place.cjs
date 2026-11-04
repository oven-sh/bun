const seen = [];
function Reply(n) { this.code = n; this.sent = false; this.body = true; }
Reply.prototype.sent = true;
function run(n) { const out = []; for (let i = 0; i < n; i++) { if (i === 2) Object.defineProperty(Reply.prototype, "sent", { get() { return "got"; }, set(v) { seen.push(this.code + ":" + v); } }); const r = new Reply(i); out.push(r.sent + ":" + Object.keys(r).join()); } return out.join(" "); }
console.log(run(4), seen.join());
