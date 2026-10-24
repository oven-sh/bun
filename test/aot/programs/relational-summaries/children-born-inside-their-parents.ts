// `this.c = new C()` in a constructor and `{ b, c: { d } }` can make one cell of parent and child, and `a.c` can be an address instead of a load, if the field holds that child from the parent's birth to its death. Here the child is not born (its constructor throws, the field is read too early), is born twice, is replaced by stores that name the field in no ordinary way, is changed beyond its layout, and outlives its parent under young and full collections.
import { edenGC, fullGC } from "bun:jsc";
function garbage(rounds: number): number {
  let sum = 0;
  for (let i = 0; i < rounds; i++) sum += [i, { i }, "g" + i].length;
  return sum;
}
class C {
  d: number;
  e: { tag: string } | null = null;
  constructor(d: number, fail = false) {
    if (fail) throw new Error("the child was not born");
    this.d = d;
  }
}
class A {
  b: number;
  c: C;
  constructor(b: number) {
    this.b = b;
    this.c = new C(b * 2);
  }
}
let warm = 0;
for (let i = 0; i < 3000; i++) {
  const a = new A(i);
  warm += a.b + a.c.d;
}
console.log(warm);

// The child's constructor throws, and the parent had left before.
const leaked: Fragile[] = [];
class Fragile {
  b = 1;
  c: C;
  constructor(fail: boolean) {
    leaked.push(this);
    this.c = new C(5, fail);
  }
}
for (const fail of [false, true, false, true]) {
  try {
    new Fragile(fail);
  } catch {}
}
fullGC();
garbage(500);
edenGC();
console.log(leaked.map(f => (f.c === undefined ? "unborn" : "born " + f.c.d) + "/" + Object.keys(f).join("+") + "/" + ("c" in f)).join(" "));
leaked[1].c = new C(77);
console.log(leaked[1].c.d, leaked[1].c === leaked[1].c, leaked[3].c);

// The constructor catches the failure itself.
class Forgiving {
  c: C | undefined;
  after = "after";
  constructor(fail: boolean) {
    try {
      this.c = new C(6, fail);
    } catch {}
  }
}
let forgiven = "";
for (let i = 0; i < 300; i++) {
  const f = new Forgiving(i % 100 === 99);
  if (i % 100 >= 98) forgiven += (f.c ? f.c.d : String(f.c)) + f.after + " ";
}
console.log(forgiven);

// The field is read before the child is born.
const early: unknown[] = [];
class ReadsEarly {
  c: C;
  constructor() {
    early.push((this as { c?: C }).c);
    this.peek();
    this.c = new C(7);
    this.peek();
  }
  peek(): void {
    early.push(this.c === undefined ? "undefined" : this.c.d);
  }
}
new ReadsEarly();
class Base {
  constructor() {
    this.hook();
  }
  hook(): void {}
}
class HeirWithChild extends Base {
  c = new C(8);
  hook(): void {
    early.push(this.c === undefined ? "not yet" : this.c.d);
  }
}
new HeirWithChild().hook();
console.log(early.join());

// Born twice, born on one path, born in a loop, not born here at all.
const sharedChild = new C(1000);
class Twice {
  c: C;
  first: C;
  constructor() {
    this.c = new C(1);
    this.first = this.c;
    this.c = new C(2);
  }
}
class OnOnePath {
  c: C;
  constructor(own: boolean) {
    this.c = own ? new C(3) : sharedChild;
  }
}
class InALoop {
  c: C = sharedChild;
  all: C[] = [];
  constructor(n: number) {
    for (let i = 0; i < n; i++) {
      this.c = new C(i);
      this.all.push(this.c);
    }
  }
}
class Given {
  constructor(public c: C) {}
}
class FieldThenHeir {
  c = new C(10);
}
class HeirRedefines extends FieldThenHeir {
  c = new C(20);
}
const twice = new Twice();
const looped = new InALoop(3);
const mine = new C(4);
console.log(twice.c.d, twice.first.d, twice.c === twice.first, new OnOnePath(true).c.d, new OnOnePath(false).c === sharedChild, new OnOnePath(false).c === new OnOnePath(false).c, looped.c === looped.all[2], looped.all.map(c => c.d).join(""), new InALoop(0).c === sharedChild, new Given(mine).c === mine, new HeirRedefines().c.d);

// Stores that name the field in no ordinary way.
const replacement = () => new C(-1);
const key = ["c"].join("");
const stores: [string, (a: A) => unknown][] = [
  ["plain", a => (a.c = replacement())],
  ["computed key", a => ((a as any)[key] = replacement())],
  ["Reflect.set", a => Reflect.set(a, "c", replacement())],
  ["Object.assign", a => Object.assign(a, { c: replacement() })],
  ["defineProperty", a => Object.defineProperty(a, "c", { value: replacement() })],
  ["accessor", a => Object.defineProperty(a, "c", { get: replacement })],
  ["pattern", a => ({ c: a.c } = { c: replacement() })],
  ["array pattern", a => ([a.c] = [replacement()])],
  ["loop target", a => {
    for (a.c of [replacement()]);
  }],
  ["through a proxy", a => (new Proxy(a, {}).c = replacement())],
  ["through an heir object", a => Reflect.set(Object.create(a), "c", replacement(), a)],
  ["any", a => ((a as any).c = replacement())],
  ["null", a => ((a as any).c = null)],
  ["a number", a => ((a as any).c = 5)],
  ["delete", a => delete (a as any).c],
  ["delete and a prototype", a => (delete (a as any).c, Object.setPrototypeOf(a, { c: replacement() }))],
  ["swap", a => {
    const other = new A(50);
    [a.c, other.c] = [other.c, a.c];
  }],
  ["freeze, then store", a => {
    Object.freeze(a);
    try {
      a.c = replacement();
    } catch {}
  }],
];
for (const [name, store] of stores) {
  const a = new A(1);
  const old = a.c;
  store(a);
  const now = (a as any).c;
  console.log(name + ":", now === old, now instanceof C ? now.d : String(now), old.d, readChild(a));
}
function readChild(a: A): string {
  const c = a.c as C | null | undefined | number;
  return c instanceof C ? "C " + c.d : typeof c;
}

