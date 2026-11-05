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
function createStringSet(list: string[]): Set<string> {
  return new Set(list);
}
function createMixedSet(list: (number | string)[]): Set<number | string> {
  return new Set(list);
}
function createSetFrom<T>(items: Iterable<T>): Set<T> {
  return new Set(items);
}
function createStringMap(pairs: [string, number][]): Map<string, number> {
  return new Map(pairs);
}
function createObjectMap(pairs: [object, number][]): Map<object, number> {
  return new Map(pairs);
}
function* yieldLetters(last: string): Generator<string> {
  yield "x";
  yield "y";
  yield "x";
  yield last;
}
function summarize(...collections: (Set<unknown> | Map<unknown, unknown>)[]): unknown {
  return collections.map(collection => [collection.size, [...collection]]);
}
const key = {};
report("strings", () => summarize(createStringSet(["b", "a", "b"]), createStringSet([])));
report("number and string", () => summarize(createMixedSet([1, "a"]), createMixedSet(["1", 1, 1])));
report("generator", () => summarize(createSetFrom(yieldLetters("z")), createSetFrom(yieldLetters("y"))));
report("string keys", () =>
  summarize(
    createStringMap([["a", 1]]),
    createStringMap([
      ["a", 1],
      ["b", 2],
      ["a", 3],
    ]),
  ),
);
report("object keys", () =>
  summarize(
    createObjectMap([[{}, 1]]),
    createObjectMap([
      [key, 1],
      [{}, 2],
      [key, 3],
    ]),
  ),
);
