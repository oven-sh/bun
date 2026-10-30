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
const receivers: [string, () => number[]][] = [["an array", () => [1, 2, 3]]];
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
