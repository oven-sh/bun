// The head of the call holds the function in a word of the instance. The member is deleted, the collector runs, and the same site is asked again.
const said = [];
function ask(value) { try { return JSON.stringify(value); } catch (e) { return e.constructor.name; } }
said.push(ask("a"), ask("b"));
delete JSON.stringify;
for (let round = 0; round < 4; round++) {
  Bun.gc(true);
  const filler = [];
  for (let i = 0; i < 20000; i++) filler.push(() => i, { i });
  said.push(ask("c" + round), filler.length);
}
JSON.stringify = value => "laid " + value;
Bun.gc(true);
said.push(ask("d"));
console.log(said.join(" | "));
