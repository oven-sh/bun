// Flags: --aot-harden=proof-checks
// Integers are summed across calls, also in the code of a function whose guards have failed.
function use(object, times, tell) {
  let total = 0;
  for (let k = 0; k < times; k++) {
    tell(k);
    if (object.run) total += 1;
    else total += 100;
    tell(total);
    if (object.kind) total += 1;
    else total += 100;
    tell(object);
  }
  return total;
}
class Kind {
  constructor() {
    this.run = 1;
    this.kind = "";
  }
}
let seen = 0;
const tellers = [() => seen++, () => void (seen += 2)];
console.log(use(new Kind(), 3, tellers[0]), seen);
console.log(use({ run: 0, kind: "k" }, 2, tellers[1]), seen);
console.log(use(Kind, "2", tellers[0]), seen);
function area(box) {
  let sum = 0;
  for (let i = 0; i < box.height; i += 2) sum = (sum + box.width * box.height + i) | 0;
  return sum;
}
console.log(area({ width: 3, height: 4 }), area(JSON.parse('{"cached":"","width":5,"height":6}')));
console.log(area({ width: 2 ** 40, height: 9 }), area({ get height() { return 5; }, width: "3" }));
