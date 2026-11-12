function listOf(steps, change) {
  const list = [];
  for (const step of steps) list.push(change ? change(step) : step);
  return list;
}
const same = value => value;
function run(turn) {
  const said = [];
  let table = new Map([["a", 1], ["b", 2]]);
  said.push(listOf(table.values(), (table.clear(), same)).join() + ".");
  table = new Map([["a", 1], ["b", 2]]);
  said.push(listOf(table.values(), (table.set("c", 3 + turn), same)).join());
  table = new Map([["a", 1], ["b", 2]]);
  said.push(listOf(table.keys(), (table.delete("a"), table.set("a", 9), same)).join());
  table = new Map([["a", 1], ["b", 2]]);
  said.push(listOf(table.keys(), (table.clear(), table.set("n", turn), same)).join());
  table = new Map();
  said.push(listOf(table.entries(), (table.set(1, 2), pair => pair.join("-"))).join());
  let other = new Map([["o", 0]]);
  table = new Map([["t", 1]]);
  const first = table;
  said.push(listOf(table.keys(), (table = other, same)).join(), first.size, table.size);
  return said.join("\n");
}
globalThis.kept = listOf;
console.log(run(0));
console.log(run(5));
