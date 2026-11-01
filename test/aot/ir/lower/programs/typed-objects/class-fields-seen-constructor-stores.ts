// RUN: lower
// OPTIONS: builtin-modules

// Class fields seen before the constructor stores them.
const seen: string[] = [];
function note(label: string, value: unknown): void {
  seen.push(label + "=" + (value === undefined ? "undefined" : JSON.stringify(value)));
}
function keysOf(value: object): string {
  return Object.keys(value).join(",");
}

class Filled {
  count: number;
  ratio: number;
  flag: boolean;
  label: string;
  link: Filled | null;
  next: Filled;
  constructor(seed: number) {
    this.next = this;
    this.link = null;
    this.label = "l" + seed;
    this.flag = seed > 1;
    this.ratio = seed + 0.5;
    this.count = seed | 0;
  }
}

class ReadsFirst {
  count: number;
  constructor(seed: number) {
    note("ReadsFirst.count", (this as any).count);
    note("ReadsFirst has count", "count" in this);
    this.count = seed;
  }
}

class CallsMethod {
  first: number;
  second: number;
  constructor(seed: number) {
    this.first = seed;
    this.show();
    this.second = seed;
  }
  show(): void {
    note("CallsMethod.first", this.first);
    note("CallsMethod.second", this.second);
  }
}

class CapturesThis {
  count: number;
  read: () => number;
  constructor(seed: number) {
    this.read = () => this.count;
    note("CapturesThis.count", this.read());
    this.count = seed;
  }
}

class InitializerReads {
  count: number;
  early = (this as any).count as unknown;
  constructor(seed: number) {
    this.count = seed;
  }
}

class StoresOnOnePath {
  count!: number;
  constructor(seed: number) {
    if (seed > 1) this.count = seed;
  }
}

class ReadsItselfBack {
  self: ReadsItselfBack;
  count: number;
  constructor(seed: number) {
    this.self = this;
    note("ReadsItselfBack.count", this.self.count);
    this.count = seed;
  }
}

class ListsKeys {
  first: number;
  second: number;
  constructor(seed: number) {
    this.second = seed;
    note("ListsKeys", keysOf(this) + ":" + JSON.stringify(this));
    this.first = seed;
  }
}

const registry: object[] = [];
class Registers {
  constructor() {
    registry.push(this);
  }
}
class BelowRegisters extends Registers {
  early: number;
  late: number;
  constructor(seed: number) {
    super();
    this.early = seed;
    note("BelowRegisters.late", (registry[registry.length - 1] as BelowRegisters).late);
    this.late = seed;
  }
}

class Below extends Filled {
  extra: number;
  other: Filled;
  constructor(seed: number, other: Filled) {
    super(seed);
    this.extra = seed + 1;
    this.other = other;
  }
}

class Redeclares extends Filled {
  count: number;
  constructor(seed: number) {
    super(seed);
    note("Redeclares.count", (this as any).count);
    this.count = seed + 100;
  }
}

class ReverseOrder {
  z: number;
  y: number;
  x: number;
  constructor() {
    this.x = 1;
    this.y = 2;
    this.z = 3;
  }
}

let halfMade: ThrowsHalfway | undefined;
class ThrowsHalfway {
  first: number;
  second: number;
  constructor(seed: number, leak: boolean) {
    this.first = seed;
    if (leak) halfMade = this;
    if (seed > 5) throw new RangeError("too large");
    this.second = seed;
  }
}

class SetterBelow extends Filled {}
Object.defineProperty(SetterBelow.prototype, "count", {
  set(value: number) {
    note("SetterBelow.set count", value);
  },
  get() {
    return -1;
  },
  configurable: true,
});

function sum(head: Filled, steps: number): number {
  let total = 0;
  let at = head;
  for (let i = 0; i < steps; i++) {
    total = (total + at.count) | 0;
    total += at.ratio;
    if (at.flag) total += at.label.length;
    if (at.link !== null) total += at.link.count;
    at = at.next;
  }
  return total;
}

