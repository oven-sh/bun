const said = []; function note(line) { said.push(String(line)); }
function show(value) { return typeof value === "bigint" ? value + "n" : typeof value === "object" && value ? JSON.stringify(value) : Object.is(value, -0) ? "-0" : String(value); }
function* steps(a, b, c, d, e, f) { const g = a + b, h = c * d, i = e - f, j = a + "x", k = [b], l = { c }; yield a; yield b + g; yield c + h; yield d + i; yield e + j; yield f + k[0] + l.c; yield [a, b, c, d, e, f, g, h, i, j, k[0], l.c].join(); }
function run() {
  const it = steps(1, 2, 3, 4, 5, 6);
  globalThis.held = it;
  try { const other = steps(1, 2, 3, 4, 5, 6); for (let turn = 0; turn < 12; turn++) { const a = it.next(), b = other.next(); note(show(a.value) + " " + show(b.value)); if (a.done && b.done) break; } } catch (error) { note("left: " + (error && error.message || error)); }
}
for (let round = 0; round < 3; round++) { run(); note("--"); }
console.log(said.join("\n"));
