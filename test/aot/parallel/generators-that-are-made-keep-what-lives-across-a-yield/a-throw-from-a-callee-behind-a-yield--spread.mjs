const said = []; function note(line) { said.push(String(line)); }
function show(value) { return typeof value === "bigint" ? value + "n" : typeof value === "object" && value ? JSON.stringify(value) : Object.is(value, -0) ? "-0" : String(value); }
function fails(at) { throw new RangeError("at " + at); } function* steps(limit) { let seen = 0; try { for (let i = 0; i < limit; i++) { yield i; seen = i; if (i === 1) fails(i); } } catch (error) { yield error.message + " seen " + seen; } }
function run() {
  const it = steps(4);
  globalThis.held = it;
  try { note([...it].map(show).join(" ")); } catch (error) { note("left: " + (error && error.message || error)); }
}
for (let round = 0; round < 3; round++) { run(); note("--"); }
console.log(said.join("\n"));
