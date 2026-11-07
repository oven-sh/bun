const said = []; function note(line) { said.push(String(line)); }
function* steps(list) { let item; for (let i = 0; i < list.length; i++) { item = list[i]; yield item.name; yield item.size; } }
function run() { const it = steps(JSON.parse('[{"name":"a","size":1},{"name":"b","size":2}]')); globalThis.held = it; for (;;) { const step = it.next(); if (step.done) break; note(step.value); } }
for (let round = 0; round < 300; round++) run();
console.log(said.length, said.slice(0, 4).join(" "));
