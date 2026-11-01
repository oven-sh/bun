// Stores under a private name on objects that a built-in constructor makes, often enough that the location is remembered: two evaluations of one class, objects of several shapes, a frozen object, an object that lacks the name.
function declare(tag: string) {
  return class Failure extends Error {
    #count = 0;
    #label = tag;
    static bump(failure: Failure, by: number) {
      failure.#count = failure.#count + by;
      failure.#label = tag + failure.#count;
      return failure.#label;
    }
  };
}
const First = declare("first");
const Second = declare("second");
const one = new First("one");
const other = new Second("other");
let last = "";
for (let turn = 0; turn < 50; turn++) last = First.bump(one, 1) + " " + Second.bump(other, 2);
console.log(last);
for (const [name, bump, failure] of [["first on second", First.bump, other], ["second on first", Second.bump, one], ["first on a plain error", First.bump, new Error("plain")]] as const) {
  try {
    console.log(name, (bump as (failure: unknown, by: number) => string)(failure, 1));
  } catch (error) {
    console.log(name, "throws", (error as Error).constructor.name);
  }
}
const shapes = [new First("a"), Object.assign(new First("b"), { extra: 1 }), Object.assign(new First("c"), { other: 1, more: 2 }), Object.freeze(new First("d")) as InstanceType<typeof First>];
for (let turn = 0; turn < 20; turn++) for (const failure of shapes) last = First.bump(failure, turn);
console.log(shapes.map(failure => First.bump(failure, 0)).join(" "));

class Stamped extends (function (this: unknown, target: object) { return target; } as unknown as new (target: object) => object) {
  #stamp = 1;
  static raise(target: object) { return ++(target as Stamped).#stamp; }
}
const targets = [{}, [], new Map(), () => 0];
for (const target of targets) new Stamped(target);
for (let turn = 0; turn < 20; turn++) for (const target of targets) Stamped.raise(target);
console.log(targets.map(target => Stamped.raise(target)).join(" "));

class Keyed extends Map<string, number> {
  #held: object | null = null;
  hold(value: object) { this.#held = value; return this; }
  get held() { return this.#held; }
}
const keyed = new Keyed();
for (let turn = 0; turn < 2000; turn++) keyed.hold({ turn });
Bun.gc(true);
console.log(JSON.stringify(keyed.held));
