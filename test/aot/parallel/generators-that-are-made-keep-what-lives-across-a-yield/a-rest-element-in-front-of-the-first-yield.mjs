const said = []; function note(line) { said.push(String(line)); } const pool = JSON.parse('[{"add":10},{"add":20}]');
function* steps([first, ...others]) { const box = pool[first % 2]; yield others.length; yield first + box.add; }
function run(round) { const a = steps([round, 1, 2, 3]); globalThis.held = a; note(a.next().value); const b = steps([round, 4]); globalThis.other = b; note(b.next().value); note(a.next().value); note(b.next().value); }
for (let round = 0; round < 300; round++) run(round);
console.log(said.length, said.slice(0, 4).join(" "), said.slice(-4).join(" "));
