function sum(this: { base: number } | undefined, a = 0, b = 0, c = 0) {
  return (this ? this.base : -1) + a + b + c + arguments.length * 1000;
}
class Pair {
  constructor(public left?: number, public right?: number) {}
}
class Named extends Pair {}
function applyTo(list: number[]) {
  return sum.apply({ base: 10 }, list as [number, number, number]);
}
for (const list of [[], [1], [1, 2], [1, 2, 3], [1, 2, 3, 4], [, 2] as number[]]) console.log(list.length, applyTo(list));
console.log(sum.apply(undefined, [1, 2, 3]), sum.apply({ base: 1 }), sum.apply({ base: 1 }, null as never), sum.apply({ base: 1 }, undefined));
console.log(sum.apply({ base: 1 }, { length: 2, 0: 5, 1: 6 } as never));
console.log(Reflect.apply(sum, { base: 100 }, [1, 2]), Reflect.apply(sum, undefined, []));
for (const bad of [1, "ab", true]) {
  try {
    console.log(sum.apply({ base: 1 }, bad as never));
  } catch (error) {
    console.log((error as Error).constructor.name);
  }
  try {
    console.log(Reflect.apply(sum, { base: 1 }, bad as never));
  } catch (error) {
    console.log((error as Error).constructor.name);
  }
}
const made = Reflect.construct(Pair, [1, 2]);
console.log(made instanceof Pair, made.left, made.right);
const below = Reflect.construct(Pair, [3], Named);
console.log(below instanceof Named, below.left, below.right, Object.getPrototypeOf(below) === Named.prototype);
try {
  Reflect.construct(Pair, [1], (() => {}) as never);
} catch (error) {
  console.log((error as Error).constructor.name);
}
function many(...values: number[]) {
  return values.length + ":" + values[values.length - 1];
}
console.log(many.apply(null, Array.from({ length: 5000 }, (_, at) => at)));
