// What is stepped by hand comes out of a function that answers two kinds of iterators; nested loops hand its results round.
function* generated(count: any): any {
  for (let k = 0; k < count; k++) yield k * 2;
}
class Walker {
  i: number = 0;
  end: any;
  constructor(end: any) {
    this.end = end;
  }
  next(): any {
    const i = this.i++;
    return i < this.end ? { done: false, value: i } : { done: true, value: undefined };
  }
}
let saved: any = null;
const kept: any = [];
function stepper(from: any): any {
  return typeof from?.next === "function" ? from : from[Symbol.iterator]();
}
function nested(from: any): any {
  let total: any = 0;
  let turns = 0;
  const steps: any = stepper(from);
  let r: any = steps.next();
  while (!r.done && turns++ < 30) {
    const begun: any = r.value;
    let same = 0;
    while (!r.done && turns++ < 30) {
      if (saved === r) total += 5;
      same += r.value;
      r = steps.next();
      if (same % 3 === 1) break;
    }
    total += same + begun;
  }
  return total + ":" + turns;
}
function nestedAndKept(from: any): any {
  let total: any = 0;
  let turns = 0;
  const steps: any = stepper(from);
  let r: any = steps.next();
  outer: while (!r.done) {
    while (!r.done && turns++ < 40) {
      if (kept[0] === r) total += 100;
      if (r.value === 4) kept[0] = r;
      if (r.value === 6) {
        r = steps.next();
        continue outer;
      }
      total += r.value;
      r = steps.next();
    }
    if (turns > 40) break;
  }
  return total + ":" + turns + ":" + kept.length;
}
for (let turn = 0; turn < 40; turn++) {
  const results = [
    nested(new Walker(9)),
    nested(generated(9)),
    nested([3, 4, 5, 6]),
    nested(new Set([1, 2, 3])),
    nested("12"),
    nestedAndKept(new Walker(9)),
    nestedAndKept(generated(9)),
    nestedAndKept([3, 4, 5, 6, 7]),
    nestedAndKept(new Map([[1, 2]]).values()),
  ];
  if (turn === 39) console.log(results.join("\n"));
}
