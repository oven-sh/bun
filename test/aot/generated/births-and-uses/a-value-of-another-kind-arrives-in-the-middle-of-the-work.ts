// A loop over numbers, by their declared type and by all that came before. On one turn what arrives is no such number: a text, nothing, an object that answers when asked for its value, a
// big integer, a fraction among whole numbers. The code that was made for numbers has to hand over to code that takes anything, in the middle of the loop, with all that is under way:
// a sum in a register, a text half put together, a list half filled, an object that was never made, a store that was put off, a cleanup that is still owed. Later turns bring numbers again.
// What is under way x how the value is held x what arrives, each in some places.
import { inEveryPlace, type Stretch } from "./where-a-stretch-stands";

type State = { beside?: string; before: string; step: string; after: string };
const states: Record<string, State> = {
  wholeSum: { before: "let sum = 0;", step: "sum += v;", after: "sum" },
  fractionSum: { before: "let sum = 0.5;", step: "sum += v;", after: "sum" },
  product: { before: "let product = 1;", step: "product *= v;", after: "product" },
  difference: { before: "let rest = 100;", step: "rest -= v;", after: "rest" },
  bits: { before: "let bits = 0;", step: "bits = (bits << 1) ^ (v | 0);", after: "bits" },
  text: { before: `let text = "";`, step: `text += v + ",";`, after: "text" },
  template: { before: `let text = "";`, step: "text += `<${v}>`;", after: "text" },
  list: { before: "const list: number[] = [];", step: "list.push(v);", after: "show(list)" },
  listOfHalves: { before: "const list: number[] = [];", step: "list.push(v / 2);", after: "show(list)" },
  listByIndex: { before: "const list: number[] = [];", step: "list[at] = v + 1;", after: "show(list)" },
  objectOfTheTurn: { before: "let sum = 0;", step: "const point = { x: v, y: at }; sum += point.x + point.y;", after: "sum" },
  objectThatLeavesOnOneTurn: { before: "let sum = 0;", step: "const point = { x: v, y: at }; if (at === 3) kept.push(point); sum += point.y;", after: `sum + show(kept.splice(0))` },
  pairOutOfACall: { beside: "function pair(a: number, b: number): [number, number] { return [a + 1, b]; }", before: "let sum = 0;", step: "const [a, b] = pair(v, at); sum += a * b;", after: "sum" },
  closureOfTheTurn: { before: "let sum = 0;", step: "const add = () => sum + v; sum = add();", after: "sum" },
  moduleVariable: { beside: "let total = 0;", before: "total = 0;", step: "total += v;", after: "total" },
  largest: { before: "let best = -1;", step: "if (v > best) best = v;", after: "best" },
  equalToTheCounter: { before: "let equal = 0;", step: "if (v === at + 1) equal++; if (v == at + 1) equal += 10;", after: "equal" },
  index: { before: "const table = [10, 11, 12, 13, 14, 15]; let picked = 0;", step: "picked += table[v] ?? -1;", after: "picked" },
  cases: { before: "let hits = 0;", step: "switch (v) { case 1: hits++; break; case 2: hits += 10; break; case 5: hits += 100; break; default: hits += 1000; }", after: "hits" },
  key: { before: "const counts: Record<number, number> = {};", step: "counts[v] = (counts[v] ?? 0) + 1;", after: "show(counts)" },
  mathematics: { before: "let sum = 0;", step: "sum += Math.floor(v) + Math.max(v, 1) + Math.abs(v);", after: "sum" },
  wholeNumbersInBytes: { before: "const ints = new Int32Array(5);", step: "ints[at] = v;", after: `ints.join("+")` },
  owedCleanup: { before: "let sum = 0, done = 0;", step: "try { sum += v; } finally { done++; }", after: `sum + "/" + done` },
  truth: { before: "let yes = 0;", step: "if (v) yes++; yes += v ? 10 : 0;", after: "yes" },
  kind: { before: `let kinds = "";`, step: "kinds += (typeof v)[0];", after: "kinds" },
  twoSums: { before: "let whole = 0, half = 0.5;", step: "whole += at; half += v; whole += v;", after: `whole + "/" + half` },
};

type Carrier = { beside?: string; type: string; make: (values: string[]) => string; read: string; length: string };
const carriers: Record<string, Carrier> = {
  element: { type: "number[]", make: values => `[${values.join(", ")}]`, read: "items[at]", length: "items.length" },
  field: { type: "{ x: number }[]", make: values => `[${values.map(value => `{ x: ${value} }`).join(", ")}]`, read: "items[at].x", length: "items.length" },
  fieldOfAnInstance: { beside: "class Item { x: number; constructor(x: number) { this.x = x; } }", type: "Item[]", make: values => `[${values.map(value => `new Item(${value})`).join(", ")}]`, read: "items[at].x", length: "items.length" },
  resultOfACall: { beside: "function same(value: number): number { return value; }", type: "number[]", make: values => `[${values.join(", ")}]`, read: "same(items[at])", length: "items.length" },
  resultOfAMethod: { beside: "class Source { x: number; constructor(x: number) { this.x = x; } get(): number { return this.x; } }", type: "Source[]", make: values => `[${values.map(value => `new Source(${value})`).join(", ")}]`, read: "items[at].get()", length: "items.length" },
  valueInAMap: { type: "Map<number, number>", make: values => `new Map([${values.map((value, at) => `[${at}, ${value}]`).join(", ")}])`, read: "items.get(at)!", length: "items.size" },
  firstOfAPair: { type: "[number, string][]", make: values => `[${values.map(value => `[${value}, "p"]`).join(", ")}]`, read: "items[at][0]", length: "items.length" },
  fieldThatMayBeMissing: { type: "{ x?: number }[]", make: values => `[${values.map(value => `{ x: ${value} }`).join(", ")}]`, read: "(items[at].x ?? 0)", length: "items.length" },
};

