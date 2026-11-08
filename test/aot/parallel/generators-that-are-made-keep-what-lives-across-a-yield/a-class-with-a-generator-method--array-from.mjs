const said = []; function note(line) { said.push(String(line)); }
function show(value) { return typeof value === "bigint" ? value + "n" : typeof value === "object" && value ? JSON.stringify(value) : Object.is(value, -0) ? "-0" : String(value); }
class Shelf { #items = ["x", "y"]; extra = "z"; *[Symbol.iterator]() { for (const item of this.#items) yield item; yield this.extra; } } const shelf = new Shelf();
function run() {
  const it = shelf[Symbol.iterator]();
  globalThis.held = it;
  try { note(Array.from(it, show).join(" ")); } catch (error) { note("left: " + (error && error.message || error)); }
}
for (let round = 0; round < 3; round++) { run(); note("--"); }
console.log(said.join("\n"));
