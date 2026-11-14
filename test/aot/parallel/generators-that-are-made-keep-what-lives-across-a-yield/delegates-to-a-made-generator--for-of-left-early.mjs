const said = []; function note(line) { said.push(String(line)); }
function show(value) { return typeof value === "bigint" ? value + "n" : typeof value === "object" && value ? JSON.stringify(value) : Object.is(value, -0) ? "-0" : String(value); }
function* inner(limit) { let got = ""; for (let i = 0; i < limit; i++) got += yield i; return got; } function* steps(limit) { const first = yield* inner(limit); yield "first " + first; const second = yield* inner(1); return first + "|" + second; }
function run() {
  const it = steps(2);
  globalThis.held = it;
  try { let seen = 0; for (const value of it) { note(show(value)); if (++seen === 3) break; } } catch (error) { note("left: " + (error && error.message || error)); }
}
for (let round = 0; round < 3; round++) { run(); note("--"); }
console.log(said.join("\n"));
