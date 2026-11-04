const seen = [];
globalThis.seen = seen;
function Reply(n) { this.code = n; this.sent = false; this.body = true; }
Reply.prototype.sent = true;
const change = (0, eval)("(F) => Object.defineProperty(F.prototype, 'sent', { set(v) { seen.push(v); }, get() { return 'got'; } })");
function run(n) { const out = []; for (let i = 0; i < n; i++) { if (i === 2) change(Reply); const r = new Reply(i); out.push(r.sent + ":" + Object.keys(r).join()); } return out.join(" "); }
console.log(run(4), seen.join());
