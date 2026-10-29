// RUN: lower
// OPTIONS: builtin-modules

// A class stores to one of its own methods, `this.name = ..`: the object has the property as its own from then on, and any other object of the class finds the method.
function said(f: () => unknown): string { try { return String(f()); } catch (e) { return "threw " + (e as Error).name; } }
function row(label: string, f: () => unknown) { console.log(label + ": " + said(f)); }
const keys = (o: object) => Object.keys(o).join();

class Base<T> {
  total = 0;
  next(value: T): void { this._next(value); }
  protected _next(value: T): void { this.total++; }
  seen(): string { return keys(this) + "|" + Object.prototype.hasOwnProperty.call(this, "_next") + "|" + ("_next" in this); }
}
class Derived<T> extends Base<T> {
  last = "none";
  constructor(onNext?: (value: T) => void) {
    super();
    this._next = onNext ? function (this: Derived<T>, value: T) { onNext(value); this.total += 2; } : super._next;
  }
}
class Plain<T> extends Base<T> {
  more = 1;
}
class Overriding<T> extends Base<T> {
  protected _next(value: T): void { this.total += 10; }
}
class Late<T> extends Base<T> {
  swap(): void { this._next = () => { this.total += 100; }; }
}

let sink = 0;
const derived = new Derived<number>(value => { sink += value; });
const inherits = new Derived<number>();
const plain = new Plain<number>();
const base = new Base<number>();
const overriding = new Overriding<number>();
const late = new Late<number>();
for (const one of [derived, inherits, plain, base, overriding, late] as Base<number>[]) { one.next(5); one.next(6); }
row("totals", () => [derived.total, inherits.total, plain.total, base.total, overriding.total, late.total, sink].join());
row("an object that stored a function", () => derived.seen());
row("an object that stored the method it inherits", () => inherits.seen());
row("an object of a class that stores nothing", () => plain.seen());
row("an object of the class that declares the method", () => base.seen());
row("an object of a class that overrides it", () => overriding.seen());
row("before the store", () => late.seen());
late.swap();
late.next(1);
row("after the store", () => late.seen() + "|" + late.total);
row("JSON", () => JSON.stringify([derived, inherits, plain, late]));
row("entries", () => Object.entries(derived).map(([key, value]) => key + ":" + typeof value).join());
row("spread", () => keys({ ...derived }) + "|" + keys({ ...plain }));
row("for in", () => { const found: string[] = []; for (const key in late) found.push(key); return found.join(); });
row("own names", () => Object.getOwnPropertyNames(inherits).join() + "|" + Object.getOwnPropertyNames(base).join());
row("the descriptor", () => JSON.stringify(Object.getOwnPropertyDescriptor(derived, "_next")) + "|" + Object.getOwnPropertyDescriptor(plain, "_next"));
row("the prototype keeps the method", () => Object.getOwnPropertyNames(Base.prototype).join() + "|" + ((inherits as any)._next === (Base.prototype as any)._next) + "|" + ((derived as any)._next === (Base.prototype as any)._next));
row("the method of the class, read from an object that has none of its own", () => ((plain as any)._next === (Base.prototype as any)._next) + "|" + ((overriding as any)._next === (Overriding.prototype as any)._next));
row("deleted", () => { delete (late as any)._next; late.next(1); return late.seen() + "|" + late.total; });
row("stored again", () => { late.swap(); late.next(1); return late.seen() + "|" + late.total; });
row("stored by untyped code", () => { (plain as any)._next = function (this: any) { this.total += 1000; }; plain.next(1); return plain.seen() + "|" + plain.total; });
row("stored by a computed key", () => { const key: string = ["_", "next"].join(""); (base as any)[key] = function (this: any) { this.total += 7; }; base.next(1); return base.seen() + "|" + base.total; });
row("frozen", () => { const frozen = Object.freeze(new Late<number>()); return said(() => frozen.swap()) + "|" + frozen.seen(); });

class Counter {
  total = 0;
  constructor() {
    this.add = this.add.bind(this);
  }
  add(value: number): void { this.total += value; }
}
class Unbound {
  total = 0;
  add(value: number): void { this.total += value; }
}
const counter = new Counter();
const add = counter.add;
add(2);
counter.add(3);
row("bound to its object", () => counter.total + "|" + keys(counter) + "|" + (counter.add === Counter.prototype.add) + "|" + counter.add.name + "|" + counter.add.length);
row("taken off an object that binds nothing", () => { const unbound = new Unbound(); const taken = unbound.add; return said(() => taken(1)) + "|" + (taken === Unbound.prototype.add) + "|" + keys(unbound); });

