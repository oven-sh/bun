// A helper lays its own arguments in a list and binds by way of apply; what it gives is called in an arm of a turn.
const tie = Function.prototype.bind;
function lent(work) {
  const rest = [];
  for (let i = 1; i < arguments.length; i++) rest.push(arguments[i]);
  return tie.apply(work, rest);
}
function freight(crates, sacks, weight) { return crates.length * 2 + sacks.length + weight + (this ? this.tare : 0); }
const loads = JSON.parse("[4,12,3,8,15,1,9,6]");
function run(turns) {
  const carried = lent(freight, { tare: 5 }, "oak");
  let sum = 0;
  for (let i = 0; i < turns; i++) {
    if (loads[i & 7] > 7) sum += carried("rye", loads[i & 3]);
  }
  return sum;
}
console.log(run(1000), run(0), lent(freight, { tare: 1 }, "a", "bc")(7), lent(freight).name, lent(freight, null, "x").length);
