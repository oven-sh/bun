(0, eval)("0"); // One evaluation anywhere, and unseen code may run in the whole build.
const seen = [];
const limit = JSON.parse("1");
function Gauge() { let work = 0; for (let i = 0; i < 2; i++) work = (work + i) | 0; this.n = work; }
const box = {
  toString() {
    let work = 0; for (let i = 0; i < 2; i++) work = (work + i) | 0;
    let kind;
    try { kind = String(new Gauge().read()); } catch (e) { kind = e.name; }
    seen.push(kind);
    return "box";
  },
};
let turns = 0;
let text = "";
for (;;) {
  if (turns === limit) break;
  turns++;
  text = "a" + box;
}
Gauge.prototype.read = function () { let work = 0; for (let i = 0; i < 2; i++) work = (work + i) | 0; return this.n; };
text = text + "b" + box;
console.log(seen.join(" "), text);
