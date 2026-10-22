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

type Constructor<T = object> = new (...args: any[]) => T;

function Tagged<B extends Constructor>(Base: B) {
  return class Tagged extends Base {
    tag = "tagged";
    describe(): string {
      return this.tag + ":" + Object.keys(this).join();
    }
  };
}

function Counted<B extends Constructor>(Base: B) {
  return class Counted extends Base {
    count: number;
    constructor(...args: any[]) {
      super(...args);
      this.count = args.length;
    }
    next(): number {
      return ++this.count;
    }
  };
}

class Point {
  x: number;
  y = 2;
  constructor(x: number = 1) {
    this.x = x;
  }
  sum(): number {
    return this.x + this.y;
  }
}

class Empty {}

function honest(label: string): void {
  const TaggedPoint = Tagged(Point);
  const Both = Counted(Tagged(Point));
  const p = new TaggedPoint(5);
  const b = new Both(7);
  console.log(label, p.describe(), p.sum(), b.describe(), b.next(), b.sum(), new (Tagged(Empty))().describe(), p instanceof Point, b instanceof TaggedPoint);
}

honest("honest before");
let warm = 0;
const Warm = Counted(Tagged(Point));
for (let i = 0; i < 2000; i++) {
  const w = new Warm(i);
  warm += w.sum() + w.next() + w.describe().length;
}
console.log("2000 honest rounds", warm);

const bases = [
  "class Base { constructor(a) { this.first = a; this.second = 2; } hello() { return 'hello'; } }",
  "class Base { tag = 'base tag'; count = 'base count'; }",
  "class Base { get tag() { return 'getter'; } set tag(v) { note('set-tag:' + v); } set count(v) { note('set-count:' + v); } }",
  "class Base { constructor() { return { replaced: true }; } }",
  "class Base { constructor() { return new Proxy(this, { defineProperty(t, k, d) { note('define:' + String(k)); return Reflect.defineProperty(t, k, d); }, set(t, k, v, r) { note('set:' + String(k)); return Reflect.set(t, k, v, r); } }); } }",
  "class Base { constructor() { return Object.freeze(this); } }",
  "class Base { constructor() { return Object.preventExtensions(this); } }",
  "class Base { constructor() { note('new.target:' + new.target.name); note('keys:' + Object.keys(this).length); } }",
  "class Base { constructor() { throw new RangeError('no'); } }",
  "function Base(a) { this.es5 = a; }",
  "function Base() { return [1, 2]; }",
  "(function Base(a) { this.bound = a; }).bind(null, 'preset')",
  "new Proxy(class Base { constructor() { this.inner = 1; } }, { construct(t, args, nt) { note('construct'); return Reflect.construct(t, args, nt); } })",
  "Array",
  "Map",
  "Error",
  "Object",
  "Date",
  "Promise",
  "Uint8Array",
  "Function",
  "class Base extends Array { constructor() { super(); this.push(9); } }",
  "() => {}",
  "null",
  "5",
  "{}",
];

for (const text of bases) {
  attempt("Tagged " + text, () => {
    const Made = Tagged(hidden(text));
    const made = new Made(1);
    return [made.describe(), made.tag, Reflect.ownKeys(made).map(String).join()];
  });
  attempt("Counted " + text, () => {
    const Made = Counted(hidden(text));
    const made = new Made(1);
    return [made.next(), made.count, Object.keys(made).join()];
  });
}

attempt("inherited members of an unseen base", () => {
  const Made = Tagged(hidden(bases[0]));
  const made: any = new Made("a");
  return [made.hello(), made.first, made.second, made instanceof Made];
});
attempt("the same mixin over two bases keeps them apart", () => {
  const A = Tagged(Point);
  const B = Tagged(hidden(bases[0]));
  return [new A(1).describe(), new B(1).describe(), new A(1).describe(), A === B, A.name, B.name];
});
attempt("static members are inherited", () => {
  const Made: any = Tagged(hidden("class Base { static kind = 'static'; static make() { return new this(); } }"));
  return [Made.kind, Made.make().describe()];
});

honest("honest after");
