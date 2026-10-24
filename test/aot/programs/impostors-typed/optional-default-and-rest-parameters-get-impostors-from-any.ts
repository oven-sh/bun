function show(value: unknown): string {
  if (typeof value === "number") return Object.is(value, -0) ? "-0" : String(value);
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "bigint") return value + "n";
  if (value === null || value === undefined) return String(value);
  if (typeof value === "boolean") return String(value);
  if (Array.isArray(value)) {
    const parts: string[] = [];
    for (let i = 0; i < value.length; i++) parts.push(i in value ? show(value[i]) : "hole");
    return "[" + parts.join(", ") + "]";
  }
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

(globalThis as any).note = (text: string) => log.push(text);
const hidden = (text: string): any => (0, eval)("(" + text + ")");

function withDefault(n: number = 5): number {
  return n + 1;
}

function withOptional(n?: number): number {
  return n === undefined ? -1 : n + 1;
}

function withLaterDefault(a: number, b: number = a * 2): number {
  return a + b;
}

function withDefaultText(s: string = "none"): number {
  return s.length;
}

function withDefaultList(list: number[] = []): number {
  return list.push(1);
}

function rest(...values: number[]): number {
  let sum = 0;
  for (let i = 0; i < values.length; i++) sum += values[i];
  return sum;
}

function firstAndRest(first: string, ...others: number[]): string {
  return first + ":" + others.length + ":" + others.map(v => v + 1).join();
}

function counted(a: number, b?: number, c?: number): number {
  return arguments.length;
}

function nullable(n: number | null): number {
  return n === null ? -1 : n + 1;
}

function coalesced(n?: number | null): number {
  return (n ?? 10) + 1;
}

function honest(label: string): void {
  console.log(label, withDefault(), withDefault(1), withOptional(), withOptional(1), withLaterDefault(1), withLaterDefault(1, 1), withDefaultText(), withDefaultText("ab"), withDefaultList(), withDefaultList([1]), rest(), rest(1, 2), rest(...[1, 2, 3]), firstAndRest("f", 1, 2), counted(1), counted(1, 2, 3), nullable(null), nullable(1), coalesced(), coalesced(null), coalesced(1));
}

honest("honest before");
let warm = 0;
for (let i = 0; i < 2000; i++) warm += withDefault(i) + withDefault() + withOptional(i) + withLaterDefault(i) + withDefaultText("a") + rest(i, 1) + rest(...[i]) + counted(i) + nullable(i) + coalesced(i);
console.log("2000 honest rounds", warm);

const values = ["3", "'3'", "3n", "-0", "0", "NaN", "''", "false", "null", "undefined", "void 0", "[]", "{}", "{ valueOf() { note('valueOf'); return 3; } }"];

for (const text of values) {
  attempt("withDefault " + text, () => withDefault(hidden(text)));
  attempt("withOptional " + text, () => withOptional(hidden(text)));
  attempt("withLaterDefault first " + text, () => withLaterDefault(hidden(text)));
  attempt("withLaterDefault second " + text, () => withLaterDefault(1, hidden(text)));
  attempt("withDefaultText " + text, () => withDefaultText(hidden(text)));
  attempt("withDefaultList " + text, () => withDefaultList(hidden(text)));
  attempt("rest " + text, () => rest(1, hidden(text), 2));
  attempt("firstAndRest " + text, () => firstAndRest(hidden(text), hidden(text)));
  attempt("counted " + text, () => counted(1, hidden(text)));
  attempt("nullable " + text, () => nullable(hidden(text)));
  attempt("coalesced " + text, () => coalesced(hidden(text)));
}

for (const text of ["[1, 2]", "['1', '2']", "[1, , 3]", "'12'", "new Set([1, 2])", "new Uint8Array([1, 2])", "{ length: 2, 0: 1, 1: 2 }", "(function* () { yield 1; yield '2'; })()", "new Map([[1, 2]])", "null", "5", "[]"]) {
  attempt("rest spread of " + text, () => rest(...hidden(text)));
  attempt("rest spread after one " + text, () => rest(10, ...hidden(text)));
  attempt("rest by apply " + text, () => rest.apply(undefined, hidden(text)));
  attempt("counted spread of " + text, () => (counted as any)(...hidden(text)));
  attempt("withLaterDefault spread of " + text, () => (withLaterDefault as any)(...hidden(text)));
}

const loose: any = { withDefault, withOptional, rest, counted };
attempt("too many arguments", () => loose.withDefault(1, 2, 3));
attempt("no arguments where one is required", () => (nullable as any)());
attempt("counted with five", () => loose.counted(1, 2, 3, 4, 5));
attempt("counted with none", () => loose.counted());
attempt("length of the functions", () => [withDefault.length, withOptional.length, withLaterDefault.length, rest.length, firstAndRest.length, counted.length]);

honest("honest after");
