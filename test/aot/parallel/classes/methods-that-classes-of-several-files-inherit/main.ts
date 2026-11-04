import { Middle, Top } from "./above";
import { Beside } from "./beside";

class Low extends Middle {
  low = 2;
  sum() { return this.twice().low + this.again().middle + this.pair()[0].low + this.count; }
}
class Lower extends Low {
  lower = 3;
  again() { this.count += 10; return this; }
  more() { return this.twice().lower + this.sum() + this.take(this) + this.make()().lower; }
}
class Lowest extends Lower {
  named(name: string) { return super.named(name) + "!"; }
}
// Below the class at the top, behind classes that hid one of its methods.
class Late extends Top {
  late = 7;
  both() { return this.hidden() + this.again().late + this.named("n"); }
}

const taken: Array<(this: Top) => Top> = [Top.prototype.again, Lower.prototype.again];
function callEach(on: Top) {
  let total = 0;
  for (const method of taken) total += method.call(on).count;
  return total;
}

console.log(new Low().sum(), new Lower().more(), new Lowest().more(), new Lowest().named("x"));
console.log(new Late().both(), new Beside().all(), new Middle().hidden(), new Lowest().hidden());
console.log(callEach(new Top()), callEach(new Lowest()), callEach(new Late()), callEach(new Beside()));
console.log(new Lowest().twice() instanceof Lowest, new Low().make()() instanceof Low, new Late().pair()[1].late);
