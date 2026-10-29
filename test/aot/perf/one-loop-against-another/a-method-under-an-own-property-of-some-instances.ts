// `target.add(..)` on instances of a class whose constructor stores an own `add` on one road, beside the same call on a class that never does.
// An instance without the own property calls the method of its class. The loops "handed in" are called by a function that is found under a computed name.
class Plain {
  heard = 0;
  constructor(loud: boolean) {
    if (loud) this.heard = 1;
  }
  add(step: number): number {
    this.heard = (this.heard + step) | 0;
    return this.heard & 1;
  }
}
function addTwice(this: Hidden, step: number): number {
  this.heard = (this.heard + step + step) | 0;
  return this.heard & 1;
}
class Hidden {
  heard = 0;
  constructor(loud: boolean) {
    if (loud) this.add = addTwice;
  }
  add(step: number): number {
    this.heard = (this.heard + step) | 0;
    return this.heard & 1;
  }
}
class PlainGuest {
  heard = 0;
  constructor(loud: boolean) {
    if (loud) this.heard = 1;
  }
  add(step: number): number {
    this.heard = (this.heard + step) | 0;
    return this.heard & 1;
  }
}
function addThrice(this: HiddenGuest, step: number): number {
  this.heard = (this.heard + step * 3) | 0;
  return this.heard & 1;
}
class HiddenGuest {
  heard = 0;
  constructor(loud: boolean) {
    if (loud) this.add = addThrice;
  }
  add(step: number): number {
    this.heard = (this.heard + step) | 0;
    return this.heard & 1;
  }
}
function overPlain(target: Plain, rounds: number): number {
  let sum = 0;
  for (let round = 0; round < rounds; round++) sum = (sum + target.add(round)) | 0;
  return sum;
}
function overHidden(target: Hidden, rounds: number): number {
  let sum = 0;
  for (let round = 0; round < rounds; round++) sum = (sum + target.add(round)) | 0;
  return sum;
}
function overPlainGuest(target: PlainGuest, rounds: number): number {
  let sum = 0;
  for (let round = 0; round < rounds; round++) sum = (sum + target.add(round)) | 0;
  return sum;
}
function overHiddenGuest(target: HiddenGuest, rounds: number): number {
  let sum = 0;
  for (let round = 0; round < rounds; round++) sum = (sum + target.add(round)) | 0;
  return sum;
}
const [loop = "", turns = "5000"] = process.argv.slice(2);
const isLoud = process.argv.length > 9;
const apply = (globalThis as any)[["Ref", "lect"].join("")].apply as (
  callee: Function,
  receiver: unknown,
  list: unknown[],
) => number;
console.log(
  overPlain(new Plain(isLoud), 5000),
  overHidden(new Hidden(isLoud), 5000),
  overHidden(new Hidden(!isLoud), 5000),
);
console.log(
  apply(overPlainGuest, undefined, [new PlainGuest(isLoud), 5000]),
  apply(overHiddenGuest, undefined, [new HiddenGuest(isLoud), 5000]),
  apply(overHiddenGuest, undefined, [new HiddenGuest(!isLoud), 5000]),
);
const rounds = Number(turns);
if (loop === "a class that never stores") console.log(overPlain(new Plain(isLoud), rounds));
if (loop === "an instance without the own property") console.log(overHidden(new Hidden(isLoud), rounds));
if (loop === "an instance with the own property") console.log(overHidden(new Hidden(!isLoud), rounds));
if (loop === "a class that never stores, handed in")
  console.log(apply(overPlainGuest, undefined, [new PlainGuest(isLoud), rounds]));
if (loop === "an instance without the own property, handed in")
  console.log(apply(overHiddenGuest, undefined, [new HiddenGuest(isLoud), rounds]));
export {};
