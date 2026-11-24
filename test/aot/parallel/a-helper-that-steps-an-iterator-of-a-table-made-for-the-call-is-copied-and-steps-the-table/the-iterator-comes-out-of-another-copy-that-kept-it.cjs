function listOf(steps) {
  const list = [];
  for (const step of steps) list.push(step);
  return list;
}
let kept;
function makes(table) { const steps = table.values(); kept = steps; return steps; }
function same(value) { return value; }
class Counted extends Map {
  values() { const steps = super.values(); kept = steps; return steps; }
}
const holder = { table: null, steps: null, give() { return this.steps; }, made() { const steps = this.table.keys(); this.steps = steps; return steps; } };
function run(first) {
  const said = [];
  const table = new Map([["a", first], ["b", 2], ["c", 3]]);
  said.push(listOf(makes(table)).join(), kept.next().done);
  const named = table.values();
  kept = named;
  said.push(listOf(same(named)).join(), kept.next().done);
  const counted = new Counted([["x", first], ["y", 9]]);
  said.push(listOf(counted.values()).join(), kept.next().done);
  holder.table = table;
  said.push(listOf(holder.made()).join(), holder.steps.next().done);
  holder.steps = table.keys();
  said.push(listOf(holder.give()).join(), holder.steps.next().done);
  const local = { steps: table.values(), give() { return this.steps; } };
  said.push(listOf(local.give()).join(), local.steps.next().done);
  return said.join(" ");
}
globalThis.held = [listOf, makes, same];
console.log(run(1));
console.log(run(7));