const a = new Filled(1), b = new Filled(2);
a.next = b;
b.next = a;
b.link = a;
console.log(sum(a, 1000), keysOf(a), JSON.stringify({ ...a, next: 0, link: 0 }));
console.log(new Filled(-2147483648).count, new Filled(-2147483646).count, new Filled(2147483647).count);
new ReadsFirst(1);
new CallsMethod(2);
new CapturesThis(3);
console.log(new InitializerReads(4).early, keysOf(new InitializerReads(4)));
console.log("count" in new StoresOnOnePath(0), new StoresOnOnePath(0).count, new StoresOnOnePath(2).count);
new ReadsItselfBack(5);
new ListsKeys(6);
new BelowRegisters(7);
const below = new Below(8, a);
console.log(below.extra, below.other === a, below.count, keysOf(below), sum(below, 3));
console.log(new Redeclares(9).count, keysOf(new Redeclares(9)));
console.log(keysOf(new ReverseOrder()));
for (const leak of [false, true]) {
  try {
    new ThrowsHalfway(9, leak);
  } catch (error) {
    console.log((error as Error).message, halfMade === undefined ? "nothing" : keysOf(halfMade) + ":" + halfMade.first + ":" + halfMade.second);
  }
}
const withSetter = new SetterBelow(10);
console.log(withSetter.count, keysOf(withSetter), Object.getOwnPropertyDescriptor(withSetter, "count")?.value);
console.log(seen.join("\n"));

