const said = []; function note(line) { said.push(String(line)); }
function show(value) { return typeof value === "bigint" ? value + "n" : typeof value === "object" && value ? JSON.stringify(value) : Object.is(value, -0) ? "-0" : String(value); }
function* steps(limit) { const kept = { name: "kept" }; let text = "t"; for (let i = 0; i < limit; i++) { let waste = []; for (let j = 0; j < 20000; j++) waste.push({ j, text: "w" + j }); text += waste.length; yield kept.name + i; } yield text; }
function run() {
  const it = steps(6);
  globalThis.held = it;
  try { note(show(it.next().value)); note(show(it.next().value)); { const step = it.return("asked"); note(step.done + " " + show(step.value)); } for (let turn = 0; turn < 6; turn++) { const step = it.next(); note(step.done + " " + show(step.value)); if (step.done) break; } } catch (error) { note("left: " + (error && error.message || error)); }
}
for (let round = 0; round < 3; round++) { run(); note("--"); }
console.log(said.join("\n"));
