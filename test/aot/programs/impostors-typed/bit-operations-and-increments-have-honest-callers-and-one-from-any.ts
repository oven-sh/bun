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

function truncated(n: number): number {
  return n | 0;
}

function unsigned(n: number): number {
  return n >>> 0;
}

function shifted(n: number): number {
  return (n << 1) + (n >> 1);
}

function masked(n: number): number {
  return n & 255;
}

function flipped(n: number): number {
  return ~n;
}

function next(n: number): number {
  n++;
  return n;
}

function previous(n: number): number {
  return --n;
}

function negated(n: number): number {
  return -n;
}

const uses: [string, (n: number) => number | undefined][] = [
  ["truncated", truncated],
  ["unsigned", unsigned],
  ["shifted", shifted],
  ["masked", masked],
  ["flipped", flipped],
  ["next", next],
  ["previous", previous],
  ["negated", negated],
];

function honest(label: string): void {
  console.log(label, truncated(5), unsigned(5), shifted(5), masked(300), flipped(5), next(5), previous(5), negated(5));
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
for (let i = 0; i < 2000; i++) warm += truncated(i) + next(i) + negated(i + 1);
console.log("2000 honest rounds", warm);

for (const text of texts) {
  attempt("truncated " + text, () => truncated(hidden(text)));
  attempt("unsigned " + text, () => unsigned(hidden(text)));
  attempt("shifted " + text, () => shifted(hidden(text)));
  attempt("masked " + text, () => masked(hidden(text)));
  attempt("flipped " + text, () => flipped(hidden(text)));
  attempt("next " + text, () => next(hidden(text)));
  attempt("previous " + text, () => previous(hidden(text)));
  attempt("negated " + text, () => negated(hidden(text)));
}

honest("honest after");
