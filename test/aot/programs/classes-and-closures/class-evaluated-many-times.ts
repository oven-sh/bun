// A class expression evaluated 50 times: every evaluation has its own class object, prototype, functions and private names.
function make(tag: string, key: string | symbol) {
  return class Item {
    constructor(public n: number) {}
    get tag() { return tag; }
    set tag(v) {}
    [key]() { return this.n; }
    static create(n: number) { return new Item(n); }
    static #count = 0;
    static #bump() { return ++Item.#count; }
    static next() { return Item.#bump(); }
    static nextOnReceiver() { return this.#bump(); }
    #hidden() { return tag; }
    reveal() { return this.#hidden(); }
  };
}
function describe(holder: object): string {
  return Reflect.ownKeys(holder).map(key => {
    const d = Object.getOwnPropertyDescriptor(holder, key)!;
    const kind = "value" in d ? typeof d.value : (d.get ? "get" : "") + (d.set ? "set" : "");
    return String(key) + ":" + kind + ":" + (d.writable ? "w" : "") + (d.enumerable ? "e" : "") + (d.configurable ? "c" : "");
  }).join(" ");
}
function logResult(name: string, f: () => unknown) {
  try {
    console.log(name, String(f()));
  } catch (error) {
    console.log(name, (error as Error).constructor.name);
  }
}
const keys: (string | symbol)[] = [];
const classes: ReturnType<typeof make>[] = [];
for (let i = 0; i < 50; i++) {
  keys.push(i % 2 ? Symbol("s" + i) : "m" + i);
  classes.push(make("t" + i, keys[i]));
}
const A = classes[0], B = classes[49], keyA = keys[0], keyB = keys[49];
console.log("first class:", describe(A));
console.log("first prototype:", describe(A.prototype));
console.log("last class:", describe(B));
console.log("last prototype:", describe(B.prototype));
const tagAccessor = Object.getOwnPropertyDescriptor(A.prototype, "tag")!;
console.log("names:", (A.prototype as any)[keyA].name, (B.prototype as any)[keyB].name, A.name, A.create.name, A.prototype.reveal.name, tagAccessor.get!.name, tagAccessor.set!.name);
console.log(classes.map((C, i) => {
  const item = C.create(i);
  item.tag = "ignored";
  return [item.n, item.tag, (item as any)[keys[i]](), item.reveal(), C.next(), C.next(), item instanceof C, item.constructor === C].join("/");
}).join(" "));
console.log("distinct:", A !== B, A.prototype !== B.prototype, A.prototype.reveal !== B.prototype.reveal, A.create !== B.create, new Set(classes.map(C => C.prototype)).size, new A(1) instanceof B);

logResult("private method, same evaluation:", () => B.prototype.reveal.call(new B(1)));
logResult("private method, another evaluation:", () => B.prototype.reveal.call(new A(1)));
logResult("static private method through the class binding:", () => A.next.call(B));
logResult("static private method, same evaluation:", () => A.nextOnReceiver.call(A));
logResult("static private method, another evaluation:", () => A.nextOnReceiver.call(B));

const before = new A(1), unrelated = new B(2);
const prototypeA: any = A.prototype, classA: any = A;
prototypeA.reveal = function () { return "replaced"; };
prototypeA.extra = function () { return "extra " + this.n; };
delete prototypeA[keyA];
classA.create = () => "replaced";
classA.extra = () => "extra";
delete classA.next;
const after = new A(3);
for (const item of [before, after]) console.log("changed evaluation:", item.reveal(), (item as any).extra(), typeof (item as any)[keyA], item.tag);
console.log("changed class object:", classA.create(), classA.extra(), typeof classA.next, Object.getOwnPropertyNames(A).sort().join());
console.log("another evaluation:", unrelated.reveal(), typeof (unrelated as any).extra, (unrelated as any)[keyB](), B.create(4).n, typeof (B as any).extra, B.next(), Object.getOwnPropertyNames(B).sort().join());
console.log("a third evaluation:", classes[2].create(5).reveal(), typeof (classes[2].prototype as any).extra, (classes[2].create(6) as any)[keys[2]](), classes[2].next());

const Frozen = classes[3];
Object.freeze(Frozen);
Object.freeze(Frozen.prototype);
logResult("frozen class:", () => [Object.isFrozen(Frozen), Frozen.next(), Frozen.nextOnReceiver(), new Frozen(7).reveal()].join());

function makeCounter(step: number) {
  return class Counter {
    total = 0;
    add() { this.total += this.#step(); return this; }
    get doubled() { return this.total * 2; }
    #step() { return step; }
    static #created = 0;
    static #count() { return ++Counter.#created; }
    static zero() { Counter.#count(); return new Counter(); }
    static created() { return Counter.#created; }
  };
}
const counters = Array.from({ length: 50 }, (_, i) => makeCounter(i));
console.log(counters.map(C => C.zero().add().add().doubled + ":" + C.created()).join(" "));
console.log("same members:", describe(counters[0]) === describe(counters[49]), describe(counters[0].prototype) === describe(counters[49].prototype), describe(counters[1]), "|", describe(counters[1].prototype));
(counters[0].prototype as any).add = function () { return "replaced"; };
(counters[1].prototype as any).extra = () => "extra";
delete (counters[2].prototype as any).add;
(counters[3] as any).zero = () => "replaced";
console.log(counters.slice(0, 5).map(C => {
  const untyped: any = C;
  const item = new untyped();
  return [typeof item.add === "function" ? typeof item.add() : "none", typeof item.extra, typeof untyped.zero()].join("/");
}).join(" "));
logResult("private method, same members, same evaluation:", () => counters[4].prototype.add.call(counters[4].zero()).total);
logResult("private method, same members, another evaluation:", () => counters[4].prototype.add.call(counters[5].zero()).total);

function makeNamed(key: string) {
  return { [key]: class { constructor(public n: number) {} twice() { return this.n * 2; } static create(n: number) { return new this(n); } } }[key];
}
const named = ["first", "second", "third"].map(makeNamed);
console.log("named by a computed key:", named.map((C, i) => C.name + ":" + C.create(i).twice()).join(" "), new Set(named.map(C => C.prototype)).size, describe(named[0]) === describe(named[2]), describe(named[1]));
