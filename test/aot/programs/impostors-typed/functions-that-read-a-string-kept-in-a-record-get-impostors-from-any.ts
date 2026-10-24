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

const table: Record<string, number> = { abc: 1, "1": 2, undefined: 3, null: 4, "a,b,c": 5 };

const uses: Record<string, (s: string) => unknown> = {
  code: (s: string): number => s.charCodeAt(0),
  size: (s: string): number => s.length,
  head: (s: string): string => s[0],
  tail: (s: string): string => s.slice(1),
  where: (s: string): number => s.indexOf("b"),
  holds: (s: string): boolean => s.includes("b"),
  shout: (s: string): string => s.toUpperCase(),
  glued: (s: string): string => s + "!",
  prefixed: (s: string): string => "!" + s,
};

function honest(label: string): void {
  const kept = "abc";
  console.log(label, Object.keys(uses).map(name => show(uses[name](kept))).join(" "));
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
for (let i = 0; i < 2000; i++) for (const name of Object.keys(uses)) warm += show(uses[name]("k" + i)).length;
console.log("2000 honest rounds", warm);

for (const text of texts) {
  for (const name of Object.keys(uses)) attempt(name + " " + text, () => uses[name](hidden(text)));
}

honest("honest after");

console.log("bytes made in plain sight", Buffer.from("he").length);
