interface Ruler { scaled(by: number): number }
class Short implements Ruler { constructor(readonly n: number) {} scaled(by: number) { return this.n * by; } }
class Long implements Ruler { constructor(readonly n: number) {} scaled(by: number) { return this.n * by + 1; } }
let asked = 0;
function next(): number { if (++asked === 20) Short.prototype.scaled = function () { return 1000; }; return 1; }
function sum(rulers: Ruler[], turns: number) {
  let total = 0;
  for (let turn = 0; turn < turns; turn++) total += rulers[turn & 3].scaled(next());
  return total;
}
const byValue = [sum];
const rulers = [new Short(2), new Long(3), new Short(4), new Long(5)];
console.log(byValue[0](rulers, 19), asked);
console.log(byValue[0](rulers, 1), asked);
console.log(byValue[0](rulers, 8), asked);