const strangers: Record<string, string> = {
  text: `"5"`,
  emptyText: `""`,
  nothing: "undefined",
  none: "null",
  objectThatAnswers: `{ valueOf() { say("asked"); return 4; } }`,
  objectThatThrows: `{ valueOf() { throw new RangeError("asked"); } }`,
  bigInteger: "10n",
  symbol: `Symbol("s")`,
  truth: "true",
  list: "[3]",
  wrappedNumber: "new Number(6)",
  noNumber: "NaN",
  negativeZero: "-0",
  fraction: "2.5",
  pastWholeNumbers: "2147483648",
  infinite: "-Infinity",
};

function stretch(stateName: string, carrierName: string, strangerName: string, position: number): Stretch {
  const [state, carrier] = [states[stateName], carriers[carrierName]];
  const values = (seed: string, stranger?: string) => ["1", "2", "3", "5", seed].map((value, at) => (stranger !== undefined && at === position ? `(${stranger} as unknown as number)` : value));
  return {
    name: `${stateName}-${carrierName}-${strangerName}-at${position}`,
    beside: `const kept: unknown[] = [];\nfunction show(value: unknown): string { return JSON.stringify(value, (_, each) => (typeof each === "bigint" || typeof each === "symbol" ? String(each) : Object.is(each, -0) ? "-0" : typeof each === "number" && !Number.isFinite(each) ? String(each) : each)); }\n${state.beside ?? ""}\n${carrier.beside ?? ""}`,
    before: seed => `const usual: ${carrier.type} = ${carrier.make(values(seed))}; const unusual: ${carrier.type} = ${carrier.make(values(seed, strangers[strangerName]))};`,
    body: turn => `const items = (${turn}) % 2 ? unusual : usual; ${state.before} for (let at = 0; at < ${carrier.length}; at++) { const v = ${carrier.read}; ${state.step} } say(String(${state.after}));`,
    after: `"end"`,
  };
}

// What a text from outside holds nobody knows before it is read: there a declared type is all there is to go by.
const carriersFromOutside: Record<string, { type: string; text: (values: string[]) => string; read: string }> = {
  element: { type: "number[]", text: values => `[${values.join(",")}]`, read: "items[at]" },
  field: { type: "{ x: number }[]", text: values => `[${values.map(value => `{"x":${value}}`).join(",")}]`, read: "items[at].x" },
  firstOfAPair: { type: "[number, string][]", text: values => `[${values.map(value => `[${value},"p"]`).join(",")}]`, read: "items[at][0]" },
  fieldThatMayBeMissing: { type: "{ x?: number }[]", text: values => `[${values.map(value => `{"x":${value}}`).join(",")}]`, read: "(items[at].x ?? 0)" },
};
const strangersFromOutside: Record<string, string> = { text: `"5"`, emptyText: `""`, none: "null", truth: "true", list: "[3]", record: "{}", fraction: "2.5", pastWholeNumbers: "2147483648", infinite: "1e400", negativeZero: "-0" };

function stretchFromOutside(stateName: string, carrierName: string, strangerName: string, position: number): Stretch {
  const [state, carrier] = [states[stateName], carriersFromOutside[carrierName]];
  const text = (stranger?: string) => carrier.text(["1", "2", "3", "5", "@"].map((value, at) => (stranger !== undefined && at === position ? stranger : value)));
  return {
    ...stretch(stateName, "element", "text", position),
    name: `${stateName}-${carrierName}FromOutside-${strangerName}-at${position}`,
    before: seed => `const usual = JSON.parse('${text()}'.replace("@", String(${seed}))) as ${carrier.type}; const unusual = JSON.parse('${text(strangersFromOutside[strangerName])}'.replace("@", String(${seed}))) as ${carrier.type};`,
    body: turn => `const items = (${turn}) % 2 ? unusual : usual; ${state.before} for (let at = 0; at < items.length; at++) { const v = ${carrier.read}; ${state.step} } say(String(${state.after}));`,
  };
}

const somePlaces = ["once", "often", "moduleLoop", "loop", "loopOften", "twoLoops", "loopWithContinue", "handlerInALoop", "loopUnderAHandler", "handlerAndCleanup", "copiedIntoALoop", "alsoCalledWhereItSeldomRuns", "inAClosure", "method", "loopWithAYield", "loopWithAnAwait"];

export const oneIn = 140;

export function programs(isTyped?: boolean) {
  const all: Stretch[] = [];
  let at = 0;
  for (const state in states) for (const carrier in carriers) for (const stranger in strangers) all.push(stretch(state, carrier, stranger, [2, 0, 4, 3][at++ % 4]));
  for (const state in states) for (const carrier in carriersFromOutside) for (const stranger in strangersFromOutside) all.push(stretchFromOutside(state, carrier, stranger, [2, 0, 3, 1][at++ % 4]));
  return inEveryPlace(all, isTyped, somePlaces);
}