interface Sink { push(value: number): void; }
class Collector implements Sink {
  held: number[] = [];
  constructor(doubles: boolean) {
    if (doubles) this.push = value => { this.held.push(value * 2); };
  }
  push(value: number): void { this.held.push(value); }
}
const literal = { held: [] as number[], push(value: number) { this.held.push(-value); } };
const sinks: Sink[] = [new Collector(false), new Collector(true), literal];
for (const one of sinks) one.push(4);
row("through an interface", () => sinks.map(one => (one as Collector).held.join() + ":" + keys(one)).join("|"));
row("an optional call", () => { const maybe: Collector | undefined = sinks[1] as Collector; maybe?.push?.(1); return maybe.held.join(); });
row("read as a value and called", () => { const first = sinks[0] as Collector; const push = first.push; push.call(first, 9); return first.held.join(); });

class Patched {
  value(): number { return 1; }
  own(): void { this.value = () => 2; }
}
const patched = new Patched();
const other = new Patched();
other.value = () => 3;
row("a store through a variable besides", () => [patched.value(), other.value()].join());
patched.own();
row("and through this", () => [patched.value(), other.value(), new Patched().value(), keys(patched), keys(other)].join());

class Shared {
  static make(): string { return "static"; }
  make(): string { return "method"; }
  remake(): void { this.make = () => "own"; }
}
const shared = new Shared();
shared.remake();
row("a static method of the same name", () => [Shared.make(), shared.make(), new Shared().make()].join());

