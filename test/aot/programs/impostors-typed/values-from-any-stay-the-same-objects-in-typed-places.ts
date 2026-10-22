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

interface Line {
  from: Point;
  to: Point;
  tags: string[];
}

class Holder {
  point: Point;
  constructor(point: Point) {
    this.point = point;
  }
}

function same(p: Point): Point {
  return p;
}

function move(p: Point): void {
  p.x += 10;
}

function grow(list: number[]): void {
  list.push(99);
}

const keep: { original: any } = { original: null };
(globalThis as any).keep = keep;

function fresh(text: string): any {
  keep.original = hidden(text);
  return keep.original;
}

const objects = ["{ x: 1, y: 2 }", "{ y: 2, x: 1 }", "{ x: 1, y: 2, z: 3 }", "{ x: '1', y: 2 }", "{ x: 1 }", "Object.create({ x: 1, y: 2 })", "Object.freeze({ x: 1, y: 2 })", "new (class P { x = 1; y = 2; })()", "Object.assign([], { x: 1, y: 2 })", "Object.assign(() => 1, { x: 1, y: 2 })", "new Proxy({ x: 1, y: 2 }, {})"];

for (const text of objects) {
  attempt("identity " + text, () => {
    const local: Point = fresh(text);
    const cast = keep.original as Point;
    const list: Point[] = [keep.original];
    const holder = new Holder(keep.original);
    const literal: { p: Point } = { p: keep.original };
    const captured = () => local;
    const map = new Map<string, Point>([["k", keep.original]]);
    return [local === keep.original, cast === local, same(local) === keep.original, list[0] === keep.original, holder.point === keep.original, literal.p === keep.original, captured() === keep.original, map.get("k") === keep.original, list.includes(local), list.indexOf(keep.original)];
  });
  attempt("a typed store is seen outside " + text, () => {
    const local: Point = fresh(text);
    move(local);
    local.y = -1;
    return [keep.original.x, keep.original.y, JSON.stringify(keep.original), Object.keys(keep.original).join()];
  });
  attempt("an outside store is seen in typed code " + text, () => {
    const local: Point = fresh(text);
    const holder = new Holder(local);
    hidden("keep.original.x = 'changed outside'");
    hidden("keep.original.extra = true");
    return [local.x, holder.point.x, same(local).x, Object.keys(local).join()];
  });
}

attempt("nested objects", () => {
  const line: Line = fresh("{ from: { x: 1, y: 2 }, to: { x: 3, y: 4 }, tags: ['a'] }");
  const from = line.from;
  move(from);
  line.tags.push("b");
  line.to = line.from;
  return [from === keep.original.from, keep.original.from.x, keep.original.tags.join(), keep.original.to === keep.original.from, line.tags === keep.original.tags];
});
attempt("one object reached twice", () => {
  const line: Line = fresh("(() => { const p = { x: 1, y: 2 }; return { from: p, to: p, tags: [] }; })()");
  move(line.from);
  return [line.from === line.to, line.to.x];
});
attempt("an object that contains itself", () => {
  interface Loop {
    self: Loop;
    n: number;
  }
  const loop: Loop = fresh("(() => { const o = { n: 1 }; o.self = o; return o; })()");
  loop.self.self.n = 5;
  return [loop.self === loop, loop.n, keep.original.n];
});
for (const text of ["[1, 2]", "['1', 2]", "[1, , 3]", "new (class L extends Array {})(1, 2)", "Object.assign([1, 2], { extra: 1 })"]) {
  attempt("lists " + text, () => {
    const list: number[] = fresh(text);
    grow(list);
    list[0] = -1;
    hidden("keep.original.push('outside')");
    return [list === keep.original, list.length, keep.original.length, list, Object.keys(list).join()];
  });
}
attempt("JSON.parse keeps one object", () => {
  const parsed = JSON.parse('{"x":1,"y":2}');
  const a: Point = parsed;
  const b: Point = parsed;
  move(a);
  return [a === b, b.x, parsed.x, a === parsed];
});
attempt("as keys of a WeakMap and members of a Set", () => {
  const w = new WeakMap<object, string>();
  const s = new Set<Point>();
  const raw = fresh("{ x: 1, y: 2 }");
  w.set(raw, "found");
  s.add(raw);
  const typed: Point = raw;
  return [w.get(typed), s.has(typed), w.get(same(typed)), s.has(new Holder(typed).point)];
});
attempt("a typed object goes out and comes back", () => {
  const mine: Point = { x: 1, y: 2 };
  const back: Point = hidden("o => o")(mine);
  const changed: Point = hidden("o => { o.x = 'outside'; o.z = 3; delete o.y; return o; }")(mine);
  return [back === mine, changed === mine, mine.x, mine.y, Object.keys(mine).join(), JSON.stringify(mine)];
});
attempt("a typed instance goes out and comes back", () => {
  const mine = new Holder({ x: 1, y: 2 });
  const back: Holder = hidden("o => { o.point = { x: 'swapped' }; o.added = 1; return o; }")(mine);
  return [back === mine, mine.point.x, mine.point.y, Object.keys(mine).join(), back instanceof Holder];
});
attempt("a typed list goes out and comes back", () => {
  const mine: number[] = [1, 2, 3];
  const back: number[] = hidden("l => { l[1] = 'outside'; l.length = 2; return l; }")(mine);
  return [back === mine, mine, mine.length];
});
attempt("functions", () => {
  const f = (n: number): number => n + 1;
  const back: (n: number) => number = hidden("f => f")(f);
  const raw = fresh("n => n * 2");
  const typed: (n: number) => number = raw;
  return [back === f, typed === keep.original, typed(2), back(2)];
});
