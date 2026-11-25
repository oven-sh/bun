function listOf(steps) {
  const list = [];
  for (const step of steps) list.push(step);
  return list;
}
function firstOf(steps) {
  for (const step of steps) return step;
  return "none";
}
function twice(steps) {
  const list = [];
  for (let round = 0; round < 2; round++) for (const step of steps) list.push(round + ":" + step);
  return list;
}
function both(left, right) {
  const list = [];
  for (const step of left) { list.push(step); const other = right.next(); list.push(other.done ? "done" : other.value); }
  return list;
}
function keeps(steps) {
  globalThis.held = steps;
  const list = [];
  for (const step of steps) { list.push(step); if (list.length === 1) list.push("held " + globalThis.held.next().value); }
  return list;
}
function byArguments(steps) {
  const list = [];
  for (const step of steps) { list.push(step); if (list.length === 1) list.push("by arguments " + arguments[0].next().value); }
  return list;
}
function run() {
  const said = [];
  const table = new Map([["a", 1], ["b", 2], ["c", 3], ["d", 4]]);
  const again = table.values();
  said.push(firstOf(again), firstOf(again), listOf(again).join(), listOf(again).join() + ".");
  const outside = table.keys();
  for (let turn = 0; turn < 3; turn++) said.push(firstOf(outside));
  said.push(twice(table.values()).join());
  const shared = table.values();
  said.push(both(shared, shared).join());
  said.push(keeps(table.values()).join(), globalThis.held.next().value);
  said.push(byArguments(table.values()).join());
  let chosen;
  said.push(listOf(chosen = table.keys()).join(), chosen.next().done);
  said.push(listOf(said.length > 100 ? table.keys() : table.values()).join());
  return said.join("\n");
}
globalThis.kept = [listOf, firstOf, twice, both, keeps, byArguments];
console.log(run());
console.log(run());
