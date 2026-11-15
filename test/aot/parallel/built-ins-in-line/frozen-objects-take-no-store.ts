class Point {
  x = 1;
  y = 2;
}
function freeze<T extends object>(value: T): T {
  return Object.freeze(value);
}
function tryStore(name: string, store: () => void, read: () => unknown) {
  try {
    store();
    console.log(name, "no throw", read());
  } catch (error) {
    console.log(name, (error as Error).constructor.name, read());
  }
}
const literal = freeze({ a: 1, b: { c: 2 } });
tryStore("a field of a literal", () => void ((literal as { a: number }).a = 5), () => literal.a);
tryStore("a field below", () => void (literal.b.c = 6), () => literal.b.c);
tryStore("a new name", () => void ((literal as Record<string, unknown>).d = 7), () => Object.keys(literal).join());
tryStore("a delete", () => void delete (literal as { a?: number }).a, () => literal.a);
const point = freeze(new Point());
tryStore("a field of an instance", () => void ((point as { x: number }).x = 5), () => point.x);
const list = freeze([1, 2, 3]);
tryStore("an element", () => void ((list as number[])[0] = 9), () => list.join());
tryStore("a push", () => void (list as number[]).push(4), () => list.join());
tryStore("the length", () => void ((list as number[]).length = 0), () => list.join());
console.log(Object.isFrozen(literal), Object.isFrozen(literal.b), Object.isFrozen(point), Object.isFrozen(list), Object.isFrozen(freeze(1 as unknown as object)));
console.log(freeze(literal) === literal, Object.getOwnPropertyDescriptor(point, "x"));
const accessors = freeze({
  held: 1,
  get twice() {
    return this.held * 2;
  },
  set twice(value: number) {
    console.log("the setter runs with", value);
  },
});
accessors.twice = 4;
console.log(accessors.twice);
