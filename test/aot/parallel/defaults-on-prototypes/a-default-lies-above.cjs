function Reply(n) { this.code = n; this.sent = false; this.body = true; }
Reply.prototype.sent = true;
Reply.prototype.describe = function () { return this.code + (this.sent ? 1 : 0) + (this.body ? 2 : 0); };
function run(n) { let t = 0; for (let i = 0; i < n; i++) t += new Reply(i).describe(); return t; }
console.log(run(5), Object.keys(new Reply(1)).join(), Reply.prototype.sent, Object.hasOwn(new Reply(1), "sent"));
