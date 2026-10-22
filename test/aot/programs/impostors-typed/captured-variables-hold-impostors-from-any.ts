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

function counter(start: number): { next: () => number; set: (value: number) => void } {
  let count: number = start;
  return {
    next: () => ++count,
    set: value => {
      count = value;
    },
  };
}

function keeper(first: string): { size: () => number; shout: () => string; set: (value: string) => void } {
  let text: string = first;
  return {
    size: () => text.length,
    shout: () => text.toUpperCase() + "!",
    set: value => {
      text = value;
    },
  };
}

function collector(first: number[]): { total: () => number; add: (n: number) => number; set: (value: number[]) => void } {
  let list: number[] = first;
  return {
    total: () => {
      let sum = 0;
      for (let i = 0; i < list.length; i++) sum += list[i];
      return sum;
    },
    add: n => list.push(n),
    set: value => {
      list = value;
    },
  };
}

function tracker(first: Point): { sum: () => number; move: () => void; set: (value: Point) => void } {
  let p: Point = first;
  return {
    sum: () => p.x + p.y,
    move: () => {
      p.x += 1;
    },
    set: value => {
      p = value;
    },
  };
}

function runner(first: (n: number) => number): { run: () => number; set: (value: (n: number) => number) => void } {
  let f = first;
  return { run: () => f(1) + 1, set: value => void (f = value) };
}

let moduleCount: number = 0;
let moduleName: string = "module";
function bumpModule(): number {
  return ++moduleCount + moduleName.length;
}

function honest(label: string): void {
  const c = counter(1);
  const k = keeper("ab");
  const l = collector([1, 2]);
  const t = tracker({ x: 1, y: 2 });
  const r = runner(n => n);
  t.move();
  moduleCount = 0;
  moduleName = "module";
  console.log(label, c.next(), c.next(), k.size(), k.shout(), l.total(), l.add(3), l.total(), t.sum(), r.run(), bumpModule());
}

honest("honest before");
const busyCounter = counter(0);
const busyList = collector([]);
let warm = 0;
for (let i = 0; i < 2000; i++) warm += busyCounter.next() + busyList.add(i) + bumpModule();
console.log("2000 honest rounds", warm, busyList.total());

for (const text of ["5", "'5'", "5n", "-0", "2147483647", "null", "undefined", "{ valueOf() { note('valueOf'); return 5; } }", "NaN", "1.5"]) {
  const started = counter(hidden(text));
  attempt("counter started with " + text, () => [started.next(), started.next()]);
  const changed = counter(1);
  changed.next();
  changed.set(hidden(text));
  attempt("counter set to " + text, () => [changed.next(), changed.next()]);
  attempt("module variable set to " + text, () => {
    moduleCount = hidden(text);
    return [bumpModule(), bumpModule()];
  });
}
moduleCount = 0;

for (const text of ["'abc'", "5", "null", "undefined", "['a']", "new String('abc')", "{ length: 1, toUpperCase() { return 5; } }"]) {
  const changed = keeper("ab");
  changed.size();
  changed.set(hidden(text));
  attempt("keeper set to " + text + ": size", () => changed.size());
  attempt("keeper set to " + text + ": shout", () => changed.shout());
  attempt("module name set to " + text, () => {
    moduleName = hidden(text);
    return bumpModule();
  });
}
moduleName = "module";

for (const text of ["[1, 2]", "['1', '2']", "[1, , 2]", "'12'", "{ length: 1, 0: 4 }", "new Uint8Array([1])", "null", "Object.freeze([1])", "new (class extends Array { push() { return 42; } })(1, 2)"]) {
  const changed = collector([1]);
  changed.total();
  changed.set(hidden(text));
  attempt("collector set to " + text + ": total", () => changed.total());
  attempt("collector set to " + text + ": add", () => changed.add(3));
  attempt("collector set to " + text + ": total again", () => changed.total());
}

for (const text of ["{ x: 1, y: 2 }", "{ y: 2, x: 1 }", "{ x: '1', y: 2 }", "{}", "null", "5", "Object.freeze({ x: 1, y: 2 })", "{ get x() { note('get-x'); return 1; }, set x(v) { note('set-x'); }, y: 2 }"]) {
  const changed = tracker({ x: 0, y: 0 });
  changed.sum();
  changed.set(hidden(text));
  attempt("tracker set to " + text + ": sum", () => changed.sum());
  attempt("tracker set to " + text + ": move", () => changed.move());
  attempt("tracker set to " + text + ": sum again", () => changed.sum());
}

for (const text of ["n => n * 2", "n => 'text'", "null", "class {}", "new Proxy(n => n, { apply() { return 9; } })"]) {
  const changed = runner(n => n);
  changed.run();
  changed.set(hidden(text));
  attempt("runner set to " + text, () => changed.run());
}

honest("honest after");
