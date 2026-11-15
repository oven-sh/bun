interface Ruler { scaled(): number }
class Short implements Ruler { constructor(readonly n: number) {} scaled() { return this.n; } }
class Long implements Ruler { constructor(readonly n: number) {} scaled() { return this.n + 100; } }
const rulers: Ruler[] = [new Short(2), new Long(3)];
function turns(which: number) {
  let sum = 0;
  for (let turn = 0; turn < 40; turn++) {
    sum += rulers[turn & 1].scaled();
    if (turn === which) Short.prototype.scaled = function () { return 1000; };
  }
  return sum;
}
function oneReceiver(place: number, which: number) {
  const ruler = rulers[place];
  let sum = 0;
  for (let turn = 0; turn < 40; turn++) {
    sum += ruler.scaled();
    if (turn === which) Long.prototype.scaled = function () { return 5000; };
  }
  return sum;
}
console.log(turns(-1), turns(20), turns(-1));
console.log(oneReceiver(1, -1), oneReceiver(1, 20), oneReceiver(1, -1), oneReceiver(0, -1));
