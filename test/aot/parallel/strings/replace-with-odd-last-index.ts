// `replace`, `replaceAll`, `split`, `match` and `search` with a RegExp whose `lastIndex` is an object, not an integer, out of range or read-only: the conversion runs user code when the specification says so, what that code stores is visible after the call, and a store to `lastIndex` that fails throws a TypeError.
// Flags: --aot-validate
const log: string[] = [];

function attempt(action: () => unknown): string {
  try {
    return JSON.stringify(action()) ?? "undefined";
  } catch (error) {
    return (error as Error).name;
  }
}

function describeLastIndex(re: RegExp): string {
  const value: unknown = (re as any).lastIndex;
  if (typeof value === "number") return Object.is(value, -0) ? "-0" : String(value);
  return typeof value === "string" ? JSON.stringify(value) : value === null ? "null" : typeof value;
}

function takeLog(): string {
  return log.splice(0).join("+") || "nothing";
}

const methods: [string, (s: string, re: RegExp) => unknown][] = [
  ["replace with a string", (s, re) => s.replace(re, "b")],
  ["replace with a pattern", (s, re) => s.replace(re, "[$&]")],
  ["replace with a function", (s, re) => s.replace(re, found => `<${found}>`)],
  ["replaceAll with a string", (s, re) => s.replaceAll(re, "b")],
  ["replaceAll with a function", (s, re) => s.replaceAll(re, found => `<${found}>`)],
  ["split", (s, re) => s.split(re)],
  ["split with a limit", (s, re) => s.split(re, 2)],
  ["match", (s, re) => s.match(re)],
  ["search", (s, re) => s.search(re)],
];

const literals: [string, () => RegExp][] = [
  ["/a/", () => /a/],
  ["/a/g", () => /a/g],
  ["/a/y", () => /a/y],
  ["/a/gy", () => /a/gy],
];

const oddValues: [string, () => unknown][] = [
  ["valueOf returns 0", () => ({ valueOf: () => (log.push("read"), 0) })],
  ["valueOf returns 1", () => ({ valueOf: () => (log.push("read"), 1) })],
  ["valueOf returns 9", () => ({ valueOf: () => (log.push("read"), 9) })],
  ["toString returns 2", () => ({ toString: () => (log.push("read"), "2") })],
  ["valueOf throws", () => ({ valueOf: () => { log.push("read"); throw new RangeError("from valueOf"); } })],
  ["text 1", () => "1"],
  ["text x", () => "x"],
  ["null", () => null],
  ["undefined", () => undefined],
  ["true", () => true],
  ["symbol", () => Symbol.iterator],
  ["bigint", () => 1n],
  ["-1", () => -1],
  ["-0", () => -0],
  ["1.5", () => 1.5],
  ["NaN", () => NaN],
  ["Infinity", () => Infinity],
  ["4", () => 4],
  ["5", () => 5],
  ["2 ** 31", () => 2 ** 31],
  ["2 ** 32 + 1", () => 2 ** 32 + 1],
  ["2 ** 53", () => 2 ** 53],
];

for (const [methodName, method] of methods) {
  console.log(methodName);
  for (const [valueName, createValue] of oddValues) {
    const cells = literals.map(([source, create]) => {
      const re = create();
      (re as any).lastIndex = createValue();
      return `${source} ${attempt(() => method("aaba", re))} ran ${takeLog()} left ${describeLastIndex(re)}`;
    });
    console.log(`  ${valueName}: ${cells.join(" | ")}`);
  }
}

