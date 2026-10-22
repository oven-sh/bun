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

function time(d: Date): number {
  return d.getTime() + 1;
}

function dateMath(d: Date): number {
  return +d + 1;
}

function matches(r: RegExp, text: string): boolean {
  return r.test(text);
}

function firstGroup(r: RegExp, text: string): string {
  const m = r.exec(text);
  return m === null ? "none" : m[0] + m.index;
}

function replaced(r: RegExp, text: string): string {
  return text.replace(r, "-");
}

function pieces(r: RegExp, text: string): number {
  return text.split(r).length;
}

function source(r: RegExp): string {
  return r.source + "/" + r.flags + "/" + r.lastIndex;
}

function messageOf(e: Error): string {
  return e.name + ":" + e.message;
}

function hostOf(u: URL): string {
  return u.host + u.pathname;
}

function honest(label: string): void {
  console.log(label, time(new Date(5)), dateMath(new Date(5)), matches(/a/, "cat"), firstGroup(/a/, "cat"), replaced(/a/g, "banana"), pieces(/a/, "banana"), source(/a/gi), messageOf(new RangeError("r")), hostOf(new URL("http://h.example/p")));
}

honest("honest before");
let warm = 0;
const pattern = /a/;
for (let i = 0; i < 2000; i++) warm += time(new Date(i)) + (matches(pattern, "cat") ? 1 : 0) + firstGroup(pattern, "cat").length + replaced(pattern, "cat").length + pieces(pattern, "cat");
console.log("2000 honest rounds", warm);

for (const text of ["new Date(5)", "new Date(NaN)", "5", "'5'", "{ getTime() { return 'own'; }, valueOf() { note('valueOf'); return 9; } }", "{ getTime: Date.prototype.getTime }", "Object.create(Date.prototype)", "new Proxy(new Date(5), {})", "new (class extends Date { getTime() { return 41; } [Symbol.toPrimitive]() { return 42; } })(5)", "Object.assign(new Date(5), { getTime() { return 'shadow'; } })", "Object.setPrototypeOf(new Date(5), null)", "null"]) {
  attempt("time " + text, () => time(hidden(text)));
  attempt("dateMath " + text, () => dateMath(hidden(text)));
}

const patterns = [
  "/a/",
  "/a/g",
  "/a/y",
  "/(?<n>a)/d",
  "'a'",
  "new String('a')",
  "{ test() { return 'own test'; }, exec() { note('own-exec'); return null; }, source: 's', flags: 'f', lastIndex: 'l' }",
  "{ exec() { note('own-exec'); return Object.assign(['x'], { index: 'i' }); }, test: RegExp.prototype.test }",
  "{ [Symbol.replace](text, by) { note('own-replace'); return 5; }, [Symbol.split]() { note('own-split'); return 'split'; } }",
  "Object.assign(/a/, { exec() { note('shadow-exec'); return null; } })",
  "Object.assign(/a/g, { lastIndex: 3 })",
  "Object.assign(/a/g, { lastIndex: { valueOf() { note('lastIndex'); return 0; } } })",
  "new (class extends RegExp { exec(s) { note('subclass-exec'); return super.exec(s); } test() { return 'subclass test'; } })('a')",
  "new (class extends RegExp { [Symbol.replace]() { return 'subclass replace'; } get flags() { note('flags'); return 'g'; } })('a')",
  "Object.create(RegExp.prototype)",
  "new Proxy(/a/, {})",
  "Object.setPrototypeOf(/a/, null)",
  "null",
  "undefined",
  "5",
];

for (const text of patterns) {
  attempt("matches " + text, () => matches(hidden(text), "banana"));
  attempt("firstGroup " + text, () => firstGroup(hidden(text), "banana"));
  attempt("replaced " + text, () => replaced(hidden(text), "banana"));
  attempt("pieces " + text, () => pieces(hidden(text), "banana"));
  attempt("source " + text, () => source(hidden(text)));
}

for (const text of ["'banana'", "5", "null", "undefined", "['a']", "{ toString() { note('toString'); return 'a'; } }", "Symbol()"]) {
  attempt("matches the text " + text, () => matches(/a|null|undefined|5/, hidden(text)));
  attempt("firstGroup the text " + text, () => firstGroup(/a|null|undefined|5/, hidden(text)));
  attempt("replaced the text " + text, () => replaced(/a/, hidden(text)));
}

for (const text of ["new Error('e')", "{ name: 5, message: null }", "{}", "'text'", "null", "Object.create(Error.prototype)", "new (class Mine extends Error { get message() { note('get-message'); return 'mine'; } })()", "new DOMException('d', 'AbortError')"]) {
  attempt("messageOf " + text, () => messageOf(hidden(text)));
}

for (const text of ["new URL('http://h.example/p')", "'http://h.example/p'", "{ host: 5, pathname: 6 }", "Object.create(URL.prototype)", "new Proxy(new URL('http://h.example/p'), {})", "null"]) {
  attempt("hostOf " + text, () => hostOf(hidden(text)));
}

honest("honest after");
