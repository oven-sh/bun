// Class prototype additions through untyped code.
const untyped: any = {
  add(target: any, key: any, value: any) {
    target[key] = value;
  },
  define(target: any, key: any, descriptor: any) {
    Object.defineProperty(target, key, descriptor);
  },
  remove(target: any, key: any) {
    return delete target[key];
  },
  read(target: any, key: any) {
    return target[key];
  },
  readExtra(target: any) {
    return target.extra;
  },
  storeExtra(target: any, value: any) {
    target.extra = value;
  },
  prototypeOf(target: any) {
    return Object.getPrototypeOf(target);
  },
};
async function attempt(name: string, run: () => unknown): Promise<void> {
  try {
    console.log(name + ":", await run());
  } catch (error) {
    console.log(name + ": throws", (error as Error).name);
  }
}
function warm(read: () => unknown): string {
  let seen = "";
  for (let i = 0; i < 5; i++) seen = String(read());
  return seen;
}

class C1 { n = 1; m() { return this.n; } }
class C2 { n = 1; }
class C3 { n = 1; }
class C4 { n = 3; }
class C5 { n = 3; }
class C6 { n = 4; }
class A7 { n = 1; }
class B7 extends A7 { k = 2; }
class A8 { n = 1; }
class B8 extends A8 { k = 2; }
class A9 { who() { return "A9"; } }
class B9 extends A9 { k = 2; }
class C10 { n = 1; }
class C11 { n = 1; }
class C12 { n = 1; }
class C13 { n = 1; declare note?: string; }
class C14 { n = 1; }
class C16 { n = 1; }
class C17 { n = 1; }
class C18 { n = 1; }
class C20 { n = 1; m() {} }
class C21 { who() { return "declared"; } }
class C22 { who() { return "declared"; } }

await attempt("a name, missed five times first", () => {
  const c = new C1();
  const before = warm(() => untyped.readExtra(c));
  untyped.add(C1.prototype, "extra", 7);
  return [before, warm(() => untyped.readExtra(c)), untyped.readExtra(new C1()), c.m()].join(" ");
});
await attempt("a symbol", () => {
  const mark = Symbol("mark");
  const c = new C2();
  const before = warm(() => untyped.read(c, mark));
  untyped.add(C2.prototype, mark, true);
  return [before, warm(() => untyped.read(c, mark))].join(" ");
});
await attempt("defineProperty", () => {
  const c = new C3();
  const before = warm(() => untyped.readExtra(c));
  untyped.define(C3.prototype, "extra", { value: 7 });
  return [before, warm(() => untyped.readExtra(c)), Object.keys(C3.prototype).length].join(" ");
});
await attempt("a getter", () => {
  const c = new C4();
  const before = warm(() => untyped.readExtra(c));
  untyped.define(C4.prototype, "extra", { get(this: C4) { return this.n * 2; }, configurable: true });
  return [before, warm(() => untyped.readExtra(c))].join(" ");
});
await attempt("a setter, then a store by that name", () => {
  const c = new C5();
  untyped.storeExtra(new C5(), 1);
  untyped.define(C5.prototype, "extra", { set(this: C5, value: number) { this.n = value; }, configurable: true });
  untyped.storeExtra(c, 9);
  return [c.n, Object.keys(c).join()].join(" ");
});
await attempt("a function, called with its receiver", () => {
  untyped.add(C6.prototype, "twice", function (this: C6) { return this.n * 2; });
  return (new C6() as any).twice();
});
await attempt("seen from a subclass, missed first", () => {
  const b = new B7();
  const before = warm(() => untyped.readExtra(b));
  untyped.add(A7.prototype, "extra", 7);
  return [before, warm(() => untyped.readExtra(b))].join(" ");
});
await attempt("found above, then hidden by an addition below", () => {
  const b = new B8();
  untyped.add(A8.prototype, "extra", "above");
  const before = warm(() => untyped.readExtra(b));
  untyped.add(B8.prototype, "extra", "below");
  return [before, warm(() => untyped.readExtra(b))].join(" ");
});
await attempt("an inherited method overridden on the subclass", () => {
  const b = new B9();
  const before = warm(() => b.who());
  untyped.add(B9.prototype, "who", () => "B9");
  return [before, warm(() => b.who())].join(" ");
});
await attempt("added and removed again", () => {
  const c = new C10();
  untyped.add(C10.prototype, "extra", 7);
  const during = warm(() => untyped.readExtra(c));
  return [during, untyped.remove(C10.prototype, "extra"), warm(() => untyped.readExtra(c))].join(" ");
});
await attempt("in", () => {
  const c = new C11();
  const before = warm(() => "extra" in c);
  untyped.add(C11.prototype, "extra", 7);
  return [before, warm(() => "extra" in c)].join(" ");
});
await attempt("for-in", () => {
  const c = new C12();
  untyped.add(C12.prototype, "extra", 7);
  const names: string[] = [];
  for (const name in c) names.push(name);
  return names.join();
});
await attempt("an optional field that is absent", () => {
  const c = new C13();
  const before = warm(() => c.note);
  untyped.add(C13.prototype, "note", "inherited");
  return [before, warm(() => c.note), untyped.read(c, "note")].join(" ");
});
await attempt("then", async () => {
  const c = new C14();
  const before = (await c) === c;
  untyped.add(C14.prototype, "then", function (resolve: (value: string) => void) { resolve("thenable"); });
  return [before, await c].join(" ");
});
await attempt("toJSON", () => {
  const c = new C16();
  const before = warm(() => JSON.stringify(c));
  untyped.add(C16.prototype, "toJSON", () => "json");
  return [before, warm(() => JSON.stringify(c)), JSON.stringify({ c })].join(" ");
});
await attempt("Symbol.iterator", () => {
  untyped.add(C17.prototype, Symbol.iterator, function* () { yield 1; yield 2; });
  return [...(new C17() as any)].join();
});
await attempt("Symbol.toStringTag", () => {
  const c = new C18();
  const before = Object.prototype.toString.call(c);
  untyped.add(C18.prototype, Symbol.toStringTag, "Tagged");
  return [before, Object.prototype.toString.call(c)].join(" ");
});
await attempt("what the prototype says of itself", () => {
  untyped.add(C20.prototype, "extra", 7);
  return [Object.isExtensible(C20.prototype), Object.isFrozen(C20.prototype), Object.getOwnPropertyNames(C20.prototype).join(), Object.keys(C20.prototype).join()].join(" ");
});
await attempt("a declared method replaced where the compiler cannot see it", () => {
  const c = new C21();
  const before = warm(() => c.who());
  untyped.add(C21.prototype, ["w", "ho"].join(""), () => "replaced");
  return [before, warm(() => c.who())].join(" ");
});
await attempt("a declared method deleted where the compiler cannot see it", () => {
  const c = new C22();
  return [untyped.remove(C22.prototype, ["w", "ho"].join("")), typeof (c as any).who].join(" ");
});
