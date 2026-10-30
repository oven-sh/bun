// RUN: lower
// OPTIONS: builtin-modules

// One place in untyped code reads a name that is a getter somewhere. The place is warmed with one kind of receiver, then meets every other kind, and what it learned is taken away under it.
const lines = [];
const warm = 40;
const show = value => {
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "function") return "function " + value.name;
  if (Array.isArray(value)) return "[" + value.map(show).join(", ") + "]";
  if (typeof value === "object" && value !== null) return Object.prototype.toString.call(value);
  return String(value);
};
const attempt = work => {
  try {
    return show(work());
  } catch (error) {
    return "throws " + error.constructor.name + (error.isOurs ? ": " + error.message : "");
  }
};
const say = (label, ...values) => lines.push(label + ": " + values.join(" | "));
const collect = typeof gc === "function" ? gc : typeof Bun === "object" ? () => Bun.gc(true) : () => {};

function section(label, read, first, others) {
  let last;
  for (let i = 0; i < warm; i++) last = attempt(() => read(first));
  const seen = [last];
  for (const other of others) seen.push(attempt(() => read(other)));
  seen.push(attempt(() => read(first)));
  say(label, ...seen);
}

// 1. A getter of a class; heirs that inherit it, override it, hide it with data.
{
  class Shape {
    constructor(side) { this.side = side; }
    get area() { return this.side * this.side; }
  }
  class Same extends Shape {}
  class Round extends Shape {
    get area() { return "round " + this.side; }
  }
  class Upward extends Shape {
    get area() { return "above " + super.area; }
  }
  class Field extends Shape {
    area = "a field";
  }
  const read = o => o.area;
  const shadowed = new Shape(5);
  Object.defineProperty(shadowed, "area", { value: "own data", configurable: true, writable: true });
  const shadowedByGetter = new Shape(6);
  Object.defineProperty(shadowedByGetter, "area", { get() { return "own getter " + this.side; }, configurable: true });
  section("class", read, new Shape(3), [new Same(4), new Round(2), new Upward(2), new Field(1), shadowed, shadowedByGetter, { area: "plain" }, {}, Object.create(null), Object.create(new Shape(7)), [1], "text", 7, true, 10n, Symbol.iterator, null, undefined, () => 1]);
  delete shadowed.area;
  delete shadowedByGetter.area;
  say("class, own properties deleted", attempt(() => read(shadowed)), attempt(() => read(shadowedByGetter)));
}

// 2. The getter is replaced, removed and put back on the prototype after the place has learned it.
{
  function Account(balance) { this.balance = balance; }
  Object.defineProperty(Account.prototype, "state", { get() { return "first " + this.balance; }, configurable: true });
  const read = o => o.state;
  const one = new Account(1);
  const steps = [];
  const again = () => steps.push(attempt(() => read(one)));
  for (let i = 0; i < warm; i++) read(one);
  again();
  Object.defineProperty(Account.prototype, "state", { get() { return "second " + this.balance; }, configurable: true });
  again();
  for (let i = 0; i < warm; i++) read(one);
  Object.defineProperty(Account.prototype, "state", { value: "data now", configurable: true, writable: true });
  again();
  for (let i = 0; i < warm; i++) read(one);
  Account.prototype.state = "data changed";
  again();
  Object.defineProperty(Account.prototype, "state", { get() { return "third " + this.balance; }, set(v) { this.balance = v; }, configurable: true });
  again();
  for (let i = 0; i < warm; i++) read(one);
  one.state = 9;
  again();
  Object.defineProperty(Account.prototype, "state", { set(v) {}, get: undefined, configurable: true });
  again();
  for (let i = 0; i < warm; i++) read(one);
  delete Account.prototype.state;
  again();
  Object.setPrototypeOf(Account.prototype, { state: "from the prototype above" });
  again();
  for (let i = 0; i < warm; i++) read(one);
  Object.setPrototypeOf(Account.prototype, Object.prototype);
  again();
  Account.prototype.__defineGetter__("state", function () { return "fourth " + this.balance; });
  again();
  say("replaced", ...steps);
}

