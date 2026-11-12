const said = []; function note(line) { said.push(String(line)); }
function show(value) { return typeof value === "bigint" ? value + "n" : typeof value === "object" && value ? JSON.stringify(value) : Object.is(value, -0) ? "-0" : String(value); }
function* steps(text) { const word = /[a-z]+/g; let match; while ((match = word.exec(text))) yield match[0] + "@" + match.index; }
function run() {
  const it = steps("ab cd ef");
  globalThis.held = it;
  try { let seen = 0; for (const value of it) { note(show(value)); if (++seen === 3) break; } } catch (error) { note("left: " + (error && error.message || error)); }
}
for (let round = 0; round < 3; round++) { run(); note("--"); }
console.log(said.join("\n"));
