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
const keys: unknown[] = [
  0,
  1,
  2,
  3,
  -1,
  1.5,
  -0,
  NaN,
  Infinity,
  2147483647,
  2147483648,
  4294967294,
  4294967295,
  4294967296,
  "0",
  "1",
  "01",
  "1.0",
  "-1",
  "-0",
  "1.5",
  "1e0",
  " 1",
  "length",
  "push",
  "missing",
  "",
  true,
  null,
  undefined,
  Symbol.iterator,
  1n,
  [1],
  {
    toString() {
      return "2";
    },
  },
];
function at(list: number[], key: any): unknown {
  return list[key];
}
function has(list: number[], key: any): boolean {
  return key in list;
}
function put(list: number[], key: any, value: number): void {
  list[key] = value;
}
function remove(list: number[], key: any): boolean {
  return delete list[key];
}
function stateOf(list: number[]): string {
  return list.length + " " + Object.keys(list).join();
}
keys.forEach((key, position) => {
  const label = position + " " + show(key);
  const read = [10, 20, 30];
  attempt(label + ", read", () => at(read, key));
  attempt(label + ", has", () => has(read, key));
  const stored = [10, 20, 30];
  attempt(label + ", stored", () => (put(stored, key, 99), stateOf(stored) + " " + show(at(stored, key))));
  const removed = [10, 20, 30];
  attempt(label + ", removed", () => remove(removed, key) + " " + stateOf(removed));
});
function sum(list: number[], indexes: any[]): unknown {
  let total = 0;
  for (const index of indexes) total += list[index];
  return total;
}
function sumByKeys(list: number[]): number {
  let total = 0;
  for (const key in list) total += list[key as any];
  return total;
}
attempt("sum with number keys", () => sum([1, 2, 3], [0, 1, 2]));
attempt("sum with string keys", () => sum([1, 2, 3], ["0", "1", "2"]));
attempt("sum with number and string keys", () => sum([1, 2, 3], [0, "1", 2, "length"]));
attempt("sum past the end", () => sum([1, 2, 3], [0, 1, 2, 3]));
attempt("sum with for-in keys", () => sumByKeys([1, 2, 3]));
export {};