// 3. The chain changes between the receiver and the holder.
{
  class Base { get kind() { return "base"; } }
  class Middle extends Base {}
  class Leaf extends Middle {}
  const read = o => o.kind;
  const leaf = new Leaf();
  const steps = [];
  const again = () => { steps.push(attempt(() => read(leaf))); for (let i = 0; i < warm; i++) read(leaf); };
  for (let i = 0; i < warm; i++) read(leaf);
  again();
  steps.push(attempt(() => { Middle.prototype.kind = "refused: a getter without a setter above"; }));
  again();
  Object.defineProperty(Middle.prototype, "kind", { value: "middle data", configurable: true });
  again();
  Object.defineProperty(Middle.prototype, "kind", { get() { return "middle getter"; }, configurable: true });
  again();
  delete Middle.prototype.kind;
  again();
  Object.setPrototypeOf(Middle.prototype, { get kind() { return "another base"; } });
  again();
  Object.setPrototypeOf(Middle.prototype, Base.prototype);
  again();
  Object.setPrototypeOf(leaf, { get kind() { return "a prototype of its own"; } });
  again();
  Object.setPrototypeOf(leaf, null);
  again();
  Object.setPrototypeOf(leaf, Leaf.prototype);
  again();
  say("chain", ...steps);
}

// 4. Twenty classes with the same name at one place.
{
  const classes = [];
  for (let i = 0; i < 20; i++) {
    classes.push(i % 3 === 2 ? class { constructor() { this.label = "data " + i; } } : class { get label() { return "getter " + i; } });
  }
  const read = o => o.label;
  const instances = classes.map(C => new C());
  let text = "";
  for (let round = 0; round < 12; round++) {
    for (const instance of instances) text = read(instance);
  }
  say("twenty", instances.map(read).join(","), text);
  let sum = 0;
  for (let round = 0; round < 300; round++) sum += read(instances[(round * 7) % 20]).length;
  say("twenty, mixed", sum);
}

// 5. Proxies.
{
  class Target { get word() { return "target " + (this === proxy ? "proxy" : this === plain ? "plain" : "other"); } }
  const plain = new Target();
  const log = [];
  const proxy = new Proxy(plain, { get(target, key, receiver) { log.push(String(key)); return Reflect.get(target, key, receiver); } });
  const bare = new Proxy(plain, {});
  const heir = Object.create(proxy);
  const read = o => o.word;
  section("proxy", read, plain, [proxy, bare, heir, proxy]);
  say("proxy traps", log.join(","));
  const { proxy: revoked, revoke } = Proxy.revocable(plain, {});
  revoke();
  say("revoked", attempt(() => read(revoked)), attempt(() => read(plain)));
}

// 6. What `this` is: the receiver, not the holder, through any number of prototypes.
{
  const holder = { get self() { return this; } };
  const middle = Object.create(holder);
  const leaf = Object.create(middle);
  const read = o => o.self;
  for (let i = 0; i < warm; i++) read(leaf);
  say("this", read(leaf) === leaf, read(middle) === middle, read(holder) === holder, read(Object.create(leaf)) === leaf);
}

// 7. Getters that are not plain compiled functions without parameters.
{
  const read = o => o.value;
  const make = get => Object.create(Object.defineProperty({}, "value", { get, configurable: true }));
  const holder = { tag: "bound this" };
  const kinds = [
    make(function () { return "plain " + arguments.length; }),
    make(function (a, b) { return "parameters " + a + " " + b + " " + arguments.length; }),
    make(function (...rest) { return "rest " + rest.length; }),
    make(function (a = "default") { return a; }),
    make(() => "arrow"),
    make(function () { return this.tag; }.bind(holder)),
    make(Math.random.bind(null, 1).bind(null)),
    make(Object.getOwnPropertyDescriptor(Map.prototype, "size").get),
    make(new Proxy(function () { return "through a proxy"; }, {})),
    make(async function () { return 1; }),
    make(function* () { yield 1; }),
    make(class { static make() { return "static method"; } }.make),
    make(Array.prototype.slice),
    make(String),
  ];
  for (let k = 0; k < kinds.length; k++) {
    let last;
    for (let i = 0; i < warm; i++) last = attempt(() => read(kinds[k]));
    say("kind " + k, k === 6 ? typeof read(kinds[k]) : last);
  }
  const mixed = [];
  for (let i = 0; i < 60; i++) mixed.push(i % 14 === 6 ? "number" : attempt(() => read(kinds[i % 14])));
  say("kinds mixed", mixed.slice(40).join(";"));
}

