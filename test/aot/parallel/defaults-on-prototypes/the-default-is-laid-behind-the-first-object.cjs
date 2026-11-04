const seen = [];
function Reply(n) { this.code = n; this.sent = false; }
function run(n) { const out = []; for (let i = 0; i < n; i++) { if (i === 1) Reply.prototype.sent = true; if (i === 3) Object.defineProperty(Reply.prototype, "sent", { set(v) { seen.push(v); }, get() { return "got"; } }); const r = new Reply(i); out.push(r.sent + ":" + Object.keys(r).join()); } return out.join(" "); }
console.log(run(5), seen.join());
