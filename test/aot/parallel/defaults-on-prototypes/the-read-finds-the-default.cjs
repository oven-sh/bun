function Reply(n) { this.code = n; if (n & 1) this.sent = false; }
Reply.prototype.sent = true;
function run(n) { const out = []; for (let i = 0; i < n; i++) { const r = new Reply(i); out.push(r.sent + ":" + ("sent" in r) + ":" + Object.hasOwn(r, "sent")); } return out.join(" "); }
console.log(run(4));
