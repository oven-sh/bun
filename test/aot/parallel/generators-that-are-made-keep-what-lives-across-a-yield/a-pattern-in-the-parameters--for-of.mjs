const said = []; function note(line) { said.push(String(line)); }
function show(value) { return typeof value === "bigint" ? value + "n" : typeof value === "object" && value ? JSON.stringify(value) : Object.is(value, -0) ? "-0" : String(value); }
function* steps({ from, to }, [step]) { for (let i = from; i < to; i += step) yield i; }
function run() {
  const it = steps({ from: 1, to: 8 }, [3]);
  globalThis.held = it;
  try { for (const value of it) note(show(value)); } catch (error) { note("left: " + (error && error.message || error)); }
}
for (let round = 0; round < 3; round++) { run(); note("--"); }
console.log(said.join("\n"));
