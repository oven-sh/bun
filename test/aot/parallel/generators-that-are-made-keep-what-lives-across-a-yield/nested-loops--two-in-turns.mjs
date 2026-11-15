const said = []; function note(line) { said.push(String(line)); }
function show(value) { return typeof value === "bigint" ? value + "n" : typeof value === "object" && value ? JSON.stringify(value) : Object.is(value, -0) ? "-0" : String(value); }
function* steps(rows, columns) { for (let r = 0; r < rows; r++) { for (let c = 0; c < columns; c++) yield r * 10 + c; yield "row " + r; } }
function run() {
  const it = steps(3, 2);
  globalThis.held = it;
  try { const other = steps(3, 2); for (let turn = 0; turn < 12; turn++) { const a = it.next(), b = other.next(); note(show(a.value) + " " + show(b.value)); if (a.done && b.done) break; } } catch (error) { note("left: " + (error && error.message || error)); }
}
for (let round = 0; round < 3; round++) { run(); note("--"); }
console.log(said.join("\n"));
