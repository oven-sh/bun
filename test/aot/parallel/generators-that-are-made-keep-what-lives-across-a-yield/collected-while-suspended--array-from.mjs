const said = []; function note(line) { said.push(String(line)); }
function show(value) { return typeof value === "bigint" ? value + "n" : typeof value === "object" && value ? JSON.stringify(value) : Object.is(value, -0) ? "-0" : String(value); }
function* steps() { const made = { text: "made " + Math.sqrt(16) }; const list = [1.5, 2.5]; yield "a"; yield made.text; yield list[0] + list[1]; }
function run() {
  const it = steps();
  globalThis.held = it;
  try { note(Array.from(it, show).join(" ")); } catch (error) { note("left: " + (error && error.message || error)); }
}
for (let round = 0; round < 3; round++) { run(); note("--"); }
console.log(said.join("\n"));
