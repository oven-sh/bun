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

interface Point {
  x: number;
  y: number;
}

class Store {
  count: number = 0;
  name: string = "store";
  items: number[] = [];
  at: Point = { x: 0, y: 0 };
  step: (n: number) => number = n => n + 1;
  ready: boolean = false;
  static shared: number = 1;

  bump(): number {
    return ++this.count;
  }
  title(): string {
    return this.name.toUpperCase() + this.name.length;
  }
  sum(): number {
    let result = 0;
    for (let i = 0; i < this.items.length; i++) result += this.items[i];
    return result;
  }
  add(n: number): number {
    return this.items.push(n);
  }
  where(): number {
    return this.at.x + this.at.y;
  }
  run(): number {
    return this.step(1) + 1;
  }
  state(): string {
    return this.ready ? "ready" : "waiting";
  }
}

function honest(label: string): void {
  const s = new Store();
  s.count = 4;
  s.items = [1, 2];
  s.at = { x: 1, y: 2 };
  console.log(label, s.bump(), s.title(), s.sum(), s.add(3), s.where(), s.run(), s.state(), Store.shared + 1);
}

honest("honest before");
const busy = new Store();
let warm = 0;
for (let i = 0; i < 2000; i++) {
  busy.items = [i];
  busy.at = { x: i, y: 1 };
  warm += busy.bump() + busy.title().length + busy.sum() + busy.add(1) + busy.where() + busy.run();
}
console.log("2000 honest rounds", warm);

function put(field: keyof Store, texts: string[], use: (s: Store) => unknown): void {
  for (const text of texts) {
    const direct = new Store();
    attempt(field + " = " + text, () => {
      const value: any = hidden(text);
      if (field === "count") direct.count = value;
      if (field === "name") direct.name = value;
      if (field === "items") direct.items = value;
      if (field === "at") direct.at = value;
      if (field === "step") direct.step = value;
      if (field === "ready") direct.ready = value;
      return use(direct);
    });
    attempt("  again", () => use(direct));
    const byName = new Store();
    attempt("  stored by a computed name", () => {
      (byName as any)[hidden("'" + field + "'")] = hidden(text);
      return use(byName);
    });
    const assigned = new Store();
    attempt("  stored by Object.assign", () => use(Object.assign(assigned, { [field]: hidden(text) })));
    const defined = new Store();
    attempt("  defined as a getter", () => {
      Object.defineProperty(defined, field, { get: () => (log.push("get"), hidden(text)), configurable: true });
      return use(defined);
    });
  }
}

put("count", ["5", "'5'", "5n", "-0", "2147483647", "null", "undefined", "{ valueOf() { note('valueOf'); return 5; } }"], s => s.bump());
put("name", ["'abc'", "5", "null", "['a']", "new String('abc')", "{ toUpperCase() { return 'UP'; }, length: -1 }"], s => s.title());
put("items", ["[1, 2]", "['1', '2']", "[1, , 2]", "'12'", "{ length: 2, 0: 1, 1: 2 }", "new Uint8Array([1, 2])", "null"], s => s.sum());
put("items", ["[1, 2]", "Object.freeze([1])", "{ push() { return 'own'; } }", "new (class extends Array { push() { return 42; } })()", "new Set()", "'12'"], s => s.add(3));
put("at", ["{ x: 1, y: 2 }", "{ y: 2, x: 1 }", "{ x: '1', y: 2 }", "{}", "null", "5", "[1, 2]"], s => s.where());
put("step", ["n => n * 2", "n => 'text'", "null", "class {}", "function (n) { return typeof this; }", "new Proxy(n => n, { apply() { return 9; } })"], s => s.run());
put("ready", ["true", "0", "''", "'false'", "null", "{}", "NaN"], s => s.state());

(Store as any).shared = hidden("'shared'");
attempt("a static field", () => Store.shared + 1);
Store.shared = 1;
attempt("a deleted field", () => {
  const s = new Store();
  delete (s as any).count;
  return [s.bump(), Object.keys(s).join()];
});
attempt("a field found on the prototype after deletion", () => {
  const s = new Store();
  delete (s as any).name;
  (Store.prototype as any).name = hidden("7");
  try {
    return s.title();
  } finally {
    delete (Store.prototype as any).name;
  }
});

honest("honest after");
