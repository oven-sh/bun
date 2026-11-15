const said = []; function note(line) { said.push(String(line)); }
function show(value) { return typeof value === "bigint" ? value + "n" : typeof value === "object" && value ? JSON.stringify(value) : Object.is(value, -0) ? "-0" : String(value); }
function* one(from) { let i = from; while (true) yield i++; } function* steps() { const a = one(0), b = one(100); for (let i = 0; i < 3; i++) { yield a.next().value; yield b.next().value; } }
function run() {
  const it = steps();
  globalThis.held = it;
  try { const [first, second, ...others] = it; note(show(first) + " " + show(second) + " " + others.length); } catch (error) { note("left: " + (error && error.message || error)); }
}
for (let round = 0; round < 3; round++) { run(); note("--"); }
console.log(said.join("\n"));
