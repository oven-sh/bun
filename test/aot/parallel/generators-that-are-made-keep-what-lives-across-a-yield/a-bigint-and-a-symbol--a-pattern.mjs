const said = []; function note(line) { said.push(String(line)); }
function show(value) { return typeof value === "bigint" ? value + "n" : typeof value === "object" && value ? JSON.stringify(value) : Object.is(value, -0) ? "-0" : String(value); }
const mark = Symbol("mark"); function* steps(big) { const held = mark; yield big * 2n; yield held.description; yield big + 1n; }
function run() {
  const it = steps(12345678901234567890n);
  globalThis.held = it;
  try { const [first, second, ...others] = it; note(show(first) + " " + show(second) + " " + others.length); } catch (error) { note("left: " + (error && error.message || error)); }
}
for (let round = 0; round < 3; round++) { run(); note("--"); }
console.log(said.join("\n"));
