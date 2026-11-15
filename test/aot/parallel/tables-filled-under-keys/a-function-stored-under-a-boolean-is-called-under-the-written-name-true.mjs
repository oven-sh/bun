class Item { constructor(v) { this.v = v; } }
const flags = JSON.parse("[1, 0]"), held = new Item(1);
const table = {};
function lay(k, f) { table[!!k] = f; }
function read(x) { return x.v; }
lay(flags[0], x => { x.v = "changed"; return 1; });
lay(flags[1], x => 2);
const before = read(held);
const said = table.true(held) + table.false(held);
console.log(before, said, read(held), typeof read(held));
