// The instance of a class that extends a built-in class is an object of the built-in class, and its own fields are ordinary properties of it. Number, string and object fields, methods, getters,
// private fields and a second level on subclasses of Error, Array, Map, Set, Uint8Array and Promise, read again after 2,000 instances and a collection.
const print = (value: unknown): void => console.log(String(value));
const gc = (): void => Bun.gc(true);
{
  class Failure extends Error {
    code: number;
    detail: string;
    info: { a: number };
    #secret = 41;
    constructor(m: string) {
      super(m);
      this.code = 7;
      this.detail = "d" + m;
      this.info = { a: 3 };
    }
    describe() { return this.detail + ":" + this.code + ":" + this.info.a; }
    get twice() { return this.code * 2; }
    secret() { return this.#secret + 1; }
  }
  class Deeper extends Failure {
    level = 2;
    constructor(m: string) { super(m + "!"); this.code = 9; }
    describe() { return "deep " + super.describe() + ":" + this.level; }
  }
  const f = new Failure("boom");
  print(f.code);
  print(f.detail);
  print(f.info.a);
  print(f.describe());
  print(f.twice);
  print(f.secret());
  print(f instanceof Failure);
  print(f instanceof Error);
  print(f instanceof Deeper);
  const d = new Deeper("x");
  print(d.code);
  print(d.level);
  print(d.describe());
  print(d.twice);
  print(d.secret());
  print(d instanceof Deeper);
  print(d instanceof Failure);
  print(d instanceof Error);
  const k = Object.keys(f);
  print(k.length);
  for (let i = 0; i < k.length; i++) print(k[i]);
  const k2 = Object.keys(d);
  print(k2.length);
  for (let i = 0; i < k2.length; i++) print(k2[i]);
  try { throw new Deeper("t"); } catch (e) { print(e instanceof Failure ? e.describe() : "no"); }
  const all: Failure[] = [];
  for (let i = 0; i < 2000; i++) all.push(i & 1 ? new Failure("m" + i) : new Deeper("n" + i));
  gc();
  let sum = 0;
  for (let i = 0; i < all.length; i++) sum += all[i].code + all[i].detail.length + all[i].info.a + all[i].secret();
  print(sum);
}
{
  class List extends Array<number> {
    tag: string;
    size: number;
    box: { v: number };
    #hidden = 5;
    constructor() {
      super();
      this.tag = String(Math.random()).length > 0 ? "t" : "u";
      this.size = 1.5;
      this.box = { v: 9 };
    }
    total() { let s = 0; for (let i = 0; i < this.length; i++) s += this[i]; return s + this.size; }
    get label() { return this.tag + this.length; }
    hidden() { return this.#hidden; }
    bump() { this.#hidden++; return this; }
  }
  class Longer extends List {
    extra = "x";
    total() { return super.total() * 2; }
  }
  const l = new List();
  print(l.length);
  l.push(5); l.push(6);
  l[2] = 7;
  print(l.length);
  print(l[0] + l[1] + l[2]);
  print(l.tag);
  print(l.size);
  print(l.box.v);
  print(l.total());
  print(l.label);
  print(l.hidden());
  print(l.bump().hidden());
  print(l instanceof List);
  print(l instanceof Array);
  print(l instanceof Longer);
  print(Array.isArray(l));
  const k = Object.keys(l);
  print(k.length);
  for (let i = 0; i < k.length; i++) print(k[i]);
  print(JSON.stringify(l));
  const m = new Longer();
  m.push(1);
  print(m.total());
  print(m.extra);
  print(m.label);
  print(m instanceof Longer);
  print(m instanceof List);
  const k2 = Object.keys(m);
  for (let i = 0; i < k2.length; i++) print(k2[i]);
  l.length = 1;
  print(l.length);
  print(l[1]);
  const all: List[] = [];
  for (let i = 0; i < 2000; i++) { const x = i & 1 ? new List() : new Longer(); x.push(i); all.push(x); }
  gc();
  let sum = 0;
  for (let i = 0; i < all.length; i++) sum += all[i].total() + all[i].tag.length + all[i].box.v + all[i].hidden() + all[i].length;
  print(sum);
}
{
  class Registry extends Map<string, number> {
    hits = 0;
    name: string;
    meta: { kind: string };
    #count = 0;
    constructor(name: string) { super(); this.name = name; this.meta = { kind: "k" + name }; }
    add(k: string, v: number) { this.#count++; this.set(k, v); return this; }
    lookup(k: string) { this.hits++; return this.get(k); }
    get count() { return this.#count; }
  }
  class Deep extends Registry {
    depth = 2;
    lookup(k: string) { return (super.lookup(k) ?? -1) + this.depth; }
  }
  class Bag extends Set<number> {
    label = "bag";
    weight = 0.5;
    put(n: number) { this.add(n); this.weight += n; return this.size; }
  }
  const r = new Registry("a");
  r.add("x", 1).add("y", 2);
  print(r.size);
  print(r.lookup("x"));
  print(r.lookup("z"));
  print(r.hits);
  print(r.name);
  print(r.meta.kind);
  print(r.count);
  print(r instanceof Registry);
  print(r instanceof Map);
  print(r instanceof Deep);
  let ks = Object.keys(r);
  print(ks.length);
  for (let i = 0; i < ks.length; i++) print(ks[i]);
  print(JSON.stringify(r));
  const d = new Deep("b");
  d.add("q", 40);
  print(d.lookup("q"));
  print(d.lookup("none"));
  print(d.hits);
  print(d.depth);
  print(d instanceof Registry);
  ks = Object.keys(d);
  for (let i = 0; i < ks.length; i++) print(ks[i]);
  const b = new Bag();
  print(b.put(3));
  print(b.put(4));
  print(b.put(3));
  print(b.weight);
  print(b.label);
  print(b.has(4));
  print(b instanceof Set);
  print(b instanceof Bag);
  print(JSON.stringify(b));
  const all: Registry[] = [];
  const bags: Bag[] = [];
  for (let i = 0; i < 2000; i++) { const x = i & 1 ? new Registry("n" + i) : new Deep("m" + i); x.add("k", i); all.push(x); const g = new Bag(); g.put(i); bags.push(g); }
  gc();
  let sum = 0;
  for (let i = 0; i < all.length; i++) sum += all[i].lookup("k")! + all[i].name.length + all[i].meta.kind.length + all[i].count + all[i].size + bags[i].weight + bags[i].size;
  print(sum);
}
{
  class Bytes extends Uint8Array {
    cursor = 0;
    name: string;
    meta: { a: number };
    #mark = 3;
    constructor(n: number, name: string) { super(n); this.name = name; this.meta = { a: n }; }
    next() { return this[this.cursor++]; }
    get left() { return this.length - this.cursor; }
    mark() { return this.#mark; }
  }
  class More extends Bytes {
    level = 2;
    next() { return super.next() + this.level; }
  }
  const b = new Bytes(4, "b");
  b[0] = 10; b[1] = 300; b[2] = 30;
  print(b.length);
  print(b.next());
  print(b.next());
  print(b.left);
  print(b.cursor);
  print(b.name);
  print(b.meta.a);
  print(b.mark());
  print(b instanceof Bytes);
  print(b instanceof Uint8Array);
  print(b.byteLength);
  const ks = Object.keys(b);
  print(ks.length);
  for (let i = 0; i < ks.length; i++) print(ks[i]);
  print(JSON.stringify(b));
  const m = new More(2, "m");
  m[0] = 1;
  print(m.next());
  print(m.level);
  print(m instanceof Bytes);
  const all: Bytes[] = [];
  for (let i = 0; i < 2000; i++) { const x = i & 1 ? new Bytes(3, "n" + i) : new More(3, "m" + i); x[0] = i; all.push(x); }
  gc();
  let sum = 0;
  for (let i = 0; i < all.length; i++) sum += all[i].next() + all[i].name.length + all[i].meta.a + all[i].mark() + all[i].left;
  print(sum);
}
{
  class Task<T> extends Promise<T> {
    label = "task";
    started = 1;
    info: { n: number } = { n: 4 };
    describe() { return this.label + this.started + this.info.n; }
  }
  const t = new Task<number>((resolve) => resolve(7));
  print(t.label);
  print(t.started);
  print(t.info.n);
  print(t.describe());
  print(t instanceof Task);
  print(t instanceof Promise);
  const ks = Object.keys(t);
  print(ks.length);
  for (let i = 0; i < ks.length; i++) print(ks[i]);
  t.then((v) => { print("then " + v); });
  const u = t.then((v) => v + 1);
  print(u instanceof Task);
  print((u as Task<number>).label);
  u.then((v) => { print("chained " + v); });
  async function f() { const v = await t; print("awaited " + v); }
  f();
  const all: Task<number>[] = [];
  for (let i = 0; i < 2000; i++) all.push(new Task<number>((resolve) => resolve(i)));
  gc();
  let sum = 0;
  for (let i = 0; i < all.length; i++) sum += all[i].started + all[i].info.n + all[i].label.length;
  print(sum);
}
