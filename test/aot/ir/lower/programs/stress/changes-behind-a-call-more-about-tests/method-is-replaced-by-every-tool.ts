// RUN: lower
// OPTIONS: builtin-modules

// The holder calls a method, reads a getter of the class and walks the object with for-of, makes a call, and does all three again. Below the call one of the three members is replaced, hidden or taken away,
// each time by another tool than a plain assignment to the prototype object: Object.assign, defineProperty and defineProperties, Reflect, a proxy without traps around the prototype object,
// a new parent for it, an own property of the instance, a class field defined on the instance.
class Base {
  label(): string {
    return "base";
  }
}
class Bag extends Base {
  size: number;
  constructor(size: number) {
    super();
    this.size = size;
  }
  twice(): number {
    return this.size * 2;
  }
  get half(): number {
    return this.size / 2;
  }
  *[Symbol.iterator](): Generator<number> {
    yield this.size;
    yield this.size + 1;
  }
}

const own = Object.getOwnPropertyDescriptors(Bag.prototype);
function repair(): void {
  for (const name of Reflect.ownKeys(Bag.prototype)) if (!(name in own)) delete (Bag.prototype as any)[name];
  Object.defineProperties(Bag.prototype, own);
  Object.setPrototypeOf(Bag.prototype, Base.prototype);
}

const handsBack = function (this: any, o: any): any {
  return o;
} as any;
class Stamp extends handsBack {
  twice = () => -11;
}

const ways: ((bag: any) => void)[] = [
  () => void Object.assign(Bag.prototype, { twice: () => -1 }),
  () => void Object.defineProperty(Bag.prototype, "twice", { value: () => -2, configurable: true, writable: true }),
  () => void Object.defineProperties(Bag.prototype, { half: { get: () => -3, configurable: true } }),
  () => void Reflect.set(Bag.prototype, "twice", () => -4),
  () => void Reflect.defineProperty(Bag.prototype, "half", { value: -5, configurable: true }),
  () => void Reflect.deleteProperty(Bag.prototype, "twice"),
  () => void (new Proxy(Bag.prototype, {}).twice = () => -6),
  () => void delete (new Proxy(Bag.prototype, {}) as any).half,
  () => void Object.setPrototypeOf(Bag.prototype, { label: () => "another parent" }),
  () => void ((Bag.prototype as any).__proto__ = { label: () => "__proto__" }),
  () => void ((Bag.prototype as any).label = () => "in front"),
  () => void ((Bag.prototype as any)[Symbol.iterator] = function* () { yield -7; }),
  () => void Reflect.deleteProperty(Base.prototype, "label"),
  bag => void Object.defineProperty(bag, "twice", { value: () => -8, configurable: true }),
  bag => void Object.defineProperty(bag, "half", { get: () => -9, configurable: true }),
  bag => void (bag[Symbol.iterator] = function* () { yield -10; }),
  bag => void new (Stamp as any)(bag),
  bag => void Object.assign(bag, { label: () => "own" }),
];
const labelOfBase = Base.prototype.label;

let way = -1;
function touch(bag: Bag): number {
  if (way >= 0) ways[way](bag);
  return 1;
}

function holder(bag: Bag): string {
  let before = bag.twice() + "," + bag.half + "," + bag.label();
  for (const value of bag) before += "," + value;
  const got = touch(bag);
  let twice: string;
  try {
    twice = "" + bag.twice();
  } catch (error) {
    twice = (error as Error).name;
  }
  let label: string;
  try {
    label = bag.label();
  } catch (error) {
    label = (error as Error).name;
  }
  let after = twice + "," + bag.half + "," + label;
  for (const value of bag) after += "," + value;
  return before + " " + got + " " + after;
}

for (let round = 0; round < 50 * ways.length; round++) {
  way = round % 50 === 49 ? (round - 49) / 50 : -1;
  const line = holder(new Bag(round));
  if (way >= 0) {
    repair();
    Base.prototype.label = labelOfBase;
  }
  if (way >= 0 || round === 0) console.log(round + ": " + line);
}

