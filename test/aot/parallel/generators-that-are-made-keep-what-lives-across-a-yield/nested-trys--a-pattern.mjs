const said = []; function note(line) { said.push(String(line)); }
function show(value) { return typeof value === "bigint" ? value + "n" : typeof value === "object" && value ? JSON.stringify(value) : Object.is(value, -0) ? "-0" : String(value); }
function* steps() { let trail = ""; try { try { trail += "a"; yield trail; throw "inner"; } finally { trail += "b"; yield trail; } } catch (thrown) { trail += thrown; yield trail; } yield trail + "!"; }
function run() {
  const it = steps();
  globalThis.held = it;
  try { const [first, second, ...others] = it; note(show(first) + " " + show(second) + " " + others.length); } catch (error) { note("left: " + (error && error.message || error)); }
}
for (let round = 0; round < 3; round++) { run(); note("--"); }
console.log(said.join("\n"));
