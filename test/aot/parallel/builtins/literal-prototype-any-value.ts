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
class Base {
  y = 7;
}
function make(p: any) {
  return { __proto__: p, x: 1 };
}
function makeWithNull(x: number) {
  return { __proto__: null, x };
}
function makeWithNumber(x: number) {
  return { __proto__: 5, x };
}
function inherit(p: { y: number }) {
  return { __proto__: p, x: 1 };
}
function readY(o: { y: number }): number {
  return o.y;
}
function summarize(o: { x: number }, p: unknown): unknown {
  return [Object.getPrototypeOf(o) === p, Object.getPrototypeOf(o) === Object.prototype, Object.keys(o), o.x];
}
function summarizeTyped(p: { y: number }): unknown {
  const o = inherit(p);
  return [summarize(o, p), (o as any).y, readY(o as any)];
}
const prototypes: [string, unknown][] = [
  ["null", null],
  ["undefined", undefined],
  ["number", 5],
  ["string", "s"],
  ["boolean", true],
  ["symbol", Symbol.iterator],
  ["bigint", 10n],
  ["object", {}],
  ["array", []],
  ["function", () => 0],
  ["instance", new Base()],
];
for (const [label, p] of prototypes) report(label, () => summarize(make(p), p));
report("null in the literal", () => [summarize(makeWithNull(1), null), summarize(makeWithNull(2), null)]);
report("number in the literal", () => [summarize(makeWithNumber(1), 5), summarize(makeWithNumber(2), 5)]);
report("typed literal", () => summarizeTyped({ y: 2 }));
report("typed instance", () => summarizeTyped(new Base()));
report("typed null", () => summarizeTyped(null as any));
