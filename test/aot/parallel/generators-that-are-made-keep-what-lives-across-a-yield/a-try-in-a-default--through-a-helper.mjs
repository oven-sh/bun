const said = []; function note(line) { said.push(String(line)); }
function show(value) { return typeof value === "bigint" ? value + "n" : typeof value === "object" && value ? JSON.stringify(value) : Object.is(value, -0) ? "-0" : String(value); }
function risky(flag) { try { if (flag) throw new Error("risk"); return 1; } catch (error) { note("default caught " + error.message); return 2; } } function* steps(first = risky(true), second = risky(false)) { yield first; yield second; yield first + second; }
function run() {
  const it = steps();
  globalThis.held = it;
  try { note(it.map(show).take(4).toArray().join(" ")); } catch (error) { note("left: " + (error && error.message || error)); }
}
for (let round = 0; round < 3; round++) { run(); note("--"); }
console.log(said.join("\n"));
