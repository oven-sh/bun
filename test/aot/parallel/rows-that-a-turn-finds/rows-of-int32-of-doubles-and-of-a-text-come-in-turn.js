// STATISTIC: ListsAskedInTurnsOfTypedCopies >= 1
const steps = JSON.parse(`["run"]`),
  ops = { run };
let turns = 0;
function call(d) {
  try {
    return ops[steps[0]](d);
  } catch (e) {
    return e.name;
  }
}
function show(d) {
  return d.map(r => (Array.isArray(r) && r !== d ? r.join("/") : typeof r)).join("|");
}
function run(d) {
  let sum = 0;
  for (let i = 0; i < d.length; i++) {
    const p = d[i][0] * d[i][1];
    sum += p === p ? p : 100;
    turns++;
  }
  return sum;
}
const d = [
  [1, 2],
  [1.5, 2],
  ["3", 2],
  [2, 2],
];
console.log("SAID " + call(d) + " " + turns + " " + show(d));
