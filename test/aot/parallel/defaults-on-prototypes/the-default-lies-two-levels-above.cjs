const seen = [];
function Base() {}
Base.prototype.sent = true;
function Reply(n) { this.code = n; this.sent = false; }
Reply.prototype = Object.create(Base.prototype);
function run(n) { const out = []; for (let i = 0; i < n; i++) { if (i === 2) Object.defineProperty(Base.prototype, "sent", { set(v) { seen.push(v); }, get() { return "got"; } }); const r = new Reply(i); out.push(r.sent + ":" + Object.keys(r).join()); } return out.join(" "); }
console.log(run(4), seen.join());
