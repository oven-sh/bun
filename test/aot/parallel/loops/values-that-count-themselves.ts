// Constructors that count what they make, in chains of methods: each count goes round the loop in a register, and what leaves the loop undoes it.
// STATISTIC: SlotsCarriedAroundLoops >= 2
class Vector {
  static made = 0;
  static last = 0;
  constructor(
    readonly x: number,
    readonly y: number,
  ) {
    Vector.made++;
  }
  add(other: Vector): Vector {
    return new Vector(this.x + other.x, this.y + other.y);
  }
  scale(by: number): Vector {
    return new Vector(this.x * by, this.y * by);
  }
}
const unit = new Vector(1, 2);
function chain(turns: number): number {
  let sum = 0;
  for (let turn = 0; turn < turns; turn++) sum += new Vector(turn & 7, 1).add(unit).scale(2).x;
  return sum;
}
class Bent {
  static made = 0;
  static last = 0;
  constructor(
    readonly x: number,
    readonly y: number,
  ) {
    Bent.made++;
  }
  add(other: Bent): Bent {
    return new Bent(this.x + other.x, this.y + other.y);
  }
  scale(by: number): Bent {
    return new Bent(this.x * by, this.y * by);
  }
}
const straight = new Bent(1, 2);
function replaced(turns: number, at: number): number {
  let sum = 0;
  for (let turn = 0; turn < turns; turn++) {
    if (turn === at)
      Bent.prototype.add = function (this: Bent, other: Bent): Bent {
        Bent.made += 100;
        return other;
      };
    sum += new Bent(turn, 1).add(straight).y;
  }
  return sum;
}
class Base {
  static made = 2147483640;
  readonly id: number;
  constructor() {
    this.id = ++Base.made;
  }
}
class Heir extends Base {
  static own = 0;
  constructor(readonly value: number) {
    super();
    Heir.own++;
  }
}
function heirs(turns: number): number {
  let sum = 0;
  for (let turn = 0; turn < turns; turn++) sum += new Heir(turn).id % 7;
  return sum;
}
function through(turns: number, at: number): string {
  let seen = "";
  for (let turn = 0; turn < turns; turn++) {
    const one = straight.scale(turn);
    if (turn === at) {
      Object.setPrototypeOf(one, Bent);
      seen += (one as unknown as typeof Bent).made;
      Object.defineProperty(Bent, "made", { get: () => 7, set: value => void (seen += "/" + value), configurable: true });
    }
  }
  return seen + Bent.made;
}
let total = 0;
for (let turn = 0; turn < 40; turn++) total += new Vector(turn, turn).scale(0.5).add(unit).y;
console.log(total, Vector.made);
for (let round = 0; round < 2; round++) console.log(chain(50), Vector.made, heirs(9), Base.made, Heir.own);
console.log(replaced(20, 9), Bent.made, through(12, 5), through(3, 9));
