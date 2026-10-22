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

type Scores = Record<string, number>;

function score(scores: Scores, name: string): number {
  return scores[name] + 1;
}

function sumScores(scores: Scores): number {
  let sum = 0;
  for (const name in scores) sum += scores[name];
  return sum;
}

function names(scores: Scores): string {
  return Object.keys(scores).join();
}

function values(scores: Scores): number {
  return Object.values(scores).reduce((a, b) => a + b, 0);
}

function entries(scores: Scores): string {
  return Object.entries(scores)
    .map(([name, value]) => name + "=" + (value + 1))
    .join();
}

function record(scores: Scores, name: string, value: number): string {
  scores[name] = value;
  return Object.keys(scores).join() + "|" + typeof scores[name];
}

function forget(scores: Scores, name: string): boolean {
  return delete scores[name];
}

function known(scores: Scores, name: string): boolean {
  return name in scores;
}

function byNumber(list: { [index: number]: string }, index: number): number {
  return list[index].length;
}

function honest(label: string): void {
  const scores: Scores = { b: 2, a: 1 };
  console.log(label, score(scores, "a"), sumScores(scores), names(scores), values(scores), entries(scores), record(scores, "c", 3), forget(scores, "b"), known(scores, "b"), byNumber(["ab"], 0), byNumber({ 1: "abc" }, 1));
}

honest("honest before");
const busy: Scores = { a: 1 };
let warm = 0;
for (let i = 0; i < 2000; i++) warm += score(busy, "a") + sumScores(busy) + values(busy) + record(busy, "k" + (i & 3), i).length;
console.log("2000 honest rounds", warm);

const records = [
  "{ a: 1, b: 2 }",
  "{ b: 2, a: 1 }",
  "{ a: '1', b: 2 }",
  "{ a: null }",
  "{ 2: 2, 1: 1, a: 0 }",
  "{ a: 1, [Symbol('s')]: 2 }",
  "{ get a() { note('get-a'); return 1; } }",
  "Object.create({ a: 1, inherited: 5 })",
  "Object.assign(Object.create(null), { a: 1 })",
  "Object.defineProperty({ b: 2 }, 'a', { value: 1 })",
  "Object.freeze({ a: 1 })",
  "new Proxy({ a: 1 }, { get(t, k) { note('get:' + String(k)); return t[k]; }, has(t, k) { note('has:' + String(k)); return k in t; }, ownKeys(t) { note('ownKeys'); return Reflect.ownKeys(t); }, getOwnPropertyDescriptor(t, k) { note('describe:' + String(k)); return Reflect.getOwnPropertyDescriptor(t, k); }, set(t, k, v) { note('set:' + String(k)); t[k] = v; return true; }, deleteProperty(t, k) { note('delete:' + String(k)); return delete t[k]; } })",
  "[1, 2]",
  "'ab'",
  "new Map([['a', 1]])",
  "new (class { a = 1; b() {} })()",
  "function a() {}",
  "5",
  "null",
  "undefined",
];

for (const text of records) {
  attempt("score " + text, () => score(hidden(text), "a"));
  attempt("sumScores " + text, () => sumScores(hidden(text)));
  attempt("names " + text, () => names(hidden(text)));
  attempt("values " + text, () => values(hidden(text)));
  attempt("entries " + text, () => entries(hidden(text)));
  attempt("record " + text, () => record(hidden(text), "c", 3));
  attempt("forget " + text, () => forget(hidden(text), "a"));
  attempt("known " + text, () => known(hidden(text), "a"));
}

for (const text of ["'a'", "'missing'", "'constructor'", "'__proto__'", "'toString'", "'hasOwnProperty'", "0", "-0", "1.5", "null", "undefined", "Symbol.iterator", "['a']", "{ toString() { note('toString'); return 'a'; } }"]) {
  attempt("score under " + text, () => score({ a: 1, "0": 5, null: 6, undefined: 7, "1.5": 8 }, hidden(text)));
  attempt("record under " + text, () => record({ a: 1 }, hidden(text), 2));
  attempt("known under " + text, () => known({ a: 1 }, hidden(text)));
  attempt("forget under " + text, () => forget({ a: 1 }, hidden(text)));
}

for (const text of ["2", "'2'", "undefined", "{}", "-0"]) attempt("record the value " + text, () => {
  const scores: Scores = { a: 1 };
  record(scores, "b", hidden(text));
  return [sumScores(scores), values(scores), entries(scores)];
});

for (const text of ["['ab']", "'ab'", "{ 0: 'ab' }", "{ 0: 5 }", "[]", "new Uint8Array(1)", "null"]) attempt("byNumber " + text, () => byNumber(hidden(text), 0));
for (const text of ["0", "'0'", "-0", "0.5", "-1", "'length'", "null"]) attempt("byNumber at " + text, () => byNumber(["ab"], hidden(text)));

honest("honest after");
