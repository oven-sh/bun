type Entry = { alpha: number; beta: number; gamma: number; delta: string };
const turns = +process.argv[2]! || 30;
function entry(i: number): Entry {
  return { delta: "d" + (i & 3), gamma: i + 2, beta: i + 1, alpha: i };
}
function without(given: Entry) {
  const { alpha, ...others } = given;
  return { alpha, others };
}
function again(given: { beta: number; gamma: number; delta: string }) {
  return { ...given };
}
let sum = 0;
const out: string[] = [];
for (let turn = 0; turn < turns; turn++) {
  for (let i = 0; i < 40; i++) {
    const taken = without(entry(i + turn));
    const copy = again(taken.others);
    sum = (sum + taken.alpha + copy.beta + copy.gamma + copy.delta.length) | 0;
    if (turn < 2 && i < 3) out.push(Object.keys(taken.others).join() + "|" + Object.keys(copy).join() + "|" + JSON.stringify(copy));
  }
}
console.log(out.join("\n"));
console.log(sum);
