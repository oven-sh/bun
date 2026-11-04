function Reply(n) { this.code = n; this.sent = false; }
Reply.prototype.sent = true;
function run(n) { const out = []; for (let i = 0; i < n; i++) { if (i === 2) delete Reply.prototype.sent; const r = new Reply(i); delete r.sent; out.push(String(r.sent)); } return out.join(" "); }
console.log(run(4));
