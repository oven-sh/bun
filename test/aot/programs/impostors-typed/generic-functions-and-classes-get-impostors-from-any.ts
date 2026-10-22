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

class Box<T> {
  constructor(public value: T) {}
  get(): T {
    return this.value;
  }
  map<U>(f: (value: T) => U): Box<U> {
    return new Box(f(this.value));
  }
}

function identity<T>(value: T): T {
  return value;
}

function firstOf<T>(list: T[]): T {
  return list[0];
}

function pick<T, K extends keyof T>(object: T, key: K): T[K] {
  return object[key];
}

function withId<T extends { id: number }>(value: T): number {
  return value.id + 1;
}

function longest<T extends { length: number }>(a: T, b: T): T {
  return a.length >= b.length ? a : b;
}

function half(n: number): number {
  return n / 2;
}

function size(s: string): number {
  return s.length;
}

function honest(label: string): void {
  console.log(label, half(new Box(4).get()), size(new Box("ab").get()), half(identity(4)), size(identity("ab")), half(firstOf([4])), half(pick({ n: 4, s: "ab" }, "n")), size(pick({ n: 4, s: "ab" }, "s")), withId({ id: 1 }), longest("ab", "c"), half(new Box("ab").map(size).get()));
}

honest("honest before");
let warm = 0;
for (let i = 0; i < 2000; i++) warm += half(new Box(i).get()) + size(new Box("a").get()) + half(identity(i)) + half(firstOf([i])) + half(pick({ n: i }, "n")) + withId({ id: i });
console.log("2000 honest rounds", warm);

const values = ["4", "'4'", "4n", "-0", "null", "undefined", "[4]", "{ valueOf() { note('valueOf'); return 4; } }", "'abc'", "['a', 'b']", "{ length: 'long' }"];

for (const text of values) {
  attempt("Box<number> holds " + text, () => half(new Box<number>(hidden(text)).get()));
  attempt("Box<number> field " + text, () => half(new Box<number>(hidden(text)).value));
  attempt("Box<string> holds " + text, () => size(new Box<string>(hidden(text)).get()));
  attempt("identity<number> " + text, () => half(identity<number>(hidden(text))));
  attempt("identity<string> " + text, () => size(identity<string>(hidden(text))));
  attempt("firstOf<number> " + text, () => half(firstOf<number>([hidden(text)])));
  attempt("pick a number " + text, () => half(pick<{ n: number }, "n">({ n: hidden(text) }, "n")));
  attempt("mapped to " + text, () => half(new Box(1).map((): number => hidden(text)).get()));
  attempt("stored later " + text, () => {
    const box = new Box(1);
    box.value = hidden(text);
    return half(box.get()) + box.value;
  });
}

for (const text of ["{ id: 1 }", "{ id: '1' }", "{}", "{ get id() { note('get-id'); return 1; } }", "null", "5", "[1]", "Object.create({ id: 1 })"]) attempt("withId " + text, () => withId(hidden(text)));

for (const text of ["'abc'", "[1, 2, 3]", "{ length: 3 }", "{ length: '3' }", "function (a, b, c) {}", "5", "null", "new Set([1, 2, 3])"]) {
  attempt("longest " + text, () => show(longest(hidden(text), "ab")));
  attempt("longest the other way " + text, () => show(longest("ab", hidden(text))));
}

for (const text of ["'n'", "'s'", "'missing'", "'toString'", "0", "null", "Symbol.iterator"]) attempt("pick by " + text, () => show(pick({ n: 4, s: "ab" }, hidden(text))));

attempt("the list is an impostor", () => half(firstOf<number>(hidden("'48'"))));
attempt("the list is an array-like", () => half(firstOf<number>(hidden("{ 0: 8 }"))));
attempt("the box is an impostor", () => half(Box.prototype.get.call(hidden("{ value: '8' }")) as number));
attempt("boxes of several kinds in one array", () => {
  const boxes: Box<number>[] = [new Box(1), new Box<any>("2"), new Box(3.5), new Box<any>(null), hidden("{ value: 7, get() { return 'own'; } }")];
  return boxes.map(box => box.get() + 1);
});

honest("honest after");
