// The language's order: a store to undefined or null throws before its key is converted. Plain Bun converts first, so these hold to their last comment.
// A receiver that its type says is an object and that is undefined or null all the same, or that says it may be either.
let order: string[] = [];
const convertible = {
  toString(): string {
    order.push("key converted");
    return "0";
  },
};
function key(): any {
  order.push("key evaluated");
  return convertible;
}
function value(): number {
  order.push("value evaluated");
  return 1;
}
function report(label: string, run: () => unknown): void {
  order = [];
  try {
    order.push(`answer ${String(run())}`);
  } catch (error) {
    order.push((error as Error).name);
  }
  console.log(label, order.join());
}
type Row = Record<string, number>;
function store(target: Row, k: any): number {
  return (target[k] = value());
}
function read(target: Row, k: any): number {
  return target[k];
}
function remove(target: Row, k: any): boolean {
  return delete target[k];
}
function plus(target: Row, k: any): number {
  return (target[k] += value());
}
function maybeStore(target: Row | undefined, k: any): number {
  return (target![k] = value());
}
function nullable(target: Row | null, k: string): number {
  return target![k];
}
function list(target: number[], k: any): number {
  return (target[k] = value());
}
const real: Row = { a: 1 };
for (let i = 0; i < 40; i++) {
  store(real, "a");
  read(real, "a");
  plus(real, "a");
  remove({ a: 1 }, "a");
  maybeStore(real, "a");
  nullable(real, "a");
  list([1, 2], 0);
}
const nothing = undefined as unknown as Row;
const nullValue = null as unknown as Row;
for (const [name, target] of [
  ["undefined", nothing],
  ["null", nullValue],
] as const) {
  report(`${name} store`, () => store(target, key()));
  report(`${name} read`, () => read(target, key()));
  report(`${name} delete`, () => remove(target, key()));
  report(`${name} plus`, () => plus(target, key()));
  report(`${name} maybe`, () => maybeStore(target, key()));
  report(`${name} nullable`, () => nullable(target, key()));
  report(`${name} list`, () => list(target as unknown as number[], key()));
}
report("a real one", () => store(real, key()));

/* Output:
undefined store key evaluated,value evaluated,TypeError
undefined read key evaluated,TypeError
undefined delete key evaluated,TypeError
undefined plus key evaluated,TypeError
undefined maybe key evaluated,value evaluated,TypeError
undefined nullable key evaluated,TypeError
undefined list key evaluated,value evaluated,TypeError
null store key evaluated,value evaluated,TypeError
null read key evaluated,TypeError
null delete key evaluated,TypeError
null plus key evaluated,TypeError
null maybe key evaluated,value evaluated,TypeError
null nullable key evaluated,TypeError
null list key evaluated,value evaluated,TypeError
a real one key evaluated,value evaluated,key converted,answer 1
*/
