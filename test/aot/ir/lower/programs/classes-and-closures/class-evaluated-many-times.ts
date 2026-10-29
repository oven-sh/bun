// RUN: lower
// OPTIONS: builtin-modules

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

// GENERATED: makeCounter describe makeNamed next reveal
// CHECK-LABEL: function {{*}}name="makeCounter"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=number site=[[w_1]]}] results=[{type=undefined|null|[[f_2]] site=[[w_3]] flags=[OmitsNull, OmitsUndefined]}] {
// CHECK-NEXT: b0(v0: number):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = NewObject layout=[[L_4]]
// CHECK-NEXT: v2 = NewObject layout=[[L_5]]
// CHECK-NEXT: v3 = NewClassToken layout=[[L_6]]
// CHECK-NEXT: v4 = NewClosure v3 function=[[f_7]]
// CHECK-NEXT: v5 = NewClass v4 layout=[[L_6]]
// CHECK-NEXT: v6 = NewClosure v2, v3 function=[[f_8]]
// CHECK-NEXT: DefineMethod v5, v6 layout=[[L_6]] key="add"
// CHECK-NEXT: v8 = NewClosure function=[[f_9]]
// CHECK-NEXT: DefineMethod v5, v8 layout=[[L_6]] methodKind=Getter index=1 key="doubled"
// CHECK-NEXT: v10 = NewClosure v0 function=[[f_10]]
// CHECK-NEXT: PutEnvironmentField v2, v10 layout=[[L_5]] field=1
// CHECK-NEXT: v12 = NewClosure v1, v2, v5 function=[[f_11]]
// CHECK-NEXT: v13 = NewClosure v1, v5, v12 function=[[f_12]]
// CHECK-NEXT: DefineMethod v5, v13 layout=[[L_6]] side=Static index=2 key="zero"
// CHECK-NEXT: v15 = NewClosure v1, v2, v5 function=[[f_13]]
// CHECK-NEXT: DefineMethod v5, v15 layout=[[L_6]] side=Static index=3 key="created"
// CHECK-NEXT: v17 = FinishClass v5 layout=[[L_6]]
// CHECK-NEXT: v18 = Convert v17 declared={type=[[f_7]] flags=[IsFromCompiler]} illTypedCause=FromLooseType
// CHECK-NEXT: PutEnvironmentField v1, v18 layout=[[L_4]]
// CHECK-NEXT: v20 = Convert v17 declared={type=function flags=[IsFromCompiler]} illTypedCause=FromLooseType
// CHECK-NEXT: v21 = CallDirect v2, v5, v20 function=[[f_14]]
// CHECK-NEXT: v22 = Convert v17 declared={type=undefined|null|[[f_2]] site=[[w_3]] flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: Return v22
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="describe"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=undefined|null|object site=[[w_15]] flags=[OmitsNull, OmitsUndefined]}] results=[{type=undefined|null|string site=[[w_16]] flags=[OmitsNull, OmitsUndefined]}] {
// CHECK-NEXT: b0(v0: undefined|null|object):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = Builtin builtin=Reflect
// CHECK-NEXT: v2 = Builtin builtin=ReflectOwnKeys
// CHECK-NEXT: v3 = Call v2, v1, v0 calleeName="Reflect.ownKeys"
// CHECK-NEXT: v4 = Convert v3 declared={type=undefined|null|Array<undefined|null|string|symbol> site=[[w_17]] flags=[OmitsNull, OmitsUndefined]} illTypedCause=DeclarationWithoutBody
// CHECK-NEXT: v5 = PropGet v4 key="map"
// CHECK-NEXT: v6 = NewClosure v0 function=[[f_18]]
// CHECK-NEXT: v7 = Call v5, v4, v6 calleeKey="map" calleeName="map"
// CHECK-NEXT: v8 = Convert v7 declared={type=undefined|null|Array<undefined|null|string> site=[[w_17]] flags=[OmitsNull, OmitsUndefined]} illTypedCause=FromLooseType
// CHECK-NEXT: v9 = PropGet v8 key="join"
// CHECK-NEXT: v10 = String string=" "
// CHECK-NEXT: v11 = Call v9, v8, v10 calleeKey="join" calleeName="join"
// CHECK-NEXT: ReturnCall v11 casts=[{declared={type=undefined|null|string site=[[w_17]] flags=[OmitsNull, OmitsUndefined]}}, {declared={type=undefined|null|string site=[[w_16]] flags=[OmitsNull, OmitsUndefined]}}]
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="makeNamed"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=undefined|null|string site=[[w_19]] flags=[OmitsNull, OmitsUndefined]}] results=[{type=undefined|null|[[f_20]] site=[[w_21]] flags=[OmitsNull, OmitsUndefined]}] functionTypes={{*}}[[f_22]]] {
// CHECK-NEXT: b0(v0: undefined|null|string):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = NewDictionary
// CHECK-NEXT: v2 = ToPropertyKey v0
// CHECK-NEXT: v3 = NewClosure function=[[f_23]]
// CHECK-NEXT: SetFunctionName v3, v2
// CHECK-NEXT: v5 = NewClass v3 layout=[[L_24]]
// CHECK-NEXT: v6 = NewClosure function=[[f_25]]
// CHECK-NEXT: DefineMethod v5, v6 layout=[[L_24]] key="twice"
// CHECK-NEXT: v8 = NewClosure function=[[f_26]]
// CHECK-NEXT: DefineMethod v5, v8 layout=[[L_24]] side=Static index=1 key="create"
// CHECK-NEXT: v10 = FinishClass v5 layout=[[L_24]]
// CHECK-NEXT: v11 = Convert v10 declared={type=undefined|null|[[f_20]] site=[[w_27]] flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: ElemDefine v1, v2, v11
// CHECK-NEXT: v13 = ElemGet v1, v0
// CHECK-NEXT: v14 = Convert v13 declared={type=undefined|null|[[f_20]] site=[[w_27]] flags=[OmitsNull]} illTypedCause=FromLooseType
// CHECK-NEXT: Return v14
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="next"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Method flags=[IsChecked, HasExplicitName] captures=[{type=env [[L_28]] flags=[IsFromCompiler]}, {type=function flags=[IsFromCompiler]}, {type=anything}] thisType={type=anything} results=[{type=number site=[[w_29]]}] {
// CHECK-NEXT: b0(v0: env [[L_28]], v1: function, v2: anything):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v3 = GetEnvironmentField v0 layout=[[L_28]]
// CHECK-NEXT: v4 = CheckInitialized v3 name="Item"
// CHECK-NEXT: v5 = StrictEq v4, v1
// CHECK-NEXT: Branch v5 -> taken b2(), notTaken b3()
// CHECK-NEXT: b2():
// CHECK-NEXT: v6 = Call v2, v4 calleeName="Item.#bump"
// CHECK-NEXT: ReturnCall v6 casts=[{declared={type=number site=[[w_30]]}}, {declared={type=number site=[[w_29]]}}]
// CHECK-NEXT: b3() frequency=Unlikely:
// CHECK-NEXT: v7 = NewRuntimeError runtimeError=InvalidPrivateBrand
// CHECK-NEXT: Throw v7
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="reveal"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Method flags=[HasThis, IsChecked, HasExplicitName] captures=[{type=classtoken flags=[IsFromCompiler]}, {type=anything}] thisType={type=[[L_31]] site=[[w_32]]} results=[{type=undefined|null|string site=[[w_33]] flags=[OmitsNull, OmitsUndefined]}] {
// CHECK-NEXT: b0(v0: classtoken, v1: anything, v2: [[L_31]]):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v3 = PrivateGet v2, v0 layout=[[L_31]]
// CHECK-NEXT: v4 = Call v1, v2 calleeName="this.#hidden"
// CHECK-NEXT: ReturnCall v4 casts=[{declared={type=undefined|null|string site=[[w_34]] flags=[OmitsNull, OmitsUndefined]}}, {declared={type=undefined|null|string site=[[w_33]] flags=[OmitsNull, OmitsUndefined]}}]
// CHECK-NEXT: }
