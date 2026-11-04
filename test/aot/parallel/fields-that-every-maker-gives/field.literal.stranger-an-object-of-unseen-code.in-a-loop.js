const again = Number(process.argv.length > 99);
const open = (0, eval)(`({ kept: [], keep(o) { this.kept.push(o); return o; }, deed(o) {  }, stranger() { return ({ issues: 1 }); } })`);
function make(i) { return { issues: i }; }
function read(o) { let found = 0, last; for (let k = 0; k < 3; k++) { last = o.issues; if (last === true || last === 7) found++; } return found + ":" + String(last); }
function attempt(o, deed) { try { return read(o, deed); } catch (e) { return "throws " + e.constructor.name; } }
function run() {
  const said = [];
  const first = make(1), second = make(2), third = make(3);
  open.keep(first); open.keep(second); open.keep(third);
  for (let i = 0; i < 4; i++) said.push(attempt(first), attempt(second));
  said.push(attempt(first, o => open.deed(o)));
  open.deed(second);
  for (let i = 0; i < 3; i++) said.push(attempt(first), attempt(second), attempt(third));
  said.push(attempt(open.stranger()), attempt(first), attempt(open.stranger()));
  return said.join(" | ");
}
console.log(run());
