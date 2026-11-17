import { make, read } from "./lib.js";
const open = (0, eval)(`({ kept: [], keep(o) { this.kept.push(o); return o; }, deed(o) { let n = 0; Object.defineProperty(o, "aborted", { get() { return ++n; }, configurable: true }); } })`);
open.keep(read);
async function attempt(o, deed) { try { return await read(o, deed); } catch (e) { return "throws " + e.constructor.name; } }
async function run() {
  const said = [];
  const first = make(1, false), second = make(2, true), third = make(3, false);
  open.keep(first); open.keep(second); open.keep(third);
  said.push(await attempt(first), await attempt(second));
  said.push(await attempt(first), await attempt(second));
  said.push(await attempt(first, o => open.deed(o)));
  open.deed(second);
  said.push(await attempt(first), await attempt(second), await attempt(third));
  said.push(await attempt(first), await attempt(second), await attempt(third));
  return said.join(" | ");
}
run().then(said => console.log(said));
