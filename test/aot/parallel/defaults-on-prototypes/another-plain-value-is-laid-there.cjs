function Reply(n) { this.code = n; this.sent = false; }
Reply.prototype.sent = true;
function run(n) { const out = []; for (let i = 0; i < n; i++) { if (i === 2) Reply.prototype.sent = "later"; const r = new Reply(i); const own = r.sent; delete r.sent; out.push(own + ":" + r.sent); } return out.join(" "); }
console.log(run(4));