// 8. Own accessors: one shape, a closure for every object.
{
  const make = n => ({ get count() { return n; }, other: n });
  const read = o => o.count;
  const all = [];
  for (let i = 0; i < 50; i++) all.push(make(i));
  let sum = 0;
  for (const each of all) sum += read(each);
  say("own accessors", sum, read(all[7]), read(all[49]));
  const wide = {};
  for (let i = 0; i < 40; i++) wide["p" + i] = i;
  Object.defineProperty(wide, "count", { get() { return "far out of line"; }, configurable: true, enumerable: true });
  section("own accessor far out", read, wide, [all[3], { count: "data" }, Object.create(wide)]);
}

// 9. Data under a name that is an accessor elsewhere: in line, out of line, inherited, absent.
{
  class Elsewhere { get payload() { return "getter"; } }
  const read = o => o.payload;
  const far = {};
  for (let i = 0; i < 30; i++) far["q" + i] = i;
  far.payload = "out of line";
  const farProto = {};
  for (let i = 0; i < 30; i++) farProto["r" + i] = i;
  farProto.payload = "inherited out of line";
  section("data in line", read, { payload: "in line" }, [far, Object.create({ payload: "inherited" }), Object.create(farProto), {}, new Elsewhere(), { a: 1, payload: 2 }]);
  section("data out of line", read, far, [{ payload: "in line" }, new Elsewhere()]);
  section("data inherited", read, Object.create(farProto), [new Elsewhere(), far]);
  section("absent", read, { nothing: 1 }, [new Elsewhere(), far, { nothing: 2 }]);
  const grows = { nothing: 1 };
  for (let i = 0; i < warm; i++) read(grows);
  grows.payload = "added";
  say("absent, then added", read(grows), attempt(() => read({ nothing: 3 })));
  const changing = { payload: 1 };
  for (let i = 0; i < warm; i++) read(changing);
  changing.payload = 2;
  say("data changed", read(changing));
}

// 10. Getters that throw, and handlers round the place.
{
  class Fails {
    constructor(n) { this.n = n; }
    get risky() { if (this.n % 3 === 0) throw Object.assign(new RangeError("no " + this.n), { isOurs: true }); return this.n; }
  }
  const read = o => o.risky;
  const out = [];
  for (let i = 1; i <= 50; i++) {
    try {
      out.push(read(new Fails(i)));
    } catch (error) {
      out.push("E" + error.message);
    } finally {
      if (i % 25 === 0) out.push("f");
    }
  }
  say("throws", out.slice(40).join(","));
  function inside(o) {
    try { return o.risky; } catch (error) { return "caught here " + (error.isOurs ? error.message : error.constructor.name); } finally { lines.length; }
  }
  for (let i = 1; i < warm; i++) inside(new Fails(i));
  say("throws in the same function", inside(new Fails(3)), inside(new Fails(4)), attempt(() => inside(null)));
}

// 11. Getters that change what the place relies on while they run.
{
  class Lazy {
    get once() {
      Object.defineProperty(this, "once", { value: "computed", configurable: true });
      return "computing";
    }
  }
  const read = o => o.once;
  const out = [];
  for (let i = 0; i < warm; i++) { const each = new Lazy(); out.push(read(each) + "/" + read(each)); }
  say("lazy", out[0], out[warm - 1]);

  class Grows { get more() { this["extra" + (this.n = (this.n || 0) + 1)] = 1; return this.n; } }
  const readMore = o => o.more;
  const growing = new Grows();
  let total = 0;
  for (let i = 0; i < 30; i++) total += readMore(growing);
  say("grows", total, Object.keys(growing).length);

  class Turns { get face() { Object.defineProperty(Turns.prototype, "face", { get() { return "second face"; }, configurable: true }); return "first face"; } }
  const readFace = o => o.face;
  const turning = new Turns();
  say("turns", readFace(turning), readFace(turning), readFace(new Turns()));

  class Leaves { get home() { Object.setPrototypeOf(this, { home: "moved" }); return "leaving"; } }
  const readHome = o => o.home;
  for (let i = 0; i < warm; i++) readHome(new Leaves());
  const leaving = new Leaves();
  say("leaves", readHome(leaving), readHome(leaving));
}

// 12. A getter that reads itself: the stack ends, and the place works afterwards.
{
  class Endless { get deep() { return this.deep + 1; } }
  class Counted { constructor() { this.left = 200; } get deep() { return this.left-- > 0 ? this.deep + 1 : 0; } }
  const read = o => o.deep;
  say("endless", attempt(() => read(new Endless())).slice(0, 17), read(new Counted()), attempt(() => read(new Endless())).slice(0, 17), read(new Counted()));
}

