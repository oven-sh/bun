// What a built-in constructor defines on the object (message, cause, stack, length, lastIndex) comes before a getter of the class that extends it. Species, Reflect.construct with either class as
// new.target, arrow functions in fields, delete, defineProperty, freeze, spread and for-in on such instances, and subclasses of Object, RegExp, Date, String, WeakMap and ArrayBuffer.
const print = (value: unknown): void => console.log(String(value));
const gc = (): void => Bun.gc(true);
{
  class Failure extends Error {
    constructor(m: string) { super(m); }
    get message() { return "from getter"; }
  }
  class Stack extends Array<number> {
    get length() { return 42; }
  }
  class Caused extends Error {
    constructor(m: string, c: unknown) { super(m, { cause: c }); }
  }
  class Plain extends Error {}
  class Named extends Error {
    name = "Named";
  }
  print(new Failure("given").message);
  print(new Stack().length);
  const c = new Caused("m", 17);
  print(c.cause);
  print(c.message);
  print(typeof c.stack);
  print(c.stack !== undefined);
  const p = new Plain("pm");
  print(p.message);
  print(p.name);
  print(String(p));
  print(p.hasOwnProperty("message"));
  print(p.hasOwnProperty("stack"));
  print("message" in p);
  const n = new Named("nm");
  print(n.name);
  print(String(n));
  print(n.message);
  print(Object.keys(n).length);
  print(JSON.stringify(n));
  try { throw n; } catch (e) { print((e as Error).message); print(e instanceof Named); print(e instanceof Error); print(e instanceof Plain); }
}
{
  let made = 0;
  class List extends Array<number> {
    tag: string;
    constructor(n?: number) {
      super();
      made++;
      this.tag = "t" + (n === undefined ? "none" : typeof n);
    }
    first() { return this[0]; }
  }
  const l = new List();
  l.push(4); l.push(5); l.push(6);
  const s = l.slice(1, 3);
  print(made);
  print(s instanceof List);
  print(s.length);
  print(s[0]);
  print((s as List).tag);
  print((s as List).first());
  const sp = l.splice(0, 1);
  print(made);
  print(sp instanceof List);
  print((sp as List).tag);
  print(l.length);
  class Plain extends Array<number> {
    static get [Symbol.species]() { return Array; }
    mark = 1;
  }
  const p = new Plain();
  p.push(1); p.push(2);
  const q = p.slice(0, 1);
  print(q instanceof Plain);
  print(q instanceof Array);
  print(q.length);
  print(p.mark);
  class Obj extends Object {
    v = 3;
    constructor() { super(); }
    get w() { return this.v + 1; }
  }
  const o = new Obj();
  print(o.v);
  print(o.w);
  print(o instanceof Obj);
  print(JSON.stringify(o));
  print(Object.keys(o).length);
  class Rx extends RegExp {
    hits = 0;
    test(s: string) { this.hits++; return super.test(s); }
  }
  const r = new Rx("a+", "g");
  print(r.test("caat"));
  print(r.lastIndex);
  print(r.hits);
  print(r.source);
  print(r instanceof RegExp);
  class When extends Date {
    label = "w";
    year() { return this.getUTCFullYear(); }
  }
  const w = new When(0);
  print(w.year());
  print(w.label);
  print(w.getTime());
  class Str extends String {
    extra = 7;
  }
  const st = new Str("abc");
  print(st.length);
  print(st.extra);
  print(st[1]);
  print(st + "d");
  class Weak extends WeakMap<object, number> {
    n = 0;
    put(k: object, v: number) { this.n++; return this.set(k, v); }
  }
  const wk = new Weak();
  const key = {};
  wk.put(key, 9);
  print(wk.get(key));
  print(wk.n);
  class Buf extends ArrayBuffer {
    note = "n";
  }
  const bf = new Buf(8);
  print(bf.byteLength);
  print(bf.note);
}
{
  function list(a: string[]) { let t = ""; for (let i = 0; i < a.length; i++) t += (i ? "," : "") + a[i]; return t; }
  function has(a: string[], v: string) { for (let i = 0; i < a.length; i++) if (a[i] === v) return true; return false; }
  class Box extends Map<string, number> {
    base = 10;
    handler = () => this.base + this.size;
    twice = (n: number) => n * 2 + this.base;
    static made = 0;
    static create() { Box.made++; return new Box(); }
  }
  const b = Box.create();
  b.set("a", 1);
  print(b.handler());
  const h = b.handler;
  print(h());
  print(b.twice(4));
  print(typeof b.handler);
  print(list(Object.keys(b)));
  print(Box.made);
  class Oops extends Error {
    code: number;
    constructor(message: string, code: number) {
      super(message);
      this.name = new.target.name;
      this.code = code;
      Object.setPrototypeOf(this, new.target.prototype);
    }
    toString() { return "[" + this.name + " " + this.code + "] " + this.message; }
    toJSON() { return { name: this.name, code: this.code, message: this.message }; }
  }
  class Worse extends Oops {
    constructor(m: string) { super(m, 500); }
    get fatal() { return this.code >= 500; }
  }
  function raise(n: number): never { throw n > 1 ? new Worse("w" + n) : new Oops("o" + n, 400 + n); }
  for (let i = 0; i < 4; i++) {
    try { raise(i); } catch (e) {
      if (e instanceof Worse) print("worse " + e.fatal + " " + e.toString());
      else if (e instanceof Oops) print("oops " + e.code + " " + String(e));
      else print("other");
      print(JSON.stringify(e));
      print((e as Error).name + "/" + (e as Error).message + "/" + (e instanceof Error));
    }
  }
  const o = new Oops("m", 1);
  delete (o as any).code;
  print(o.code);
  print("code" in o);
  (o as any).extra = 5;
  print((o as any).extra);
  Object.defineProperty(o, "code", { get() { return 77; }, configurable: true });
  print(o.code);
  Object.freeze(o);
  try { "use strict"; (o as any).more = 1; } catch (e) { print("frozen"); }
  print(Object.isFrozen(o));
  const copy = { ...b };
  print(Object.keys(copy).length);
  print(copy.base);
  const { base, ...rest } = b as any;
  print(base);
  print(list(Object.keys(rest)));
  for (const k in b) print("in " + k);
  print(has(Object.getOwnPropertyNames(new Oops("q", 2)), "message"));
  print(Reflect.ownKeys(b).length);
  const r: any = Reflect.construct(Map, [], Box);
  print(r instanceof Box);
  print(r.base);
  print(r.size);
  const r2: any = Reflect.construct(Box, [], Map);
  print(r2 instanceof Box);
  print(r2 instanceof Map);
  print((r2 as any).base);
}
