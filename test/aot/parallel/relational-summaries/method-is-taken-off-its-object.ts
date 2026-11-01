// `this` is a parameter like the others, and the caller chooses it: a method read into a variable, handed on as a callback, called through call, apply, bind and Reflect.apply, borrowed by another object, reached through super. What the method does with `this` (keeps it, returns it, stores into it) happens to whatever stands there.
function churn(depth: number): number {
  const pair = { left: depth, right: -depth };
  const list = [depth, depth + 1, depth + 2];
  const read = () => pair.left + list[1];
  if (depth > 0) return churn(depth - 1) + read();
  Bun.gc(true);
  return read();
}
const kept: unknown[] = [];
class Counter {
  count = 0;
  constructor(public tag: string) {}
  bump(): number {
    return ++this.count;
  }
  self(): this {
    return this;
  }
  keepMe(): void {
    kept.push(this);
  }
  adopt(child: { tag: string }): void {
    (this as unknown as { child: unknown }).child = child;
  }
  kindOfThis(): string {
    return this === undefined ? "undefined" : typeof this;
  }
}
function callIt<T>(f: () => T): T {
  return f();
}
function callOn<T>(f: (this: unknown) => T, receiver: unknown): T {
  return f.call(receiver);
}
let warm = 0;
for (let i = 0; i < 500; i++) {
  const c = new Counter("c" + i);
  warm += c.bump() + c.bump() + (c.self() === c ? 1 : 0);
}
console.log(warm);
const counter = new Counter("the counter");
const { bump, self, keepMe, adopt, kindOfThis } = counter;
console.log(callIt(kindOfThis), callOn(kindOfThis, 5), callOn(kindOfThis, "s"), callOn(kindOfThis, null), callOn(kindOfThis, counter));
for (const call of [() => bump(), () => callIt(bump), () => [1].map(bump), () => callIt(keepMe) as unknown, () => (0, counter.bump)(), () => (counter.bump || 0)()]) {
  try {
    console.log(String(call()));
  } catch (error) {
    console.log((error as Error).constructor.name);
  }
}
console.log(callIt(self), kept.length, kept[0]);

// Borrowed: `this` is a fresh literal, made for the call.
function borrow(i: number): string {
  const returned = self.call({ tag: "literal" + i, count: 0 }) as { tag: string };
  const bumped = bump.call({ count: i * 10 });
  const applied = bump.apply({ count: i * 100 }, []);
  const reflected = Reflect.apply(bump, { count: i * 1000 }, []);
  const bound = bump.bind({ count: 5 });
  if (i % 70 === 69) {
    keepMe.call({ tag: "kept literal" + i });
    keepMe.apply({ tag: "kept by apply" + i });
    Reflect.apply(keepMe, { tag: "kept by Reflect" + i }, []);
    keepMe.bind({ tag: "kept by bind" + i })();
    kept.push(bound);
  }
  return [returned.tag, bumped, applied, reflected, bound(), bound()].join();
}
let line = "";
for (let i = 0; i < 150; i++) line = borrow(i);
console.log(line, churn(60));
console.log(kept.map(k => (typeof k === "function" ? "bound:" + k() : k === undefined ? "undefined" : (k as { tag: string }).tag)).join(" | "));

// The parent and the child are both fresh; the method links them.
function link(i: number): string {
  const parent: { tag: string; child?: { tag: string } } = { tag: "parent" + i };
  adopt.call(parent, { tag: "child" + i });
  churn(3);
  return parent.tag + ">" + parent.child!.tag;
}
for (let i = 0; i < 100; i++) line = link(i);
console.log(line);

// One method, put on another object and another class.
const thief = { count: 100, tag: "thief", bump: counter.bump, self: counter.self };
class Other {
  count = 1000;
}
(Other.prototype as unknown as { bump: () => number }).bump = Counter.prototype.bump;
console.log(thief.bump(), thief.bump(), thief.self() === (thief as unknown), (new Other() as unknown as Counter).bump(), counter.count);

// super: the method is the base's, `this` stays the heir.
class Base {
  who(): unknown {
    return this;
  }
  register(): void {
    kept.push(this);
  }
}
class Heir extends Base {
  tag = "heir";
  who(): unknown {
    return super.who();
  }
  register(): void {
    super.register();
  }
}
function viaSuper(i: number): boolean {
  const h = new Heir();
  if (i % 70 === 69) h.register();
  return h.who() === h;
}
kept.length = 0;
let all = true;
for (let i = 0; i < 150; i++) all = viaSuper(i) && all;
console.log(all, churn(40), kept.map(k => (k as Heir).tag).join());

// Getters and setters taken off by their descriptors.
class Temperature {
  constructor(public celsius: number) {}
  get fahrenheit(): number {
    kept.push(this);
    return this.celsius * 1.8 + 32;
  }
}
const getter = Object.getOwnPropertyDescriptor(Temperature.prototype, "fahrenheit")!.get!;
kept.length = 0;
console.log(getter.call({ celsius: 100 }), getter.call(new Temperature(0)), Reflect.get(Temperature.prototype, "fahrenheit", { celsius: 10 }), churn(20), kept.map(k => (k as Temperature).celsius).join());
