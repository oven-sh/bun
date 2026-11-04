const again = Number(process.argv.length > 99);
const open = (0, eval)(`({ kept: [], keep(o) { this.kept.push(o); return o; }, deed(o) { Object.setPrototypeOf(o, null); }, stranger() { return null; } })`);
class Node { constructor(i) { this.issues = i; } size() { return 1; } }
function make(i) { return new Node(i); }
function probe(o, start = 0) { if (o.issues === true) return "true"; let seen = ""; for (let i = start; i < 1; i++) seen += o.issues; return String(o.issues) + seen; }
function read(o) { let said = ""; for (let k = 0; k < 2; k++) said += probe(o) + ";"; return said; }
function attempt(o, deed) { try { return read(o, deed); } catch (e) { return "throws " + e.constructor.name; } }
function run() {
  const said = [];
  const first = make(1), second = make(2), third = make(3);
  open.keep(first); open.keep(second); open.keep(third);
  for (let i = 0; i < 4; i++) said.push(attempt(first), attempt(second));
  said.push(attempt(first, o => open.deed(o)));
  open.deed(second);
  for (let i = 0; i < 3; i++) said.push(attempt(first), attempt(second), attempt(third));
  return said.join(" | ");
}
console.log(run());
