// As quoted-where-a-line-reads-one-name-of-two-objects.js, where types stand in front of the read: the executable holds the text of a function without them, and an error knows its column in the file.
const thrown = (run: () => unknown): string => {
  try {
    run();
    return "nothing thrown";
  } catch (error) {
    return String(error);
  }
};
interface P { x: number }
const one: P = { x: 1 };
const none = undefined as any;

export class Vec2 { x: number; y: number; constructor(x: number, y: number) { this.x = x; this.y = y; } add(other: Vec2): Vec2 { return new Vec2(this.x + other.x, this.y + other.y); } }
export class V {
  x: number = 1;
  public add(o: P): number { return this.x + o.x; }
  static   sum<T extends P>(a: T, b: T): number { return a.x + b.x; }
  private readonly later = (a: P, b: P): number => a.x + b.x;
  static laterOf(v: V) { return v.later; }
}
export const arrow = (a: P, b: P): number => a.x + b.x;
export const named = function hello(a: P, b: P): number { return a.x + b.x; };
export function casts(a: unknown, b: unknown): number { return (a as P).x + (b as P).x; }
export function asserted(a?: P, b?: P): number { return a!.x + b!.x; }
export function variables(a: P, b: P): number { const first: number = a.x, second: number = b.x; return first + second; }
export function typesOverLines(
  a: {
    x: number;
  },
  b: P,
): number { return a.x + b.x; }
export function typesInside(a: P, b: P): number {
  type Q = {
    x: number;
  };
  interface R extends Q {
    y?: number;
  }
  const sum: number = (a as Q).x + (b as R).x;
  return sum;
}
export function generic<A extends P, B extends P = A>(a: A, b: B): [A["x"], B["x"]] { return [a.x, b.x] as [A["x"], B["x"]]; }
export function behindOtherLetters(a: "é𝒳" | P, b: P): string { return "𝒳" + (a as P).x + b.x; }

const add = V.prototype.add;
const addVec2 = Vec2.prototype.add;
const later = V.laterOf(new V());
for (let round = 0; round < 2; round++) {
  console.log(thrown(() => (addVec2 as any)(1, 2)));
  console.log(thrown(() => new Vec2(1, 2).add(none)));
  console.log(thrown(() => (add as any)(one)));
  console.log(thrown(() => new V().add(none)));
  const sums = [V.sum, later, arrow, named, casts, asserted, variables, typesOverLines, typesInside, generic, behindOtherLetters];
  for (const sum of sums as ((a: any, b: any) => unknown)[]) {
    console.log(thrown(() => sum(none, one)));
    console.log(thrown(() => sum(one, none)));
  }
}
