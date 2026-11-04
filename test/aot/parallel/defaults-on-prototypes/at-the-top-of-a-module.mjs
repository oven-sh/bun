function Reply(n) { this.code = n; this.sent = false; this.body = true; }
Reply.prototype.sent = true;
const out = [];
for (let i = 0; i < 4; i++) { if (i === 2) Object.defineProperty(Reply.prototype, "sent", { writable: false }); try { out.push(new Reply(i).sent); } catch (e) { out.push(e.constructor.name); } }
console.log(out.join(" "));
