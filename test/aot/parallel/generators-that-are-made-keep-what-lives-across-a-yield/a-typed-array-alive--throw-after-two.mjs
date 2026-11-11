const said = []; function note(line) { said.push(String(line)); }
function show(value) { return typeof value === "bigint" ? value + "n" : typeof value === "object" && value ? JSON.stringify(value) : Object.is(value, -0) ? "-0" : String(value); }
function* steps(size) { const bytes = new Uint8Array(size); const floats = new Float64Array(2); for (let i = 0; i < size; i++) { bytes[i] = i * 3; floats[i & 1] += i / 2; yield bytes[i]; } yield bytes.join() + "|" + floats.join(); }
function run() {
  const it = steps(4);
  globalThis.held = it;
  try { note(show(it.next().value)); note(show(it.next().value)); for (let turn = 0; turn < 8; turn++) { const step = turn ? it.next() : it.throw(new Error("thrown in")); note(step.done + " " + show(step.value)); if (step.done) break; } } catch (error) { note("left: " + (error && error.message || error)); }
}
for (let round = 0; round < 3; round++) { run(); note("--"); }
console.log(said.join("\n"));
