// `makeCounter` and `makeClass` run no unknown code. Of what a landing ends they write a part: a getter on a literal and the members of a class may end guards on members and the state of a cell,
// and neither touches the link of an object to its prototype. So `holder` carries its proof of the link of `s` across the call as it is: behind the call it reads `s.tag` on the guard that it got in front,
// and only what the callee may have written is tested again.
// A landing for the sake of those tests begins with BecomeDirty, which ends the proof of the link too. The read behind the join then stands on a guard that does not hold on every way to it:
// GuardNotAvailable, in the verification that every build runs. And a callee like this need not throw, so the back end, which learns what a call with a landing has written from what it does
// before it throws, would take the tests in the landing for repeated ones.
// Build it without inlining too.
class Shape {
  id: number;
  declare tag?: string;
  declare note?: string;
  constructor(id: number) {
    this.id = id;
  }
}

function makeCounter(start: number, depth: number): { readonly value: number } {
  if (depth > 0) return makeCounter(start + 1, depth - 1);
  return {
    get value(): number {
      return start;
    },
  };
}

function makeClass(base: number, depth: number): number {
  if (depth > 0) return makeClass(base + 1, depth - 1);
  class Local {
    size(): number {
      return base;
    }
    static twice(n: number): number {
      return n * 2;
    }
  }
  return Local.twice(base);
}

function holder(s: Shape, n: number): string {
  const first = s.tag;
  const counter = makeCounter(n, 2);
  const second = s.tag;
  const doubled = makeClass(n, 2);
  const third = s.note;
  return first + " " + second + " " + third + " " + counter.value + " " + doubled + " " + s.id;
}

for (let round = 0; round < 300; round++) {
  const s = new Shape(round);
  if (round % 3 === 1) s.tag = "t" + round;
  if (round % 5 === 2) s.note = "n" + round;
  if (round === 250) (Shape.prototype as any).note = "inherited";
  const line = holder(s, round);
  if (round < 3 || round % 100 === 99 || round === 250 || round === 252) console.log(round + ": " + line);
}
