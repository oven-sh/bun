const said = []; function note(line) { said.push(String(line)); }
const source = { [Symbol.iterator]() { let i = 0; return { next() { return { done: i >= 3, value: i++ }; }, return() { note("closed"); return {}; } }; } };
function* steps(list, seed) { let label = "none"; try { label = "made:" + seed; for (const item of list) yield item; label = "done"; } catch (error) { yield label + ":" + error; } yield label; }
function run(seed) { const it = steps(source, seed); globalThis.held = it; note(it.next().value); note(it.next().value); note(it.throw("thrown").value); note(it.next().value); note(it.next().done); }
for (let round = 0; round < 3; round++) { run(round); note("--"); }
console.log(said.join("\n"));
