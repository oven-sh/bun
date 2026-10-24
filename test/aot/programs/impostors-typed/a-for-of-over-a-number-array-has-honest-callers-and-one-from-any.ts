function show(value: unknown): string {
  if (typeof value === "number") return Object.is(value, -0) ? "-0" : String(value);
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "bigint") return value + "n";
  if (value === null || value === undefined) return String(value);
  return typeof value;
}

function attempt(label: string, run: () => unknown): void {
  try {
    console.log(label, "->", show(run()));
  } catch (error) {
    console.log(label, "threw", error instanceof Error ? error.constructor.name : typeof error);
  }
}

function total(list: number[]): number {
  let sum = 0;
  for (const value of list) sum += value;
  return sum;
}

function firstTwo(list: number[]): number {
  const [a, b] = list;
  return a - b;
}

function copied(list: number[]): number {
  return [...list].length;
}

function largest(list: number[]): number {
  return Math.max(...list);
}

function honest(label: string): void {
  const kept = [3, 4, 5];
  console.log(label, total([1, 2]), total(kept), firstTwo([9, 4]), firstTwo(kept), copied(kept), copied([]), largest(kept), largest([1.5]));
}

const log: string[] = [];
(globalThis as any).note = (text: string) => log.push(text);
const hidden = (text: string): any => (0, eval)("(" + text + ")");

const texts = [
  "[1, 2, 3]",
  "[-0]",
  "['1', '2']",
  "[1, , 3]",
  "[1n, 2n]",
  "[{ valueOf() { note('valueOf'); return 7; } }, 1]",
  "{ length: 2, 0: 10, 1: 20 }",
  "{ length: 2, 0: 10, 1: 20, [Symbol.iterator]: Array.prototype[Symbol.iterator] }",
  "{ [Symbol.iterator]() { note('iterator'); let n = 0; return { next() { note('next'); return { done: n++ >= 3, value: n }; }, return() { note('return'); return {}; } }; } }",
  "{ [Symbol.iterator]() { return { next() { return 5; } }; } }",
  "{ [Symbol.iterator]() { return {}; } }",
  "{ [Symbol.iterator]: 5 }",
  "'123'",
  "'\\ud83d\\ude00x'",
  "new String('45')",
  "new Uint8Array([250, 10])",
  "new Float64Array([0.5, -0])",
  "(function () { return arguments; })(1, 2, 3)",
  "new Proxy([1, 2], {})",
  "new Proxy([1, 2], { get(t, k, r) { note(typeof k === 'symbol' ? 'get symbol' : 'get ' + k); return Reflect.get(t, k, r); } })",
  "Object.setPrototypeOf([1, 2], null)",
  "Object.setPrototypeOf([1, , 3], { 1: 100, [Symbol.iterator]: Array.prototype[Symbol.iterator] })",
  "Object.defineProperty([1, 2, 3], 1, { get() { note('getter'); return 50; } })",
  "Object.assign([1, 2], { [Symbol.iterator]: function* () { yield 40; yield 2; } })",
  "new (class extends Array { *[Symbol.iterator]() { yield 8; yield 9; } })(1, 2, 3)",
  "new (class extends Array { [Symbol.iterator]() { note('subclass iterator'); return super[Symbol.iterator](); } })(1, 2, 3)",
  "new Array(3)",
  "new Set([1, 2, 2])",
  "new Map([[0, 1]])",
  "new Map([[0, 1]]).values()",
  "(function* () { yield 1; yield 2; note('generator end'); })()",
  "[5, 6].values()",
  "[5, 6].entries()",
  "null",
  "undefined",
  "0",
  "true",
];

honest("honest before");
let warm = 0;
for (let i = 0; i < 2000; i++) warm += total([i, 1]) + firstTwo([i, 1]) + copied([i]) + largest([i, 2]);
console.log("2000 honest calls", warm);

const uses: [string, (list: number[]) => number][] = [
  ["total", total],
  ["firstTwo", firstTwo],
  ["copied", copied],
  ["largest", largest],
];

for (const text of texts) {
  for (const [name] of uses) {
    const impostor: any = hidden(text);
    log.length = 0;
    if (name === "total") attempt("total " + text, () => total(impostor));
    if (name === "firstTwo") attempt("firstTwo " + text, () => firstTwo(impostor));
    if (name === "copied") attempt("copied " + text, () => copied(impostor));
    if (name === "largest") attempt("largest " + text, () => largest(impostor));
    if (log.length) console.log("  log", log.join(" "));
  }
}

honest("honest after");
