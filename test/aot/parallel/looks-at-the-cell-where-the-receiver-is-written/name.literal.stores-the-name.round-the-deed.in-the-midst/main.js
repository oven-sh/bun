import { make, read } from "./lib.js";
const open = (0, eval)(`({ kept: [], keep(o) { this.kept.push(o); return o; }, deed(o) { o.aborted = 7; } })`);
open.keep(read);
function attempt(o, deed) { try { return read(o, deed); } catch (e) { return "throws " + e.constructor.name; } }
function run() {
  const said = [];
  const first = make(1, false), second = make(2, true), third = make(3, false);
  open.keep(first); open.keep(second); open.keep(third);
  said.push(attempt(first), attempt(second));
  said.push(attempt(first), attempt(second));
  said.push(attempt(first, o => open.deed(o)));
  open.deed(second);
  said.push(attempt(first), attempt(second), attempt(third));
  said.push(attempt(first), attempt(second), attempt(third));
  return said.join(" | ");
}
console.log(run());