// 13. Classes that die between collections.
{
  const read = o => o.mortal;
  let sum = 0;
  for (let round = 0; round < 30; round++) {
    const C = class { get mortal() { return round; } };
    const D = class extends C {};
    for (let i = 0; i < 20; i++) sum += read(new C()) + read(new D());
    if (round % 5 === 4) collect();
  }
  say("mortal", sum);
}

// 14. Frozen and sealed holders, arrays, functions, class objects.
{
  const read = o => o.mark;
  class Static { static get mark() { return "static of " + this.name; } }
  class Heir extends Static {}
  const list = [1, 2];
  Object.defineProperty(list, "mark", { get() { return "array " + this.length; } });
  function callable() {}
  Object.defineProperty(callable, "mark", { get() { return "function " + this.name; } });
  const frozen = Object.freeze({ get mark() { return "frozen"; } });
  const sealedHeir = Object.seal(Object.create(frozen));
  section("holders", read, Static, [Heir, list, callable, frozen, sealedHeir, class extends Heir {}]);
}

// 15. A getter throws while numbers of the caller are alive across the read, and the caller catches it and goes on with them.
{
  class Fuse { constructor(n) { this.n = n; } get load() { if (this.n % 7 === 3) throw new RangeError("blown at " + this.n); return this.n * 2; } }
  class Spare extends Fuse { get load() { return super.load + 1; } }
  function drain(items) {
    let sum = 0, product = 1, blown = 0, text = "";
    for (let i = 0; i < items.length; i++) {
      const weight = i * 3 + 1;
      try {
        const got = items[i].load;
        sum += got * weight;
        product = (product * (got + 1)) % 1000003;
      } catch (error) {
        blown += weight + i;
        text += error.message.length + ":" + sum + ";";
      }
    }
    return [sum, product, blown, text].join(" ");
  }
  const items = [];
  for (let i = 0; i < 40; i++) items.push(i % 5 === 4 ? { load: i } : i % 2 ? new Fuse(i) : new Spare(i));
  say("fuses", drain(items));
  say("fuses again", drain(items.reverse()));
}

// 16. In generators and async functions.
{
  class Source { constructor(n) { this.n = n; } get next1() { return this.n + 1; } }
  function* walk(items) { for (const item of items) yield item.next1; }
  say("generator", [...walk([new Source(1), { next1: "data" }, new Source(5)])].join(","));
  async function later(items) { let text = ""; for (const item of items) { text += item.next1; await null; text += item.next1; } return text; }
  later([new Source(1), { next1: "d" }, new Source(5)]).then(text => {
    say("async", text);
    console.log(lines.join("\n"));
  });
}

