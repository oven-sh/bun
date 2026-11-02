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
function exercise(list: number[]): unknown {
  const popped = list.pop(),
    last = list.at(-1),
    length = list.push(7, 8);
  let sum = 0;
  for (const x of list) sum += x;
  list.length = 1;
  return [popped, last, length, sum, list];
}
function exerciseEach(a: number[]): unknown {
  const mapped = exercise(a.map(x => x * 2)),
    filtered = exercise(a.filter(x => x > 1));
  return [mapped, filtered, exercise(Array.from(a, x => x + 1)), exercise(a.slice(1))];
}
const seen: unknown[] = [];
let earlier: number[] = [];
function mapWhileWatching(a: number[]): unknown {
  const result = a.map((x, index, whole) => {
    seen.push(whole, earlier);
    return x + index + earlier.length;
  });
  const summary = [seen.length, seen.includes(result), seen.includes(a), result];
  earlier = result;
  return summary;
}
report("integers", () => exerciseEach([1, 2, 3, 4]));
report("fractions", () => exerciseEach([1.5, 2.5, 3.5]));
report("first watched call", () => mapWhileWatching([1, 2, 3]));
report("second watched call", () => mapWhileWatching([4, 5]));