// The child is changed beyond its layout.
function changed(i: number): string {
  const a = new A(i);
  const c = a.c as C & Record<string, unknown>;
  for (let k = 0; k < 40; k++) c["extra" + k] = { k };
  delete (c as Partial<C>).d;
  Object.setPrototypeOf(c, { inherited: "yes" });
  Object.defineProperty(c, "e", { get: () => ({ tag: "from an accessor" }) });
  if (i % 10 === 0) fullGC();
  return [Object.keys(c).length, (c.extra39 as { k: number }).k, c.d, (c as unknown as { inherited: string }).inherited, c.e!.tag, a.c === c, a.c instanceof C, a.b].join();
}
let line = "";
for (let i = 0; i < 40; i++) line = changed(i);
console.log(line);
function parentChanged(i: number): string {
  const a = new A(i) as A & Record<string, unknown>;
  const c = a.c;
  for (let k = 0; k < 40; k++) a["extra" + k] = k;
  delete (a as Partial<A>).b;
  if (i % 10 === 0) fullGC();
  return [a.c === c, a.c.d, Object.keys(a).length, a.extra39].join();
}
for (let i = 0; i < 40; i++) line = parentChanged(i);
console.log(line);

// An old parent's child gets a young grandchild.
const oldParents: A[] = [];
for (let i = 0; i < 50; i++) oldParents.push(new A(i));
fullGC();
fullGC();
for (let round = 0; round < 4; round++) {
  for (let i = 0; i < 50; i++) oldParents[i].c.e = { tag: "grandchild " + round + "." + i };
  edenGC();
  garbage(2000);
  edenGC();
}
console.log(oldParents.every((a, i) => a.c.e!.tag === "grandchild 3." + i && a.c.d === i * 2));

// The parents die, the children live; then the children die and the parents live.
const children: C[] = [];
const parents: A[] = [];
for (let i = 0; i < 4000; i++) {
  const a = new A(i);
  a.c.e = { tag: "of " + i };
  if (i % 400 === 0) children.push(a.c);
  const b = new A(-i);
  if (i % 400 === 1) {
    b.c = sharedChild;
    parents.push(b);
  }
}
for (let round = 0; round < 3; round++) {
  fullGC();
  garbage(3000);
  edenGC();
}
console.log(children.map(c => c.d + c.e!.tag).join(" "), parents.map(p => p.b + ":" + (p.c === sharedChild)).join(" "));

// Weak things keyed by a child.
const notes = new WeakMap<C, string>();
const refs: WeakRef<C>[] = [];
const holders: A[] = [];
for (let i = 0; i < 100; i++) {
  const a = new A(i);
  notes.set(a.c, "note " + i);
  refs.push(new WeakRef(a.c));
  holders.push(a);
}
fullGC();
garbage(1000);
fullGC();
console.log(holders.every((a, i) => notes.get(a.c) === "note " + i && refs[i].deref() === a.c));

// Literals in literals, four deep, ten wide, and of the parent's own shape.
function nest(i: number) {
  return { l1: { l2: { l3: { l4: { n: i } } } }, w0: { n: 0 }, w1: { n: 1 }, w2: { n: 2 }, w3: { n: 3 }, w4: { n: 4 }, w5: { n: 5 }, w6: { n: 6 }, w7: { n: 7 }, w8: { n: 8 }, w9: { n: i } };
}
interface Chain {
  n: number;
  next: Chain | null;
}
function chain(i: number): Chain {
  return { n: i, next: { n: i + 1, next: { n: i + 2, next: null } } };
}
const deepest: { n: number }[] = [];
const tails: Chain[] = [];
for (let i = 0; i < 3000; i++) {
  const n = nest(i);
  const c = chain(i);
  if (i % 500 === 0) {
    deepest.push(n.l1.l2.l3.l4, n.w9);
    tails.push(c.next!.next!);
  }
}
fullGC();
garbage(3000);
fullGC();
console.log(deepest.map(d => d.n).join(), tails.map(t => t.n + String(t.next)).join());

// Copies share the child.
const original = new A(9);
const spread = { ...original };
const assigned = Object.assign({}, original);
const cloned = structuredClone(original);
spread.c.d = -9;
console.log(original.c.d, assigned.c === original.c, spread.c === original.c, cloned.c === original.c, cloned.c.d, JSON.stringify(original));
