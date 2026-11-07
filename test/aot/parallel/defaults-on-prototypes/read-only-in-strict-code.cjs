"use strict";
function Reply(n) { this.code = n; this.sent = false; this.body = true; }
Reply.prototype.sent = true;
function run(n) { const out = []; for (let i = 0; i < n; i++) { if (i === 2) Object.defineProperty(Reply.prototype, "sent", { writable: false }); try { out.push(new Reply(i).sent); } catch (e) { out.push(e.constructor.name); } } return out.join(" "); }
console.log(run(4));
