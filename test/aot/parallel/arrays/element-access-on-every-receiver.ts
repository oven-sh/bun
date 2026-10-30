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
function at(list: number[], index: number): unknown {
  return list[index];
}
function has(list: number[], index: number): boolean {
  return index in list;
}
function put(list: number[], index: number, value: number): void {
  list[index] = value;
}
function lengthOf(list: number[]): number {
  return list.length;
}
function total(list: number[]): unknown {
  let sum = 0;
  for (let index = 0; index < list.length; index++) sum += list[index];
  return sum;
}
const receivers: [string, () => number[]][] = [
  ["an array", () => [1, 2, 3]],
  ["an array of fractions", () => [1.5, 2.5, 3.5]],
  ["an empty array", () => []],
  [
    "a frozen array",
    () =>
      (() => {
        const list = [1, 2, 3];
        Object.freeze(list);
        return list;
      })(),
  ],
  [
    "a sealed array",
    () =>
      (() => {
        const list = [1, 2, 3];
        Object.seal(list);
        return list;
      })(),
  ],
  [
    "a non-extensible array",
    () =>
      (() => {
        const list = [1, 2, 3];
        Object.preventExtensions(list);
        return list;
      })(),
  ],
  [
    "an array with a getter element",
    () =>
      (() => {
        const list = [1, 2, 3];
        Object.defineProperty(list, 1, {
          get() {
            return 20;
          },
          set() {},
          configurable: true,
        });
        return list;
      })(),
  ],
  [
    "an array with a read-only element",
    () =>
      (() => {
        const list = [1, 2, 3];
        Object.defineProperty(list, 1, { value: 20, writable: false });
        return list;
      })(),
  ],
  [
    "an array with a read-only length",
    () =>
      (() => {
        const list = [1, 2, 3];
        Object.defineProperty(list, "length", { writable: false });
        return list;
      })(),
  ],
  [
    "a sparse array",
    () =>
      (() => {
        const list: number[] = [];
        list[100000] = 1;
        list[1] = 2;
        return list;
      })(),
  ],
  [
    "an array with a deleted element",
    () =>
      (() => {
        const list = [1, 2, 3];
        delete list[1];
        return list;
      })(),
  ],
  [
    "an array with a hole and a prototype that has the index",
    () =>
      (() => {
        const list = [1, 2, 3];
        delete list[1];
        Object.setPrototypeOf(
          list,
          Object.create(Array.prototype, { 1: { value: 20, writable: true, configurable: true } }),
        );
        return list;
      })(),
  ],
  [
    "an array with a null prototype",
    () =>
      (() => {
        const list = [1, 2, 3];
        Object.setPrototypeOf(list, null);
        return list;
      })(),
  ],
  [
    "an array with an extra property",
    () =>
      (() => {
        const list = [1, 2, 3];
        (list as any).extra = 4;
        return list;
      })(),
  ],
  ["an Array subclass instance", () => new (class List extends Array<number> {})(1, 2, 3)],
  ["an array of strings", () => ["a", "b", "c"] as any],
  ["an array with a hole", () => [1, , 3] as any],
  ["an array-like object", () => ({ 0: 1, 1: 2, 2: 3, length: 3 }) as any],
  [
    "an arguments object",
    () =>
      (function (..._: number[]) {
        return arguments;
      })(1, 2, 3) as any,
  ],
  ["a string", () => "abc" as any],
  ["a typed array", () => new Uint8Array([1, 2, 3]) as any],
  [
    "a proxy for an array",
    () =>
      new Proxy([1, 2, 3], {
        get(target, key, receiver) {
          return key === "1" ? 20 : Reflect.get(target, key, receiver);
        },
      }),
  ],
  ["a function", () => function (a: number, b: number) {} as any],
  ["a number", () => 5 as any],
];
for (const [name, make] of receivers) {
  const read = make();
  for (const index of [0, 1, 2, 3, -1, 1.5]) attempt(name + ", read at " + index, () => at(read, index));
  attempt(name + ", has", () => nameOfError(() => [0, 1, 3].map(index => has(read, index)).join()));
  attempt(name + ", length", () => lengthOf(read));
  attempt(name + ", total", () => total(read));
  for (const index of [1, 3, 7, -1, 1.5]) {
    const stored = make();
    attempt(
      name + ", store at " + index,
      () => (
        put(stored, index, 9),
        [show(at(stored, index)), show(lengthOf(stored)), Object.keys(stored).slice(0, 8).join()].join(" ")
      ),
    );
  }
}
export {};
