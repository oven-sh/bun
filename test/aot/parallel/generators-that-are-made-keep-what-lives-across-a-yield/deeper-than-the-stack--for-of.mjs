const said = []; function note(line) { said.push(String(line)); }
function show(value) { return typeof value === "bigint" ? value + "n" : typeof value === "object" && value ? JSON.stringify(value) : Object.is(value, -0) ? "-0" : String(value); }
function* down(depth) { if (depth > 0) yield* down(depth - 1); yield depth; } function* steps() { try { for (const value of down(1000000)) { yield value; break; } } catch (error) { yield error.constructor.name; } yield "on"; }
function run() {
  const it = steps();
  globalThis.held = it;
  try { for (const value of it) note(show(value)); } catch (error) { note("left: " + (error && error.message || error)); }
}
for (let round = 0; round < 3; round++) { run(); note("--"); }
console.log(said.join("\n"));
