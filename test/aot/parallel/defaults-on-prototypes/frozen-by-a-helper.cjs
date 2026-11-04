const seen = [];
function Reply(n) { this.code = n; this.sent = false; this.body = true; }
Reply.prototype.sent = true;
function run(n) { const out = []; for (let i = 0; i < n; i++) { if (i === 2) { deepFreeze(Reply.prototype); } const r = new Reply(i); out.push(r.sent + ":" + Object.keys(r).join()); } return out.join(" "); }
console.log(run(4), seen.join());
function deepFreeze(o) { for (const k of Object.keys(o)) if (typeof o[k] === "object" && o[k]) deepFreeze(o[k]); return Object.freeze(o); }
