// Static methods that count and recompute static fields in loops: the fields go round in registers. They move to the class object amid loops, are deleted, replaced, made accessors, and stored under other names first.
// STATISTIC: SlotsCarriedAroundLoops >= 2
class Ids {
  static next = 1;
  static make(): number {
    return ++Ids.next;
  }
}
class Random {
  static state = 7;
  static step(): number {
    return (Random.state = (Random.state * 5 + 1) & 1023);
  }
}
class Moved {
  static count: any = 0;
  static add(by: number): any {
    Moved.count += by;
    return Moved.count;
  }
}
class Named {
  static total: any = 0;
  static add(by: number): any {
    return (Named.total = Named.total + by);
  }
}
class Heir extends Ids {
  static own = 0;
  static both(): number {
    Heir.own += 2;
    return Heir.make() + Heir.own;
  }
}
function ids(turns: number): number {
  let sum = 0;
  for (let k = 0; k < turns; k++) sum += Ids.make();
  return sum;
}
function steps(turns: number): number {
  let sum = 0;
  for (let k = 0; k < turns; k++) sum = (sum ^ Random.step()) + k;
  return sum;
}
function heirs(turns: number): number {
  let sum = 0;
  for (let k = 0; k < turns; k++) sum += Heir.both();
  return sum;
}
function moved(turns: number, at: number, how: number): string {
  let seen = "";
  for (let k = 0; k < turns; k++) {
    if (k === at) {
      if (how === 0) seen += Object.keys(Moved).join();
      else if (how === 1) delete Moved.count;
      else if (how === 2) Object.defineProperty(Moved, "count", { get: () => 100, set: value => void (seen += "set" + value), configurable: true });
      else if (how === 3) Moved.count = "text";
      else if (how === 4) (Moved as any).other = 1;
      else if (how === 5) Moved.add = (by: number) => -by;
      else if (how === 6) Object.freeze(Moved);
    }
    try {
      seen += Moved.add(k) + ",";
    } catch (error) {
      seen += (error as Error).name + ",";
    }
  }
  return seen;
}
function named(turns: number): number {
  let sum = 0;
  for (let k = 0; k < turns; k++) sum += Named.add(k);
  return sum;
}
Object.defineProperty(Named, "name", { value: "renamed", configurable: true });
(Named as any).first = 1;
for (let round = 0; round < 3; round++) {
  console.log(ids(10), Ids.next, steps(10), Random.state, heirs(5), Heir.own, Heir.next);
  console.log(named(6), Named.total, Named.name, Object.keys(Named).join());
}
for (let how = 0; how < 7; how++) {
  console.log(moved(5, 2, how), how === 2 ? "" : String(Moved.count));
  if (how === 2) Object.defineProperty(Moved, "count", { value: 3, writable: true, configurable: true, enumerable: true });
}
