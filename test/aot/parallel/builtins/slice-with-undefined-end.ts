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
function part(a: number[], start?: number, end?: number): number[] {
  return a.slice(start, end);
}
function partFromOne(a: number[], end: number | undefined): number[] {
  return a.slice(1, end);
}
const list = [10, 20, 30, 40];
report("(1, undefined)", () => part(list, 1, undefined));
report("(undefined, 2)", () => part(list, undefined, 2));
report("(undefined, undefined)", () => part(list, undefined, undefined));
report("(-2)", () => part(list, -2));
report("(1, -1)", () => part(list, 1, -1));
report("(9)", () => part(list, 9));
report("(2, 1)", () => part(list, 2, 1));
report("()", () => [part(list), part(list) === list]);
report("constant start", () => [partFromOne(list, undefined), partFromOne(list, 3)]);
