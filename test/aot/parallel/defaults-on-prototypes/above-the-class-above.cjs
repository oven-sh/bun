const seen = [];
class Base { }
Base.prototype.sent = true;
class Reply extends Base { constructor(n) { super(); this.code = n; this.sent = false; } }
function run(n) { const out = []; for (let i = 0; i < n; i++) { if (i === 2) Object.defineProperty(Base.prototype, "sent", { set(v) { seen.push(v); }, get() { return "got"; } }); const r = new Reply(i); out.push(r.sent + ":" + Object.keys(r).join()); } return out.join(" "); }
console.log(run(4), seen.join());
