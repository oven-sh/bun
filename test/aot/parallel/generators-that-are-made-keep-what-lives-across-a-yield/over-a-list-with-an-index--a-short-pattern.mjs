const said = []; function note(line) { said.push(String(line)); }
function show(value) { return typeof value === "bigint" ? value + "n" : typeof value === "object" && value ? JSON.stringify(value) : Object.is(value, -0) ? "-0" : String(value); }
function* steps(list) { let index = 0; for (const item of list) yield index++ + ":" + item; }
function run() {
  const it = steps(["a", "b", "c"]);
  globalThis.held = it;
  try { const [first] = it; note(show(first)); { const step = it.next(); note(step.done + " " + show(step.value)); } } catch (error) { note("left: " + (error && error.message || error)); }
}
for (let round = 0; round < 3; round++) { run(); note("--"); }
console.log(said.join("\n"));
