// A JSON.stringify call that falls back to the generic writer before it has written anything has no output to discard: it enters the run time for the text alone.
// ENV JSC_aotCountsPath=/dev/null
// Env: JSC_aotCountsPath=/dev/null
declare const aotRuntimeCounters: undefined | (() => string);
// What the shell has counted so far: a line "<calls>\toperation:<name>" for each operation of the run time that compiled code has called.
const countsSoFar = (): string => (typeof aotRuntimeCounters === "function" ? aotRuntimeCounters() : "");
// The calls in such a text, whatever they were for, but for the operations named.
function callsIn(counts: string, ...besides: string[]): number {
  let sum = 0;
  for (const line of counts.split("\n")) {
    const [calls, name] = line.split("\toperation:");
    if (name !== undefined && !besides.includes(name)) sum += Number(calls);
  }
  return sum;
}
// These make the text, and find a built-in function where it is first called.
const owed = ["operationAOTStringBuilderBegin", "operationAOTStringBuilderFinish", "operationAOTStringBuilderAppendJSON", "operationAOTJSONAppendString", "operationAOTJSONAppendValue", "operationAOTJSONStringifyPrimitive", "operationAOTBuiltinCell"];
const isCounted = typeof aotRuntimeCounters === "function";

type Circle = { kind: "circle"; radius: number };
type Square = { kind: "square"; side: number };
type Rectangle = { kind: "rectangle"; width: number; height: number };
type Triangle = { kind: "triangle"; base: number; height: number };
type Line = { kind: "line"; length: number };
type Label = { kind: "label"; text: string };
type Shape = Circle | Square | Rectangle | Triangle | Line | Label;
type Drawing = { name: string; shapes: Shape[] };
const rounds = 10;

function stringifyShape(shape: Shape): string {
  return JSON.stringify(shape);
}
function stringifyUnknown(value: unknown): string | undefined {
  return JSON.stringify(value);
}
function stringifyDrawing(drawing: Drawing): string {
  return JSON.stringify(drawing);
}

function count(name: string, expected: number, run: () => string | undefined) {
  const before = countsSoFar();
  let text: string | undefined;
  for (let round = 0; round < rounds; round++) text = run();
  const counted = callsIn(countsSoFar(), ...owed) - callsIn(before, ...owed);
  console.log(
    name,
    text,
    !isCounted || counted === expected ? "as expected" : `${counted} calls, expected ${expected}`,
  );
}

const shapes: Shape[] = [
  { kind: "circle", radius: 1 },
  { kind: "square", side: 2 },
  { kind: "rectangle", width: 3, height: 4 },
  { kind: "triangle", base: 5, height: 6 },
  { kind: "line", length: 7 },
  { kind: "label", text: "a dash —" },
];
for (const shape of shapes) {
  count("shape", 0, () => stringifyShape(shape));
  count("unknown, a shape", 0, () => stringifyUnknown(shape));
}

const values: unknown[] = [
  "a string",
  "a dash —",
  1,
  1.5,
  null,
  true,
  undefined,
  10n ** 2n > 1n,
  Symbol.iterator,
  [1, "two"],
  new Map(),
  new Date(0),
];
for (const value of values) count("unknown", 0, () => stringifyUnknown(value));

const replaced: Label = { kind: "label", text: "short" };
Object.defineProperty(replaced, "toJSON", { value: () => "replaced" });
const drawing: Drawing = { name: "a dash —", shapes: [shapes[0]!, shapes[5]!, replaced] };
count("fallback after writing", 0, () => stringifyDrawing(drawing));
count("shape, after a fallback", 0, () => stringifyShape(shapes[0]!));
count("16-bit, after a fallback", 0, () => stringifyDrawing({ name: "n", shapes: [shapes[5]!] }));
count("unknown, after a fallback", 0, () => stringifyUnknown("a string"));
