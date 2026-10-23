// "Field f is set from parameter j before `this` can leave" and "`new C()` answers an object that nobody else holds" are both false where the constructor, its base, a field initializer, a method it calls or a callback it is handed lets `this` out: half-built objects are seen, kept, and written by others.
function churn(depth: number): number {
  const pair = { left: depth, right: -depth };
  const list = [depth, depth + 1, depth + 2];
  const read = () => pair.left + list[1];
  if (depth > 0) return churn(depth - 1) + read();
  Bun.gc(true);
  return read();
}
const rare = (n: number) => n % 70 === 69;

// The constructor files `this` on a rare path.
class Filed {
  static all: Filed[] = [];
  label: string;
  constructor(public n: number) {
    if (rare(n)) Filed.all.push(this);
    this.label = "filed" + n;
  }
}
// The base files `this`; the heir's fields do not exist yet.
const seenByBase: string[] = [];
const keptByBase: Base[] = [];
class Base {
  constructor(n: number) {
    if (rare(n)) {
      keptByBase.push(this);
      seenByBase.push(JSON.stringify(this) + " " + this.describe());
    }
  }
  describe(): string {
    return "base";
  }
}
class Heir extends Base {
  extra = "extra";
  constructor(public n: number) {
    super(n);
  }
  describe(): string {
    return "heir with " + this.extra + " and " + this.n;
  }
}
// A field initializer hands `this` out.
const keptByInitializer: WithInitializer[] = [];
function note(o: WithInitializer, n: number): number {
  if (rare(n)) keptByInitializer.push(o);
  return n;
}
let serial = 0;
class WithInitializer {
  first = "first";
  noted = note(this, serial++);
  last = "last";
}
// A closure over `this` is made in the constructor and kept.
const readers: (() => string)[] = [];
class WithClosure {
  value: string;
  constructor(n: number) {
    if (rare(n)) readers.push(() => this.value);
    this.value = "value" + n;
  }
}
// The constructor is handed a callback and calls it with `this`.
class WithCallback {
  state = "early";
  constructor(n: number, visit: (self: WithCallback) => void) {
    visit(this);
    this.state += " then late" + n;
  }
}
// The constructor stores `this` into a parameter.
interface Parent {
  kids: Child[];
  tag: string;
}
class Child {
  constructor(
    public parent: Parent,
    public n: number,
  ) {
    parent.kids.push(this);
  }
}
// The constructor throws `this`.
class Thrown {
  tag: string;
  constructor(n: number) {
    this.tag = "thrown" + n;
    if (rare(n)) throw this;
  }
}
const keptByCallback: WithCallback[] = [];
const caught: Thrown[] = [];
let sum = 0;
let line = "";
for (let i = 0; i < 210; i++) {
  const filed = new Filed(i);
  filed.n += 1000;
  sum += filed.n + new Heir(i).n + new WithInitializer().noted + new WithClosure(i).value.length;
  const called = new WithCallback(i, self => {
    if (rare(i)) keptByCallback.push(self);
    self.state += " visited";
  });
  sum += called.state.length;
  const parent: Parent = { kids: [], tag: "parent" + i };
  const child = new Child(parent, i);
  new Child(parent, -i);
  line = [parent.kids[0] === child, parent.kids.length, parent.kids[1].parent === parent].join();
  try {
    sum += new Thrown(i).tag.length;
  } catch (error) {
    caught.push(error as Thrown);
  }
}
console.log(sum, line, churn(60));
console.log(Filed.all.map(f => f.label + ":" + f.n).join());
console.log(seenByBase.join(" | "), keptByBase.map(b => b.describe()).join(" | "));
console.log(keptByInitializer.map(o => [o.first, o.noted, o.last].join("/")).join(), readers.map(r => r()).join());
console.log(keptByCallback.map(c => c.state).join(" | "), caught.map(c => c.tag).join());

// Somebody who got `this` early writes the field that the constructor then "sets from its parameter", or the other way round.
class Racing {
  value: number;
  constructor(value: number, meddle: (self: Racing) => void, early: boolean) {
    if (early) meddle(this);
    this.value = value;
    if (!early) meddle(this);
  }
}
function race(i: number): number {
  return new Racing(i, self => void (self.value = -1), i % 2 === 0).value;
}
let raced = 0;
for (let i = 0; i < 100; i++) raced += race(i);
console.log(raced);

// The kind of the field is the kind of the parameter only as long as nobody stores again.
class Typed {
  constructor(public payload: number | string | { tag: string }) {}
}
function payloadOf(t: Typed): string {
  return typeof t.payload;
}
const later: Typed[] = [];
let kinds = "";
for (let i = 0; i < 200; i++) {
  const t = new Typed(i);
  if (i % 90 === 89) later.push(t);
  kinds = payloadOf(t);
}
for (const t of later) t.payload = { tag: "stored later" };
later.push(new Typed("text"), Object.assign(new Typed(1), { payload: "assigned" }));
console.log(kinds, later.map(payloadOf).join());

// A static block, a static method and a private name let instances out as well.
class Secretive {
  static #made: Secretive[] = [];
  #n: number;
  constructor(n: number) {
    this.#n = n;
    if (rare(n)) Secretive.#made.push(this);
  }
  static report(): string {
    return Secretive.#made.map(s => s.#n).join();
  }
}
for (let i = 0; i < 150; i++) new Secretive(i);
console.log(churn(40), Secretive.report());
