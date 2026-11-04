const again = Number(process.argv.length > 99);
const open = (0, eval)(`({ kept: [], keep(o) { this.kept.push(o); return o; }, deed(o) { o[Symbol.for("issues")] = 7; }, stranger() { return null; } })`);
function make(i) { return { issues: i, more: "m" }; }
function read(o) { return String(o.issues) + "!"; }
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
