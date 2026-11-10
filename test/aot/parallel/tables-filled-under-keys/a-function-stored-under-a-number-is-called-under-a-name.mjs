class Item { constructor(v) { this.v = v; } }
const held = new Item(1), keys = JSON.parse("[0, 1, 7]");
const table = { run(x) { return "own:" + x.v; } };
function lay(k, f) { table[+k] = f; }
lay(keys[0], x => { x.v = "changed by 0"; return 0; });
lay(keys[1], function (x) { this.mark = x; return 1; });
lay(keys[2], x => x);
const out = [table.run(held), table[0](held), held.v, table["1"](held), table.mark === held, table[7](held) === held, typeof table[2]];
held.v = 2; out.push(table[+keys[2]](held).v, Object.keys(table).join());
console.log(out.join(" "));
