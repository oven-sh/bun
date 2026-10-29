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
function joinNumbers(lists: number[][]): string {
  let s = "";
  for (const a of lists) s += a.join();
  return s;
}
function joinStrings(lists: string[][]): string {
  let s = "";
  for (const a of lists) s += a.join();
  return s;
}
function joinAnything(lists: unknown[][]): string {
  let s = "";
  try {
    for (const a of lists) s += a.join();
  } catch {
    return "caught after " + s;
  }
  return s;
}
const unprintable = {
  toString(): string {
    throw new RangeError("no text");
  },
};
report("numbers", () => [joinNumbers([[1, 2], [], [3.5, -0], [4]]), joinNumbers([[7]])]);
report("strings", () => [joinStrings([["a", "b"], [""], ["c"]]), joinStrings([])]);
report("mixed", () =>
  joinAnything([
    [1, "a", null, undefined, true],
    [[2, 3], { toString: () => "object" }],
  ]),
);
report("toString throws", () => joinAnything([[1, 2], ["a", unprintable, "b"], [3]]));
report("toString throws in the first list", () => joinAnything([[unprintable]]));
