// Env of the executable: BUN_JSC_crashIfInterpreterIsUsed=1
const show = (value: unknown): string =>
  Object.is(value, -0)
    ? "-0"
    : typeof value === "string" || (typeof value === "object" && value !== null)
      ? JSON.stringify(value)
      : String(value);
const report = (label: string, probe: () => unknown): void => {
  let text: string;
  try {
    text = show(probe());
  } catch (error) {
    text = "threw " + (error as Error).constructor.name;
  }
  console.log(label + ": " + text);
};
function summarize(removed: unknown[], a: unknown[]): unknown {
  return [removed, Object.keys(removed).join(), a, Object.keys(a).join()];
}
function cut<T>(a: T[], start: number, count: number, ...items: T[]): unknown {
  switch (items.length) {
    case 0:
      return summarize(a.splice(start, count), a);
    case 1:
      return summarize(a.splice(start, count, items[0]), a);
    case 2:
      return summarize(a.splice(start, count, items[0], items[1]), a);
    default:
      return summarize(a.splice(start, count, ...items), a);
  }
}
function drop<T>(a: T[], start: number, count: number): T[] {
  a.splice(start, count);
  return a;
}
for (let count = 0; count <= 3; count++)
  for (let inserted = 0; inserted <= 3; inserted++) {
    const label = count + " removed, " + inserted + " inserted: ";
    const numbers = [70, 80, 90].slice(0, inserted),
      strings = ["x", "y", "z"].slice(0, inserted);
    report(label + "integers", () => cut([1, 2, 3, 4, 5], 1, count, ...numbers));
    report(label + "fractions", () => cut([1.5, 2.5, 3.5, 4.5], 1, count, ...numbers));
    report(label + "strings", () => cut(["a", "b", "c", "d"], 1, count, ...strings));
    report(label + "hole", () => cut([1, , 3, 4], 1, count, ...numbers));
  }
report("fraction into integers", () => cut([1, 2, 3], 1, 1, 0.5));
report("result unused", () => [drop([1, 2, 3, 4, 5], 1, 2), drop([1.5, 2.5, 3.5], 0, 1), drop([1, , 3, 4], 1, 2)]);
