const said = []; function note(line) { said.push(String(line)); }
function show(value) { return typeof value === "bigint" ? value + "n" : typeof value === "object" && value ? JSON.stringify(value) : Object.is(value, -0) ? "-0" : String(value); }
function* steps(base) { yield base + 0; yield base + 1; yield base + 2; yield base + 3; yield base + 4; yield base + 5; yield base + 6; yield base + 7; yield base + 8; yield base + 9; yield base + 10; yield base + 11; yield base + 12; yield base + 13; yield base + 14; yield base + 15; yield base + 16; yield base + 17; yield base + 18; yield base + 19; yield base + 20; yield base + 21; yield base + 22; yield base + 23; yield base + 24; yield base + 25; yield base + 26; yield base + 27; yield base + 28; yield base + 29; yield base + 30; yield base + 31; yield base + 32; yield base + 33; yield base + 34; yield base + 35; yield base + 36; yield base + 37; yield base + 38; yield base + 39; }
function run() {
  const it = steps(100);
  globalThis.held = it;
  try { note(it.map(show).take(4).toArray().join(" ")); } catch (error) { note("left: " + (error && error.message || error)); }
}
for (let round = 0; round < 3; round++) { run(); note("--"); }
console.log(said.join("\n"));
