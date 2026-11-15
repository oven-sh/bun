Boolean.prototype.label = 7;
let kept = "start";
function pick(x) { const label = x.label; let seen = 0; if (x === true) seen = 1; else seen = label.length; kept = label; return seen; }
function tell() { return typeof kept; }
const out = [];
for (let turn = 0; turn < 12; turn++) { out.push(pick({ label: "abc" }) + tell()); out.push(pick(true) + tell()); }
console.log("SAID " + out.slice(0, 2).join(" "));