function storeDuringReplaceWithString(s: string): string {
  const o = { x: 0 };
  const re = /a/y;
  (re as any).lastIndex = { valueOf: () => ((o.x = 2), 0) };
  o.x = 1;
  const result = s.replace(re, "b");
  return `${o.x} ${result}`;
}
function storeDuringReplaceWithFunction(s: string): string {
  const o = { x: 0 };
  const re = /a/y;
  (re as any).lastIndex = { valueOf: () => ((o.x = 2), 0) };
  o.x = 1;
  const result = s.replace(re, found => found + o.x);
  return `${o.x} ${result}`;
}
function storeDuringReplaceAll(s: string): string {
  const o = { x: 0 };
  const re = /a/gy;
  (re as any).lastIndex = { valueOf: () => ((o.x = 2), 0) };
  o.x = 1;
  const result = s.replaceAll(re, "b");
  return `${o.x} ${result}`;
}
function storeDuringSplit(s: string): string {
  const o = { x: 0 };
  const re = /a/y;
  (re as any).lastIndex = { valueOf: () => ((o.x = 2), 0) };
  o.x = 1;
  const result = s.split(re);
  return `${o.x} ${JSON.stringify(result)}`;
}
function storeDuringMatch(s: string): string {
  const o = { x: 0 };
  const re = /a/y;
  (re as any).lastIndex = { valueOf: () => ((o.x = 2), 0) };
  o.x = 1;
  const result = s.match(re);
  return `${o.x} ${JSON.stringify(result)}`;
}
function storeDuringSearch(s: string): string {
  const o = { x: 0 };
  const re = /a/y;
  (re as any).lastIndex = { valueOf: () => ((o.x = 2), 0) };
  o.x = 1;
  const result = s.search(re);
  return `${o.x} ${result}`;
}
console.log("a store by valueOf is visible after the call");
for (const s of ["aaba", "baab", ""]) {
  console.log(
    `  ${JSON.stringify(s)}:`,
    [storeDuringReplaceWithString, storeDuringReplaceWithFunction, storeDuringReplaceAll, storeDuringSplit, storeDuringMatch, storeDuringSearch].map(run => run(s)).join(" | "),
  );
}

function storeToArrayDuringReplace(s: string): string {
  const list = [1, 2, 3];
  const re = /a/y;
  (re as any).lastIndex = { valueOf: () => (list.push(4), (list[0] = 10), 1) };
  const before = list[0] + list.length;
  const result = s.replace(re, "b");
  return `${before} ${list[0] + list.length} ${result} ${re.lastIndex}`;
}
let moduleCounter = 0;
function storeToVariableDuringReplace(s: string): string {
  const re = /a/y;
  (re as any).lastIndex = { valueOf: () => moduleCounter++ };
  const before = moduleCounter;
  const result = s.replace(re, "b");
  return `${before} ${moduleCounter} ${result} ${re.lastIndex}`;
}
console.log("  other locations:", storeToArrayDuringReplace("aaba"), "|", storeToVariableDuringReplace("aaba"), "|", storeToVariableDuringReplace("aaba"), "|", storeToVariableDuringReplace("aaba"));

function replaceStickyFrom(s: string, lastIndex: number): string {
  const re = /a/y;
  re.lastIndex = lastIndex;
  const result = s.replace(re, "b");
  return `${result} ${re.lastIndex}`;
}
console.log("a sticky literal with a numeric lastIndex");
for (const lastIndex of [0, 1, 2, 3, 4, 5, 100, -1, -0, 0.5, 1.5, NaN, Infinity, -Infinity, 2 ** 31, 2 ** 32 + 1]) {
  console.log(`  ${Object.is(lastIndex, -0) ? "-0" : lastIndex}: ${replaceStickyFrom("aaba", lastIndex)} | ${replaceStickyFrom("中aab", lastIndex)}`);
}
function replaceStickyRepeatedly(s: string): string {
  const re = /a/y;
  const steps: string[] = [];
  for (let step = 0; step < 5; step++) steps.push(`${s.replace(re, "b")} ${re.lastIndex}`);
  return steps.join(", ");
}
console.log("  repeated:", replaceStickyRepeatedly("aaba"));

function fix(re: RegExp, value: number): RegExp {
  return Object.defineProperty(re, "lastIndex", { writable: false, value });
}
function searchReadOnly(s: string, value: number): number {
  const re = /a/;
  Object.defineProperty(re, "lastIndex", { writable: false, value });
  return s.search(re);
}
console.log("a read-only lastIndex");
console.log("  search in one function:", attempt(() => searchReadOnly("ba", 1)), attempt(() => searchReadOnly("ba", 0)), attempt(() => searchReadOnly("bb", 1)), attempt(() => searchReadOnly("bb", 0)));
for (const [methodName, method] of methods) {
  const cells: string[] = [];
  for (const [source, create] of literals) {
    for (const value of [0, 1]) {
      const re = fix(create(), value);
      cells.push(`${source} at ${value} ${attempt(() => method("aaba", re))} ${attempt(() => method("bbb", re))} left ${describeLastIndex(re)}`);
    }
  }
  console.log(`  ${methodName}: ${cells.join(" | ")}`);
}
console.log("a frozen RegExp");
for (const [methodName, method] of methods) {
  console.log(`  ${methodName}: ${literals.map(([source, create]) => `${source} ${attempt(() => method("aaba", Object.freeze(create())))}`).join(" | ")}`);
}

export {};
