const said = []; function note(line) { said.push(String(line)); }
function show(value) { return typeof value === "bigint" ? value + "n" : typeof value === "object" && value ? JSON.stringify(value) : Object.is(value, -0) ? "-0" : String(value); }
function* steps(limit) { const kept = { limit }; let turns = 0; try { for (let i = 0; i < limit; i++) { turns++; yield i; } fails(); } catch (error) { yield error.constructor.name + " " + kept.limit + " " + turns; } }
function run() {
  const it = steps(3);
  globalThis.held = it;
  try { const other = steps(3); for (let turn = 0; turn < 12; turn++) { const a = it.next(), b = other.next(); note(show(a.value) + " " + show(b.value)); if (a.done && b.done) break; } } catch (error) { note("left: " + (error && error.message || error)); }
}
for (let round = 0; round < 3; round++) { run(); note("--"); }
console.log(said.join("\n"));
