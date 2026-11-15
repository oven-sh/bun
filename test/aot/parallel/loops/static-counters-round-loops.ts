// A static field that a loop counts goes round the loop in a register, and memory holds it as well.
// STATISTIC: SlotsCarriedAroundLoops >= 4
class Counted {
  static made = 0;
  static other = 10;
  readonly id = ++Counted.made;
}
function make(turns: number): number {
  let sum = 0;
  for (let turn = 0; turn < turns; turn++) sum += new Counted().id & 1;
  return sum;
}
class Stepped {
  static hits = 0;
  static last = 0;
}
function step(turns: number, skips: number): number {
  for (let turn = 0; turn < turns; turn++) {
    Stepped.hits += 2;
    if (turn % 5 === skips) Stepped.last = Stepped.hits;
  }
  return Stepped.hits + Stepped.last;
}
class Fill {
  static next = 2147483640;
  readonly id: number;
  constructor() {
    this.id = Fill.next++;
  }
}
function fill(turns: number): number[] {
  const found: number[] = [];
  for (let turn = 0; turn < turns; turn++) {
    const one = new Fill();
    found[turn & 3] = one.id;
  }
  return found;
}
class Moved {
  static count = 0;
}
function move(turns: number, at: number): string {
  let seen = "";
  for (let turn = 0; turn < turns; turn++) {
    Moved.count++;
    if (turn === at) {
      seen += JSON.stringify({ ...Moved });
      Object.defineProperty(Moved, "count", { value: 40, writable: true, configurable: true, enumerable: false });
    }
  }
  return seen + Moved.count + Object.keys(Moved).join();
}
class Thrown {
  static count = 0;
}
function thrown(turns: number, at: number): number {
  try {
    for (let turn = 0; turn < turns; turn++) {
      Thrown.count++;
      if (turn === at) throw new RangeError("at");
    }
  } catch {
    return Thrown.count * 100;
  }
  return Thrown.count;
}
for (let round = 0; round < 3; round++) {
  console.log(make(100 + round), Counted.made, Counted.other);
  console.log(step(50, round), Stepped.hits, Stepped.last);
  console.log(fill(9).join(), Fill.next);
  console.log(move(20, round * 9), thrown(30, round * 20), Thrown.count);
}
