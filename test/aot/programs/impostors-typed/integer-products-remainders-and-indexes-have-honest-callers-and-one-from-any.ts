function show(value: unknown): string {
  if (typeof value === "number") return Object.is(value, -0) ? "-0" : String(value);
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "bigint") return value + "n";
  if (value === null || value === undefined) return String(value);
  return typeof value;
}

const log: string[] = [];

function attempt(label: string, run: () => unknown): void {
  log.length = 0;
  try {
    console.log(label, "->", show(run()), log.join(" "));
  } catch (error) {
    console.log(label, "threw", error instanceof Error ? error.constructor.name : typeof error, log.join(" "));
  }
}

function plus(n: number): number {
  return +n;
}

function squared(n: number): number {
  return n * n;
}

function parity(n: number): number {
  return n % 2;
}

function timesMinusOne(n: number): number {
  return n * -1;
}

function counted(n: number): number {
  let count = 0;
  for (let i = 0; i < n; i++) count++;
  return count;
}

function indexed(n: number): number | undefined {
  return [10, 20, 30][n];
}

function rounded(n: number): number {
  return Math.floor(n) + Math.abs(n) + Math.trunc(n);
}

function multipliedAsIntegers(n: number): number {
  return Math.imul(n, 3) + Math.clz32(n);
}

const uses: [string, (n: number) => number | undefined][] = [
  ["plus", plus],
  ["squared", squared],
  ["parity", parity],
  ["timesMinusOne", timesMinusOne],
  ["counted", counted],
  ["indexed", indexed],
  ["rounded", rounded],
  ["multipliedAsIntegers", multipliedAsIntegers],
];

function honest(label: string): void {
  console.log(label, plus(5), squared(5), parity(5), timesMinusOne(5), counted(5), indexed(1), rounded(5), multipliedAsIntegers(5));
}

(globalThis as any).note = (text: string) => log.push(text);
const hidden = (text: string): any => (0, eval)("(" + text + ")");

const texts = [
  "2",
  "0",
  "-0",
  "-1",
  "1.5",
  "-1.5",
  "0.9999999",
  "2147483647",
  "2147483648",
  "-2147483648",
  "-2147483649",
  "4294967295",
  "4294967296",
  "46341",
  "65536",
  "9007199254740992",
  "1e21",
  "NaN",
  "Infinity",
  "-Infinity",
  "'2'",
  "'0x10'",
  "'-0'",
  "''",
  "'two'",
  "2n",
  "null",
  "undefined",
  "true",
  "[2]",
  "{}",
  "{ valueOf() { note('valueOf'); return 2; } }",
  "{ [Symbol.toPrimitive](hint) { note(hint); return 2; } }",
  "{ valueOf() { note('valueOf'); return 2n; } }",
  "new Number(-0)",
  "Symbol()",
];

honest("honest before");
let warm = 0;
for (let i = 0; i < 2000; i++) for (const [, use] of uses) warm += use(i & 15) ?? 0;
for (let i = 0; i < 2000; i++) warm += squared(i & 255) + parity(i);
console.log("2000 honest rounds", warm);

for (const text of texts) {
  attempt("plus " + text, () => plus(hidden(text)));
  attempt("squared " + text, () => squared(hidden(text)));
  attempt("parity " + text, () => parity(hidden(text)));
  attempt("timesMinusOne " + text, () => timesMinusOne(hidden(text)));
  if (!/^(1e21|Infinity|\d{10,})$/.test(text)) attempt("counted " + text, () => counted(hidden(text)));
  attempt("indexed " + text, () => indexed(hidden(text)));
  attempt("rounded " + text, () => rounded(hidden(text)));
  attempt("multipliedAsIntegers " + text, () => multipliedAsIntegers(hidden(text)));
}

honest("honest after");
