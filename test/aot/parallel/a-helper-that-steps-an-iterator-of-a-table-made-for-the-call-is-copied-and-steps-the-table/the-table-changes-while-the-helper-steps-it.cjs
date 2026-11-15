function listOf(steps, change) {
  const list = [];
  for (const step of steps) list.push(change ? change(step) : step);
  return list;
}
function run(turn) {
  const said = [];
  let table = new Map([["a", 1], ["b", 2], ["c", 3]]);
  said.push(listOf(table.keys(), key => { if (key === "a") table.delete("b"); return key; }).join());
  table = new Map([["a", 1], ["b", 2]]);
  said.push(listOf(table.keys(), key => { if (table.size < 5 + turn) table.set(key + key, 0); return key; }).join());
  table = new Map([["a", 1], ["b", 2], ["c", 3]]);
  said.push(listOf(table.values(), value => { if (value === 2) { table.clear(); table.set("z", 26); } return value; }).join());
  table = new Map([["a", 1], ["b", 2], ["c", 3]]);
  let laidAgain = 0;
  said.push(listOf(table.values(), value => { if (laidAgain++ < 4) { table.delete("a"); table.set("a", value + 10); } return value; }).join());
  table = new Map();
  for (let number = 0; number < 40; number++) table.set(number, number);
  said.push(listOf(table.keys(), key => { if (key % 2 === 0) for (let more = 0; more < 3; more++) table.delete(key + 1 + more * 7); if (key === 4) for (let more = 100; more < 140; more++) table.set(more, more); return key; }).join());
  const members = new Set([1, 2, 3]);
  said.push(listOf(members.values(), member => { if (member < 6) members.add(member + 3); members.delete(member); return member; }).join(), [...members].join());
  return said.join("\n");
}
globalThis.kept = listOf;
console.log(run(0));
console.log(run(1));
