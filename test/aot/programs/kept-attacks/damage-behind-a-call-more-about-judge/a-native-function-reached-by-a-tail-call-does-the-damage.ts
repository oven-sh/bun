// `apply` ends in `return fn(target)`: a tail call by value, a jump. Its frame is gone when the callee runs, and the callee returns straight to the return address in `holder`.
// The callee is native: a bound Object.setPrototypeOf, a bound Object.defineProperty, a bound Reflect.deleteProperty. No operation of compiled code stands behind the jump that could say anything
// about what the native function did, and between the writer and `holder` there are only frames of the engine and of a stub.
// The word on the stack that has to be swapped is the one that `apply` was called with. The judge compares at that return address: whatever is counted below has to have sent it to the landing.
class Point {
  x: number;
  y: number;
  constructor(x: number, y: number) {
    this.x = x;
    this.y = y;
  }
  sum(): number {
    return this.x + this.y;
  }
}
const stranger = {
  sum(): number {
    return -100;
  },
};

type Damage = (target: Point) => unknown;
const nothing: Damage = (target) => target;
function damageFor(target: Point, kind: number): Damage {
  if (kind === 1) return Object.setPrototypeOf.bind(null, target, stranger) as Damage;
  if (kind === 2) return Object.defineProperty.bind(null, target, "x", { get: () => 1000, configurable: true }) as Damage;
  if (kind === 3) return Reflect.deleteProperty.bind(null, target, "y") as Damage;
  return nothing;
}

let calls = 0;
function apply(fn: Damage, target: Point): unknown {
  calls++;
  return fn(target);
}
function applyTwice(fn: Damage, target: Point): unknown {
  apply(nothing, target);
  return apply(fn, target);
}

function holder(p: Point, fn: Damage): string {
  const before = p.x + "," + p.y + "," + p.sum();
  applyTwice(fn, p);
  return before + " " + p.x + "," + p.y + "," + p.sum();
}

let digest = 0;
for (let round = 0; round < 600; round++) {
  const p = new Point(round, round + 1);
  const kind = round % 40 === 39 ? 1 + ((round / 40) | 0) % 3 : 0;
  const line = holder(p, damageFor(p, kind));
  for (let index = 0; index < line.length; index++) digest = (digest * 31 + line.charCodeAt(index)) | 0;
  if (kind || round < 2) console.log(round + ": " + line);
}
console.log("calls " + calls + " digest " + digest);
