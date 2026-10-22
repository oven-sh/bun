// `holder` makes an object that nothing else refers to, reads it, lends it to `touch`, asks again in its own body and then passes it on to `read`, whose typed body takes the state of its parameter on trust.
// `touch` keeps nothing, so the object stays the holder's own. BecomeDirty at the head of a landing names no object, and whoever reasons object by object lets what is proven about an object
// that only this function can reach outlive a writer that is not handed the object (KillQuery::isConfined). The call kept the proof on its normal edge, so nothing ended it on the landing edge:
// the test behind the call went, the entry check of `read` folded with it, and both read the slots of a damaged object. KillQuery::mayEndProofAtLanding asks the call.
// `touch` calls itself so that it is not taken in. Build it without inlining too.
class Point {
  x: number;
  y: number;
  label?: string;
  constructor(x: number, y: number) {
    this.x = x;
    this.y = y;
  }
  sum(): number {
    return this.x + this.y;
  }
}

class Box {
  inner: Point;
  constructor(inner: Point) {
    this.inner = inner;
  }
}

const stranger = {
  sum(): number {
    return -1;
  },
};

let mode = 0;
function touch(p: Point, depth: number): number {
  if (depth > 0) return touch(p, depth - 1) + 1;
  if (mode === 1) (p as any).x = "text";
  else if (mode === 2) delete (p as any).y;
  else if (mode === 3) Object.defineProperty(p, "x", { get: () => 41, configurable: true });
  else if (mode === 4) Object.setPrototypeOf(p, stranger);
  else if (mode === 5) (p as any).y = undefined;
  else if (mode === 6) Object.defineProperty(p, "label", { get: () => "got", configurable: true });
  else if (mode === 7) Object.freeze(p);
  return mode;
}

function touchInner(b: Box, depth: number): number {
  if (depth > 0) return touchInner(b, depth - 1) + 1;
  return touch(b.inner, 0);
}

function read(p: Point): string {
  return p.x + "," + p.y + "," + p.label + "," + p.sum();
}

function holder(n: number): string {
  const p = new Point(n, 1);
  const before = p.x + p.y + p.sum() + "" + p.label;
  const got = touch(p, 2);
  return before + " " + got + " " + p.x + "," + p.y + "," + p.label + "," + p.sum() + " " + read(p);
}

function holderOfBox(n: number): string {
  const p = new Point(n, 2);
  const b = new Box(p);
  const before = p.x + p.y + p.sum() + "" + p.label;
  const got = touchInner(b, 2);
  return before + " " + got + " " + p.x + "," + p.y + "," + p.label + "," + p.sum() + " " + read(p);
}

function store(p: Point, n: number): string {
  try {
    p.x = n;
    return "stored";
  } catch {
    return "refused";
  }
}

function holderThatStores(n: number): string {
  const p = new Point(n, 3);
  p.x = n + 1;
  const got = touch(p, 2);
  const first = store(p, n + 2);
  return got + " " + first + " " + p.x;
}

for (let round = 0; round < 800; round++) {
  mode = round % 100 === 99 ? (round + 1) / 100 : 0;
  const line = holder(round) + " | " + holderOfBox(round) + " | " + holderThatStores(round);
  if (mode !== 0 || round === 0) console.log(round + ": " + line);
}