// GENERATED: Field once Counted walk
// CHECK-LABEL: function {{*}}name="Field"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=DerivedConstructor flags=[HasRestParameter, HasNewTarget, TakesCallee, HasExplicitName] thisType={type=anything} parameters=[{type=Array flags=[IsFromCompiler]}] results=[{type=object flags=[IsFromCompiler]}] functionTypes={{*}}[[f_1]]] {
// CHECK-NEXT: b0(v0: function, v1: anything, v2: Array):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v3 = GetSuperBase v0
// CHECK-NEXT: v4 = SuperConstructList v3, v1, v2 layout=[[L_2]]
// CHECK-NEXT: v5 = Convert v4 declared={type=[[L_2]] flags=[IsFromCompiler]} illTypedCause=FromLooseType
// CHECK-NEXT: v6 = CallDirect v5 function=[[f_3]]
// CHECK-NEXT: Return v5
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="once"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Getter flags=[HasThis, HasExplicitName] thisType={type=[[L_4]] flags=[IsExpected]} results=[{type=undefined|null|string flags=[IsExpected]}] {
// CHECK-NEXT: b0(v0: [[L_4]]):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = Builtin builtin=Object
// CHECK-NEXT: v2 = Builtin builtin=ObjectDefineProperty
// CHECK-NEXT: v3 = Convert v0 declared={type=undefined|null|[[L_4]] flags=[IsExpected]}
// CHECK-NEXT: v4 = String string="once"
// CHECK-NEXT: v5 = String string="computed"
// CHECK-NEXT: v6 = Boolean boolean=true
// CHECK-NEXT: v7 = Convert v6 declared={type=undefined|boolean flags=[IsExpected]}
// CHECK-NEXT: v8 = NewObject -, v5 layout=[[L_5]] fields=[4]
// CHECK-NEXT: PropDefine v8, v7 key="configurable"
// CHECK-NEXT: v10 = FinishObject v8
// CHECK-NEXT: v11 = Call v2, v1, v3, v4, v10 calleeName="Object.defineProperty"
// CHECK-NEXT: v12 = String string="computing"
// CHECK-NEXT: v13 = Convert v12 declared={type=undefined|null|string flags=[IsExpected]}
// CHECK-NEXT: Return v13
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="Counted"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=BaseConstructor flags=[HasNewTarget, HasExplicitName] thisType={type=anything} results=[{type=object flags=[IsFromCompiler]}] {
// CHECK-NEXT: b0(v0: anything):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = GetConstructPrototype v0 layout=[[L_6]]
// CHECK-NEXT: v2 = NewObject v1 layout=[[L_6]]
// CHECK-NEXT: v3 = Convert v2 declared={type=[[L_6]] flags=[IsFromCompiler]} illTypedCause=FromLooseType
// CHECK-NEXT: v4 = Convert v3 declared={type=undefined|null|[[L_6]] flags=[IsExpected]}
// CHECK-NEXT: v5 = Integer integer=200
// CHECK-NEXT: v6 = Convert v5 declared={type=number flags=[IsExpected]}
// CHECK-NEXT: PropSet v4, v6 key="left"
// CHECK-NEXT: v8 = Undefined
// CHECK-NEXT: v9 = TypeTest v8 testedType=object
// CHECK-NEXT: Branch v9 -> taken b2(| 0), notTaken b3(| 0)
// CHECK-NEXT: b2(v10):
// CHECK-NEXT: Jump -> next b4(v10)
// CHECK-NEXT: b3(v11):
// CHECK-NEXT: Jump -> next b4(v3)
// CHECK-NEXT: b4(v12):
// CHECK-NEXT: Return v12
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="walk"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsGenerator, HasThis, TakesCallee, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=undefined|null|Array<undefined|null|number|string|symbol|bigint|[[L_7]]> flags=[IsExpected]}] results=[{type=undefined|null|Generator flags=[IsExpected]}] {
// CHECK-NEXT: b0(v0: anything, v1: function, v2: undefined|null|Array<undefined|null|number|string|symbol|bigint|[[L_7]]>):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: InitialYield v2
// CHECK-NEXT: v4 = IteratorOpen v2
// CHECK-NEXT: Jump -> next b2()
// CHECK-NEXT: b2():
// CHECK-NEXT: LoopHint
// CHECK-NEXT: v6 = IteratorResume v4
// CHECK-NEXT: v7 = ResultAt v6
// CHECK-NEXT: v8 = ResultAt v6 index=1
// CHECK-NEXT: Branch v7 -> taken b3(), notTaken b4()
// CHECK-NEXT: b3():
// CHECK-NEXT: v9 = Undefined
// CHECK-NEXT: Return v9
// CHECK-NEXT: b4():
// CHECK-NEXT: Jump -> next b5()
// CHECK-NEXT: b5() handler=b10():
// CHECK-NEXT: v10 = Convert v8 declared={type=undefined|null|number|string|symbol|bigint|[[L_7]] flags=[IsExpected]}
// CHECK-NEXT: v11 = PropGet v10 key="next1"
// CHECK-NEXT: v12 = Yield v11, v2
// CHECK-NEXT: v13 = ResultAt v12
// CHECK-NEXT: v14 = ResultAt v12 index=1
// CHECK-NEXT: Switch v14 cases=[1, 2] -> case b6(), case b7(), otherwise b9()
// CHECK-NEXT: b6() handler=b10():
// CHECK-NEXT: Throw v13
// CHECK-NEXT: b7() handler=b10():
// CHECK-NEXT: Jump -> next b8(v13)
// CHECK-NEXT: b8(v15):
// CHECK-NEXT: IteratorClose v4
// CHECK-NEXT: Return v15
// CHECK-NEXT: b9() handler=b10():
// CHECK-NEXT: Jump -> next b2()
// CHECK-NEXT: b10() role=IterationCleanup subject=v4:
// CHECK-NEXT: v17 = CatchException
// CHECK-NEXT: IteratorClose v4 completion=Throw
// CHECK-NEXT: Rethrow v17
// CHECK-NEXT: }
