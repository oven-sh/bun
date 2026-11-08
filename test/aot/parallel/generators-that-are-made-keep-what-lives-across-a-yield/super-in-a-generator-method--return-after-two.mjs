const said = []; function note(line) { said.push(String(line)); }
function show(value) { return typeof value === "bigint" ? value + "n" : typeof value === "object" && value ? JSON.stringify(value) : Object.is(value, -0) ? "-0" : String(value); }
class Base { *steps() { yield "base"; } name() { return "base name"; } } class Below extends Base { *steps() { yield super.name(); yield* super.steps(); yield "below"; } }
function run() {
  const it = new Below().steps();
  globalThis.held = it;
  try { note(show(it.next().value)); note(show(it.next().value)); { const step = it.return("asked"); note(step.done + " " + show(step.value)); } for (let turn = 0; turn < 6; turn++) { const step = it.next(); note(step.done + " " + show(step.value)); if (step.done) break; } } catch (error) { note("left: " + (error && error.message || error)); }
}
for (let round = 0; round < 3; round++) { run(); note("--"); }
console.log(said.join("\n"));