// GENERATED: said seen Counter keys Plain
// CHECK-LABEL: function {{*}}name="said"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=undefined|null|[[f_1]] site=[[w_2]] flags=[OmitsNull, OmitsUndefined]}] results=[{type=undefined|null|string site=[[w_3]] flags=[OmitsNull, OmitsUndefined]}] {
// CHECK-NEXT: b0(v0: undefined|null|[[f_1]]):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: Jump -> next b2()
// CHECK-NEXT: b2() handler=b3():
// CHECK-NEXT: v1 = Builtin builtin=String
// CHECK-NEXT: v2 = Call v0 calleeName="f"
// CHECK-NEXT: v3 = Call v1, -, v2 calleeName="String"
// CHECK-NEXT: v4 = Convert v3 declared={type=undefined|null|string site=[[w_4]] flags=[OmitsNull, OmitsUndefined]} illTypedCause=DeclarationWithoutBody
// CHECK-NEXT: Return v4
// CHECK-NEXT: b3() role=CatchHandler:
// CHECK-NEXT: v5 = CatchValue
// CHECK-NEXT: v6 = String string="threw "
// CHECK-NEXT: v7 = Convert v5 declared={type=undefined|null|Error flags=[IsExpected, OmitsNull, OmitsUndefined]}
// CHECK-NEXT: v8 = PropGet v7 key="name"
// CHECK-NEXT: v9 = Convert v8 declared={type=undefined|null|string site=[[w_5]]} illTypedCause=Assertion
// CHECK-NEXT: v10 = Add v6, v9
// CHECK-NEXT: v11 = Convert v10 declared={type=undefined|null|string site=[[w_3]] flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: Return v11
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="seen"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Method flags=[HasThis, IsChecked, HasExplicitName] thisType={type=[[L_6]] site=[[w_7]]} results=[{type=undefined|null|string site=[[w_8]] flags=[OmitsNull, OmitsUndefined]}] functionTypes={{*}}[[f_9]]] {
// CHECK-NEXT: b0(v0: [[L_6]]):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = GetModuleVariable variable=[[g_10]]
// CHECK-NEXT: v2 = CheckInitialized v1 name="keys"
// CHECK-NEXT: v3 = Call v2, -, v0 calleeName="keys"
// CHECK-NEXT: v4 = Convert v3 declared={type=undefined|null|string site=[[w_11]] flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: v5 = String string="|"
// CHECK-NEXT: v6 = Add v4, v5
// CHECK-NEXT: v7 = Builtin builtin=ObjectPrototypeHasOwnProperty
// CHECK-NEXT: v8 = PropGet v7 key="call"
// CHECK-NEXT: v9 = Convert v8 declared={type=builtin(FunctionPrototypeCall) flags=[IsExpected]}
// CHECK-NEXT: v10 = String string="_next"
// CHECK-NEXT: v11 = Call v9, v7, v0, v10 calleeKey="call" calleeName="Object.prototype.hasOwnProperty.call"
// CHECK-NEXT: v12 = Convert v11 declared={type=boolean site=[[w_12]]} illTypedCause=FromLooseType
// CHECK-NEXT: v13 = Add v6, v12
// CHECK-NEXT: v14 = String string="|"
// CHECK-NEXT: v15 = Add v13, v14
// CHECK-NEXT: v16 = PropHas v0 key="_next"
// CHECK-NEXT: v17 = Add v15, v16
// CHECK-NEXT: v18 = Convert v17 declared={type=undefined|null|string site=[[w_8]] flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: Return v18
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="Counter"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=BaseConstructor flags=[HasNewTarget, IsChecked, HasExplicitName] thisType={type=anything} results=[{type=object flags=[IsFromCompiler]}] {
// CHECK-NEXT: b0(v0: anything):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = GetConstructPrototype v0 layout=[[L_13]]
// CHECK-NEXT: v2 = NewObject v1 layout=[[L_13]]
// CHECK-NEXT: v3 = Convert v2 declared={type=[[L_13]] flags=[IsFromCompiler]} illTypedCause=FromLooseType
// CHECK-NEXT: v4 = CallDirect v3 function=[[f_14]]
// CHECK-NEXT: v5 = PropGet v3 key="add"
// CHECK-NEXT: v6 = PropGet v5 key="bind"
// CHECK-NEXT: v7 = Call v6, v5, v3 calleeKey="bind" calleeName="this.add.bind"
// CHECK-NEXT: v8 = Convert v7 declared={type=undefined|null|[[f_15]] site=[[w_16]] flags=[OmitsNull, OmitsUndefined]} illTypedCause=FromLooseType
// CHECK-NEXT: PropSet v3, v8 key="add"
// CHECK-NEXT: v10 = Undefined
// CHECK-NEXT: v11 = TypeTest v10 testedType=object
// CHECK-NEXT: Branch v11 -> taken b2(| 0), notTaken b3(| 0)
// CHECK-NEXT: b2(v12):
// CHECK-NEXT: Jump -> next b4(v12)
// CHECK-NEXT: b3(v13):
// CHECK-NEXT: Jump -> next b4(v3)
// CHECK-NEXT: b4(v14):
// CHECK-NEXT: Return v14
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="keys"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Arrow flags=[IsChecked] length=1 thisType={type=anything} parameters=[{type=undefined|null|object site=[[w_17]] flags=[OmitsNull, OmitsUndefined]}] results=[{type=undefined|null|string site=[[w_18]] flags=[OmitsNull, OmitsUndefined]}] functionTypes={{*}}[[f_19]]] {
// CHECK-NEXT: b0(v0: undefined|null|object):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = Builtin builtin=Object
// CHECK-NEXT: v2 = Builtin builtin=ObjectKeys
// CHECK-NEXT: v3 = Call v2, v1, v0 calleeName="Object.keys"
// CHECK-NEXT: v4 = Convert v3 declared={type=undefined|null|Array<undefined|null|string> site=[[w_20]] flags=[OmitsNull, OmitsUndefined]} illTypedCause=DeclarationWithoutBody
// CHECK-NEXT: v5 = PropGet v4 key="join"
// CHECK-NEXT: v6 = Call v5, v4 calleeKey="join" calleeName="join"
// CHECK-NEXT: ReturnCall v6 casts=[{declared={type=undefined|null|string site=[[w_20]] flags=[OmitsNull, OmitsUndefined]}}, {declared={type=undefined|null|string site=[[w_18]] flags=[OmitsNull, OmitsUndefined]}}]
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="Plain"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=DerivedConstructor flags=[HasRestParameter, HasNewTarget, TakesCallee, IsChecked, HasExplicitName] thisType={type=anything} parameters=[{type=Array flags=[IsFromCompiler]}] results=[{type=object flags=[IsFromCompiler]}] functionTypes={{*}}[[f_21]]] {
// CHECK-NEXT: b0(v0: function, v1: anything, v2: Array):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v3 = GetSuperBase v0
// CHECK-NEXT: v4 = SuperConstructList v3, v1, v2 layout=[[L_22]]
// CHECK-NEXT: v5 = Convert v4 declared={type=[[L_22]] flags=[IsFromCompiler]} illTypedCause=FromLooseType
// CHECK-NEXT: v6 = CallDirect v5 function=[[f_23]]
// CHECK-NEXT: Return v5
// CHECK-NEXT: }
