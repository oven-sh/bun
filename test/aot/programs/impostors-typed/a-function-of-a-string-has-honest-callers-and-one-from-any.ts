function show(value: unknown): string {
  if (typeof value === "number") return Object.is(value, -0) ? "-0" : String(value);
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "bigint") return value + "n";
  if (value === null || value === undefined) return String(value);
  if (typeof value === "boolean") return String(value);
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

function code(s: string): number {
  return s.charCodeAt(0);
}

function letters(s: string): number {
  let count = 0;
  for (const letter of s) count += letter.length;
  return count;
}

function chosen(s: string): number {
  switch (s) {
    case "abc":
      return 1;
    case "1":
      return 2;
    default:
      return 3;
  }
}

function hash(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return h;
}

function honest(label: string): void {
  const kept = "abc";
  const built = ["a", "bc"].join("");
  console.log(label, code("abc"), code(kept), code(built), letters(kept), chosen(built), chosen("1"), hash(kept), hash(built + built));
}

(globalThis as any).note = (text: string) => log.push(text);
const hidden = (text: string): any => (0, eval)("(" + text + ")");

const texts = [
  "'abc'",
  "''",
  "'a' + ['b', 'c'].join('')",
  "'\\u0100bc'",
  "'\\ud83d\\ude00'",
  "'\\ud83d'",
  "new String('abc')",
  "Object.assign(new String('abc'), { length: 9, charCodeAt() { return -1; } })",
  "{ charCodeAt() { return -1; }, length: 2, 0: 'zero', slice() { return 7; }, indexOf() { return 'where'; }, includes() { return 'holds'; }, toUpperCase() { return 8; }, at() { return 9; }, toString() { note('toString'); return 'abc'; } }",
  "{ toString() { note('toString'); return 'abc'; } }",
  "{ valueOf() { note('valueOf'); return 'abc'; } }",
  "{ valueOf() { note('valueOf'); return 'v'; }, toString() { note('toString'); return 't'; } }",
  "{ [Symbol.toPrimitive](hint) { note(hint); return 'abc'; } }",
  "{ [Symbol.toPrimitive]() { return {}; } }",
  "['a', 'b', 'c']",
  "['abc']",
  "[]",
  "Buffer.from('abc')",
  "new Uint8Array([97, 98])",
  "new Proxy(new String('abc'), {})",
  "/abc/",
  "function abc() {}",
  "1",
  "-0",
  "NaN",
  "1n",
  "true",
  "Symbol('abc')",
  "null",
  "undefined",
  "{}",
];

honest("honest before");
let warm = 0;
for (let i = 0; i < 2000; i++) warm += code("k" + i) + letters("ab") + chosen(i % 2 ? "abc" : "1") + (hash("x" + i) & 7);
console.log("2000 honest rounds", warm);

for (const text of texts) {
  attempt("code " + text, () => code(hidden(text)));
  attempt("letters " + text, () => letters(hidden(text)));
  attempt("chosen " + text, () => chosen(hidden(text)));
  attempt("hash " + text, () => hash(hidden(text)));
}

honest("honest after");

console.log("bytes made in plain sight", Buffer.from("he").length);
