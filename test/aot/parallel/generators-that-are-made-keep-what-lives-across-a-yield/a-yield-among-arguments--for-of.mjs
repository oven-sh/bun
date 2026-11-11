const said = []; function note(line) { said.push(String(line)); }
function show(value) { return typeof value === "bigint" ? value + "n" : typeof value === "object" && value ? JSON.stringify(value) : Object.is(value, -0) ? "-0" : String(value); }
function join(a, b, c) { return [a, b, c].join("/"); } function* steps(base) { yield join(base, yield "middle", base + 1); }
function run() {
  const it = steps(3);
  globalThis.held = it;
  try { for (const value of it) note(show(value)); } catch (error) { note("left: " + (error && error.message || error)); }
}
for (let round = 0; round < 3; round++) { run(); note("--"); }
console.log(said.join("\n"));