// GENERATED: Base Bag [Symbol.iterator] Stamp
// CHECK-LABEL: function {{*}}name="Base"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=BaseConstructor flags=[HasNewTarget, IsChecked, HasExplicitName] thisType={type=anything} results=[{type=object flags=[IsFromCompiler]}] functionTypes={{*}}[[f_1]]] {
// CHECK-NEXT: b0(v0: anything):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = GetConstructPrototype v0 layout=[[L_2]]
// CHECK-NEXT: v2 = NewObject v1 layout=[[L_2]]
// CHECK-NEXT: v3 = Convert v2 declared={type=[[L_2]] flags=[IsFromCompiler]} illTypedCause=FromLooseType
// CHECK-NEXT: Return v3
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="Bag"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=DerivedConstructor flags=[HasNewTarget, TakesCallee, IsChecked, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=number site=[[w_3]]}] results=[{type=object flags=[IsFromCompiler]}] functionTypes={{*}}[[f_4]]] {
// CHECK-NEXT: b0(v0: function, v1: anything, v2: number):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v3 = Absent
// CHECK-NEXT: v4 = GetSuperBase v0
// CHECK-NEXT: v5 = SuperConstruct v4, v1 layout=[[L_5]]
// CHECK-NEXT: v6 = Convert v5 declared={type=[[L_5]] flags=[IsFromCompiler]} illTypedCause=FromLooseType
// CHECK-NEXT: v7 = TypeTest v3 testedType=absent
// CHECK-NEXT: Branch v7 -> taken b2(| 0), notTaken b12(| 0)
// CHECK-NEXT: b2(v8):
// CHECK-NEXT: v9 = CallDirect v6 function=[[f_6]]
// CHECK-NEXT: v10 = TypeTest v6 testedType=absent
// CHECK-NEXT: Branch v10 -> taken b3(| 0), notTaken b4(| 0)
// CHECK-NEXT: b3(v11) frequency=Unlikely:
// CHECK-NEXT: v12 = NewRuntimeError runtimeError=UninitializedThis
// CHECK-NEXT: Throw v12
// CHECK-NEXT: b4(v13):
// CHECK-NEXT: v14 = Convert v2 declared={type=number site=[[w_7]]}
// CHECK-NEXT: PropSet v13, v14 key="size"
// CHECK-NEXT: v16 = Undefined
// CHECK-NEXT: v17 = TypeTest v16 testedType=object
// CHECK-NEXT: Branch v17 -> taken b5(| 0), notTaken b6(| 0)
// CHECK-NEXT: b5(v18):
// CHECK-NEXT: Jump -> next b10(v18)
// CHECK-NEXT: b6(v19):
// CHECK-NEXT: v20 = TypeTest v19 testedType=undefined
// CHECK-NEXT: Branch v20 -> taken b7(| 0), notTaken b11(| 0)
// CHECK-NEXT: b7(v21):
// CHECK-NEXT: v22 = TypeTest v13 testedType=absent
// CHECK-NEXT: Branch v22 -> taken b8(| 0), notTaken b9(| 0)
// CHECK-NEXT: b8(v23) frequency=Unlikely:
// CHECK-NEXT: v24 = NewRuntimeError runtimeError=UninitializedThis
// CHECK-NEXT: Throw v24
// CHECK-NEXT: b9(v25):
// CHECK-NEXT: Jump -> next b10(v25)
// CHECK-NEXT: b10(v26):
// CHECK-NEXT: Return v26
// CHECK-NEXT: b11(v27) frequency=Unlikely:
// CHECK-NEXT: v28 = NewRuntimeError runtimeError=DerivedConstructorResult name="Bag"
// CHECK-NEXT: Throw v28
// CHECK-NEXT: b12(v29) frequency=Unlikely:
// CHECK-NEXT: v30 = NewRuntimeError runtimeError=ThisAlreadyBound
// CHECK-NEXT: Throw v30
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="[Symbol.iterator]"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Method flags=[IsGenerator, HasThis, TakesCallee, IsChecked, IsNamedByComputedKey] thisType={type=[[L_5]] site=[[w_8]]} results=[{type=undefined|null|Generator<number> flags=[IsExpected, OmitsNull, OmitsUndefined]}] {
// CHECK-NEXT: b0(v0: [[L_5]], v1: function):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: InitialYield
// CHECK-NEXT: v3 = PropGet v0 key="size"
// CHECK-NEXT: v4 = Convert v3 declared={type=number site=[[w_9]]}
// CHECK-NEXT: v5 = Yield v4
// CHECK-NEXT: v6 = ResultAt v5
// CHECK-NEXT: v7 = ResultAt v5 index=1
// CHECK-NEXT: Switch v7 cases=[1, 2] -> case b2(), case b3(), otherwise b4()
// CHECK-NEXT: b2():
// CHECK-NEXT: Throw v6
// CHECK-NEXT: b3():
// CHECK-NEXT: Return v6
// CHECK-NEXT: b4():
// CHECK-NEXT: v8 = PropGet v0 key="size"
// CHECK-NEXT: v9 = Integer integer=1
// CHECK-NEXT: v10 = Add v8, v9
// CHECK-NEXT: v11 = Convert v10 declared={type=number site=[[w_9]]}
// CHECK-NEXT: v12 = Yield v11
// CHECK-NEXT: v13 = ResultAt v12
// CHECK-NEXT: v14 = ResultAt v12 index=1
// CHECK-NEXT: Switch v14 cases=[1, 2] -> case b5(), case b6(), otherwise b7()
// CHECK-NEXT: b5():
// CHECK-NEXT: Throw v13
// CHECK-NEXT: b6():
// CHECK-NEXT: Return v13
// CHECK-NEXT: b7():
// CHECK-NEXT: v15 = Undefined
// CHECK-NEXT: Return v15
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="Stamp"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=DerivedConstructor flags=[HasRestParameter, HasNewTarget, TakesCallee, IsChecked, HasExplicitName] thisType={type=anything} parameters=[{type=Array flags=[IsFromCompiler]}] results=[{type=object flags=[IsFromCompiler]}] {
// CHECK-NEXT: b0(v0: function, v1: anything, v2: Array):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v3 = GetSuperBase v0
// CHECK-NEXT: v4 = SuperConstructList v3, v1, v2 layout=[[L_10]]
// CHECK-NEXT: v5 = Convert v4 declared={type=[[L_10]] flags=[IsFromCompiler]} illTypedCause=FromLooseType
// CHECK-NEXT: v6 = CallDirect v5 function=[[f_11]]
// CHECK-NEXT: Return v5
// CHECK-NEXT: }
