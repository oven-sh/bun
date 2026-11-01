const key = ["proto", "type"].join("");
function Q() {}
Q.prototype.describe = function () { return "first"; };
const second = { describe() { return "second"; } };
const first = Q.prototype;
function run() { const q = new Q(); Q[key] = second; const r = new Q(); Q[key] = first; return q.describe() + " " + r.describe(); }
for (let i = 0; i < 3; i++) console.log(run());
