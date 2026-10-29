// Env of the executable: BUN_JSC_crashIfInterpreterIsUsed=1
function show(value: unknown): string {
  if (typeof value === "function") return "function " + value.name;
  if (typeof value === "object" && value !== null)
    return Array.isArray(value) ? "[" + value.join() + "]" : Object.prototype.toString.call(value);
  return typeof value + " " + (Object.is(value, -0) ? "-0" : String(value));
}
function attempt(label: string, action: () => unknown): void {
  let outcome: string;
  try {
    outcome = show(action());
  } catch (error) {
    outcome = (error as Error).name;
  }
  console.log(label + ": " + outcome);
}
function nameOfError(action: () => unknown): unknown {
  try {
    return action();
  } catch (error) {
    return (error as Error).name;
  }
}
function access(label: string, action: () => unknown): void {
  attempt(label, () => {
    try {
      return action();
    } catch (error) {
      const { name, message } = error as Error;
      return (
        name + " about " + (message.includes("undefined") ? "undefined" : message.includes("null") ? "null" : "neither")
      );
    }
  });
}
function first(list: number[], index: number): number {
  return list[index];
}
function firstOrNothing(list: number[] | undefined, index: number): number {
  return list![index];
}
function firstOrNull(list: number[] | null, index: number): number {
  return list![index];
}
function optional(list: number[] | null | undefined, index: number): number | undefined {
  return list?.[index];
}
function store(list: number[] | undefined, index: number, value: number): void {
  list![index] = value;
}
function update(list: number[] | undefined, index: number): void {
  list![index]++;
}
function byAnyKey(list: number[] | undefined, key: any): unknown {
  return list![key];
}
function hasKey(list: number[] | undefined, key: any): boolean {
  return key in list!;
}
function byteAt(bytes: Uint8Array | undefined, index: number): number {
  return bytes![index];
}
function storeByte(bytes: Uint8Array | null, index: number, value: number): void {
  bytes![index] = value;
}
function lengthOf(list: number[] | undefined): number {
  return list!.length;
}
const list = [1, 2, 3];
const bytes = new Uint8Array([7, 8]);
for (let round = 0; round < 2; round++) {
  access("an array", () => first(list, 1));
  access("undefined typed as an array", () => first(undefined as any, 0));
  access("null typed as an array", () => first(null as any, 0));
  access("an array or undefined: an array", () => firstOrNothing(list, 2));
  access("an array or undefined: undefined", () => firstOrNothing(undefined, 0));
  access("an array or null: an array", () => firstOrNull(list, 0));
  access("an array or null: null", () => firstOrNull(null, 0));
  access("an optional chain", () => [optional(undefined, 0), optional(null, 0), optional(list, 0)].join());
  access("a store to undefined", () => store(undefined, 0, 1));
  access("a store to an array", () => (store(list, 0, 1), list.join()));
  access("an update of undefined", () => update(undefined, 0));
  access("an update of an array", () => (update(list, 2), list.join()));
  access("undefined with a string key", () => byAnyKey(undefined, "name"));
  access("undefined with a fractional key", () => byAnyKey(undefined, 1.5));
  access("undefined with a symbol key", () => byAnyKey(undefined, Symbol.iterator));
  access("an array with a string key", () => byAnyKey(list, "1"));
  attempt("in undefined", () => hasKey(undefined, 0));
  access("in an array", () => hasKey(list, 0));
  access("a byte of undefined", () => byteAt(undefined, 0));
  access("a byte", () => byteAt(bytes, 1));
  access("a store to null typed as bytes", () => storeByte(null, 0, 1));
  access("a store of a byte", () => (storeByte(bytes, 0, 9), bytes.join()));
  access("the length of undefined", () => lengthOf(undefined));
  access("the length of an array", () => lengthOf(list));
  access("undefined itself", () => (undefined as any)[0]);
  access("null itself", () => (null as any)[0]);
}

const order: string[] = [];
const convertible = {
  toString() {
    order.push("key converted");
    return "0";
  },
};
function keyOf(): any {
  order.push("key evaluated");
  return convertible;
}
function valueToStore(): number {
  order.push("value evaluated");
  return 5;
}
function readIn(target: number[] | undefined): unknown {
  return target![keyOf()];
}
function storeIn(target: number[] | undefined): void {
  target![keyOf()] = valueToStore();
}
function addIn(target: number[] | undefined): void {
  target![keyOf()] += valueToStore();
}
const steps: [string, () => unknown][] = [
  ["a read of undefined", () => readIn(undefined)],
  ["a read of an array", () => readIn([7])],
  ["a store to an array", () => storeIn([7])],
  ["an addition to undefined", () => addIn(undefined)],
  ["an addition to an array", () => addIn([7])],
];
for (const [label, step] of steps) {
  order.length = 0;
  attempt(label, step);
  console.log(label + ", order: " + order.join());
}
export {};
