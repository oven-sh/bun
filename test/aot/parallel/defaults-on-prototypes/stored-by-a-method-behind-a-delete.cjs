const seen = [];
function Reply(n) { this.code = n; this.sent = false; }
Reply.prototype.sent = true;
Reply.prototype.reset = function () { this.sent = 0; };
function run(n) { const out = []; for (let i = 0; i < n; i++) { if (i === 2) Object.defineProperty(Reply.prototype, "sent", { set(v) { seen.push(v); }, get() { return "got"; } }); const r = new Reply(i); delete r.sent; r.reset(); out.push(r.sent + ":" + Object.keys(r).join()); } return out.join(" "); }
console.log(run(4), seen.join());