// GENERATED: keysOf show Redeclares SetterBelow
// CHECK-LABEL: function {{*}}name="keysOf"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=undefined|null|object site=[[w_1]] flags=[OmitsNull, OmitsUndefined]}] results=[{type=undefined|null|string site=[[w_2]] flags=[OmitsNull, OmitsUndefined]}] {
// CHECK-NEXT: b0(v0: undefined|null|object):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = Builtin builtin=Object
// CHECK-NEXT: v2 = Builtin builtin=ObjectKeys
// CHECK-NEXT: v3 = Call v2, v1, v0 calleeName="Object.keys"
// CHECK-NEXT: v4 = Convert v3 declared={type=undefined|null|Array<undefined|null|string> site=[[w_3]] flags=[OmitsNull, OmitsUndefined]} illTypedCause=DeclarationWithoutBody
// CHECK-NEXT: v5 = PropGet v4 key="join"
// CHECK-NEXT: v6 = String string=","
// CHECK-NEXT: v7 = Call v5, v4, v6 calleeKey="join" calleeName="join"
// CHECK-NEXT: ReturnCall v7 casts=[{declared={type=undefined|null|string site=[[w_3]] flags=[OmitsNull, OmitsUndefined]}}, {declared={type=undefined|null|string site=[[w_2]] flags=[OmitsNull, OmitsUndefined]}}]
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="show"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Method flags=[HasThis, IsChecked, HasExplicitName] thisType={type=[[L_4]] site=[[w_5]]} results=[{type=anything}] {
// CHECK-NEXT: b0(v0: [[L_4]]):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = GetModuleVariable variable=[[g_6]]
// CHECK-NEXT: v2 = String string="CallsMethod.first"
// CHECK-NEXT: v3 = PropGet v0 key="first"
// CHECK-NEXT: v4 = Call v1, -, v2, v3 calleeName="note"
// CHECK-NEXT: v5 = GetModuleVariable variable=[[g_6]]
// CHECK-NEXT: v6 = String string="CallsMethod.second"
// CHECK-NEXT: v7 = PropGet v0 key="second"
// CHECK-NEXT: v8 = Call v5, -, v6, v7 calleeName="note"
// CHECK-NEXT: v9 = Undefined
// CHECK-NEXT: Return v9
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="Redeclares"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=DerivedConstructor flags=[HasNewTarget, TakesCallee, IsChecked, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=number site=[[w_7]]}] results=[{type=object flags=[IsFromCompiler]}] functionTypes={{*}}[[f_8]]] {
// CHECK-NEXT: b0(v0: function, v1: anything, v2: number):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v3 = Absent
// CHECK-NEXT: v4 = GetSuperBase v0
// CHECK-NEXT: v5 = SuperConstruct v4, v1, v2 layout=[[L_9]]
// CHECK-NEXT: v6 = Convert v5 declared={type=[[L_9]] flags=[IsFromCompiler]} illTypedCause=FromLooseType
// CHECK-NEXT: v7 = TypeTest v3 testedType=absent
// CHECK-NEXT: Branch v7 -> taken b2(| 0), notTaken b14(| 0)
// CHECK-NEXT: b2(v8):
// CHECK-NEXT: v9 = CallDirect v6 function=[[f_10]]
// CHECK-NEXT: v10 = GetModuleVariable variable=[[g_6]]
// CHECK-NEXT: v11 = String string="Redeclares.count"
// CHECK-NEXT: v12 = TypeTest v6 testedType=absent
// CHECK-NEXT: Branch v12 -> taken b3(| 0), notTaken b4(| 0)
// CHECK-NEXT: b3(v13) frequency=Unlikely:
// CHECK-NEXT: v14 = NewRuntimeError runtimeError=UninitializedThis
// CHECK-NEXT: Throw v14
// CHECK-NEXT: b4(v15):
// CHECK-NEXT: v16 = Convert v15 declared={type=undefined|null|number|string|symbol|bigint|[[L_11]] flags=[IsExpected]}
// CHECK-NEXT: v17 = PropGet v16 key="count"
// CHECK-NEXT: v18 = Call v10, -, v11, v17 calleeName="note"
// CHECK-NEXT: v19 = TypeTest v15 testedType=absent
// CHECK-NEXT: Branch v19 -> taken b5(| 0), notTaken b6(| 0)
// CHECK-NEXT: b5(v20) frequency=Unlikely:
// CHECK-NEXT: v21 = NewRuntimeError runtimeError=UninitializedThis
// CHECK-NEXT: Throw v21
// CHECK-NEXT: b6(v22):
// CHECK-NEXT: v23 = Integer integer=100
// CHECK-NEXT: v24 = Add v2, v23
// CHECK-NEXT: v25 = Convert v24 declared={type=number site=[[w_12]]}
// CHECK-NEXT: PropSet v22, v25 key="count"
// CHECK-NEXT: v27 = Undefined
// CHECK-NEXT: v28 = TypeTest v27 testedType=object
// CHECK-NEXT: Branch v28 -> taken b7(| 0), notTaken b8(| 0)
// CHECK-NEXT: b7(v29):
// CHECK-NEXT: Jump -> next b12(v29)
// CHECK-NEXT: b8(v30):
// CHECK-NEXT: v31 = TypeTest v30 testedType=undefined
// CHECK-NEXT: Branch v31 -> taken b9(| 0), notTaken b13(| 0)
// CHECK-NEXT: b9(v32):
// CHECK-NEXT: v33 = TypeTest v22 testedType=absent
// CHECK-NEXT: Branch v33 -> taken b10(| 0), notTaken b11(| 0)
// CHECK-NEXT: b10(v34) frequency=Unlikely:
// CHECK-NEXT: v35 = NewRuntimeError runtimeError=UninitializedThis
// CHECK-NEXT: Throw v35
// CHECK-NEXT: b11(v36):
// CHECK-NEXT: Jump -> next b12(v36)
// CHECK-NEXT: b12(v37):
// CHECK-NEXT: Return v37
// CHECK-NEXT: b13(v38) frequency=Unlikely:
// CHECK-NEXT: v39 = NewRuntimeError runtimeError=DerivedConstructorResult name="Redeclares"
// CHECK-NEXT: Throw v39
// CHECK-NEXT: b14(v40) frequency=Unlikely:
// CHECK-NEXT: v41 = NewRuntimeError runtimeError=ThisAlreadyBound
// CHECK-NEXT: Throw v41
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="SetterBelow"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=DerivedConstructor flags=[HasRestParameter, HasNewTarget, TakesCallee, IsChecked, HasExplicitName] thisType={type=anything} parameters=[{type=Array flags=[IsFromCompiler]}] results=[{type=object flags=[IsFromCompiler]}] functionTypes={{*}}[[f_13]]] {
// CHECK-NEXT: b0(v0: function, v1: anything, v2: Array):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v3 = GetSuperBase v0
// CHECK-NEXT: v4 = SuperConstructList v3, v1, v2 layout=[[L_14]]
// CHECK-NEXT: v5 = Convert v4 declared={type=[[L_14]] flags=[IsFromCompiler]} illTypedCause=FromLooseType
// CHECK-NEXT: Return v5
// CHECK-NEXT: }
