(0, eval)("0"); // One evaluation anywhere, and unseen code may run in the whole build.
// valueOf answers the conversion, by a minus and by a unary plus.
const seen = [];
const limit = JSON.parse("1");
function Gauge() { let work = 0; for (let i = 0; i < 2; i++) work = (work + i) | 0; this.n = work; }
function tell() { let work = 0; for (let i = 0; i < 2; i++) work = (work + i) | 0; let kind; try { kind = String(new Gauge().read()); } catch (e) { kind = e instanceof TypeError ? "TypeError" : "another error"; } seen.push(kind); }
const box = { valueOf() { tell(); return 7; } };
let turns = 0;
let got;
for (;;) {
  if (turns === limit) break;
  turns++;
  got = box - 1;
}
Gauge.prototype.read = function () { let work = 0; for (let i = 0; i < 2; i++) work = (work + i) | 0; return this.n; };
got = +box;
console.log(seen.join(" "), typeof got);
