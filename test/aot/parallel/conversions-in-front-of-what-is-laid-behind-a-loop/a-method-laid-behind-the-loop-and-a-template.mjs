// The method is laid behind the loop, and a template converts the object in the loop and behind it.
const seen = [];
const limit = JSON.parse("1");
function Gauge() { let work = 0; for (let i = 0; i < 2; i++) work = (work + i) | 0; this.n = work; }
function tell() { let work = 0; for (let i = 0; i < 2; i++) work = (work + i) | 0; let kind; try { kind = String(new Gauge().read()); } catch (e) { kind = e instanceof TypeError ? "TypeError" : "another error"; } seen.push(kind); }
const box = { toString() { tell(); return "box"; } };
let turns = 0;
let got;
for (;;) {
  if (turns === limit) break;
  turns++;
  got = `a${box}`;
}
Gauge.prototype.read = function () { let work = 0; for (let i = 0; i < 2; i++) work = (work + i) | 0; return this.n; };
got = `b${box}`;
console.log(seen.join(" "), typeof got);
