// RUN: lower
// OPTIONS: builtin-modules

/**
 * @template T
 * @param {T} value
 * @returns {T}
 */
function same(value) {
  return value;
}

/**
 * @template T
 * @param {T[]} list
 * @returns {T | undefined}
 */
function last(list) {
  return list[list.length - 1];
}

/**
 * @template {{ id: number }} T
 * @param {T[]} rows
 * @param {number} id
 * @returns {T | undefined}
 */
function byId(rows, id) {
  return rows.find(row => row.id === id);
}

/**
 * @template K, V
 * @param {K} key
 * @param {V} value
 * @returns {[K, V]}
 */
function pair(key, value) {
  return [key, value];
}

/**
 * @template T
 * @template {keyof T} K
 * @param {T} object
 * @param {K} key
 * @returns {T[K]}
 */
function pick(object, key) {
  return object[key];
}

/**
 * @template T
 * @template [U=T[]]
 * @typedef {{ one: T, many: U }} Both
 */

/** @type {Both<number>} */
const both = { one: 1, many: [1, 2] };

/** @type {Both<number, string>} */
const other = { one: 1, many: "many" };

/**
 * @template T
 */
class Box {
  /** @param {T} content */
  constructor(content) {
    /** @type {T} */
    this.content = content;
  }

  /** @returns {T} */
  get() {
    return this.content;
  }

  /**
   * @template U
   * @param {(content: T) => U} f
   * @returns {Box<U>}
   */
  map(f) {
    return new Box(f(this.content));
  }
}

/**
 * @template T
 * @extends {Box<T[]>}
 */
class Shelf extends Box {
  /** @returns {number} */
  size() {
    return this.content.length;
  }
}

let warm = 0;
for (let i = 0; i < 2000; i++) {
  warm += same(i) + (last([i, 1]) ?? 0) + (byId([{ id: i, extra: "e" }], i)?.id ?? 0) + pair(i, "v")[0] + pick({ n: i, s: "s" }, "n") + new Box(i).map(n => n + 1).get();
}
console.log("2000 rounds: " + warm);
console.log(same("text").length, last(["a", "b"]), last([]), byId([{ id: 1, name: "n" }], 1)?.name, byId([], 1));
console.log(pair("k", 1).join(), pick({ n: 1, s: "s" }, "s").length, both.many.length, other.many.length);
console.log(new Box("ab").map(s => s.length).get(), new Shelf([1, 2, 3]).size(), new Shelf(["a"]).get().join(), JSON.stringify(new Box({ x: 1 })));

export {};

// GENERATED: last byId pair Box map Shelf
// CHECK-LABEL: function {{*}}name="last"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[HasExplicitName] length=1 thisType={type=anything} parameters=[{type=undefined|null|Array<undefined|null|[[L_1]]> flags=[IsExpected]}] results=[{type=undefined|null|[[L_1]] flags=[IsExpected]}] {
// CHECK-NEXT: b0(v0: undefined|null|Array<undefined|null|[[L_1]]>):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = PropGet v0 key="length"
// CHECK-NEXT: v2 = Convert v1 declared={type=number flags=[IsExpected]}
// CHECK-NEXT: v3 = Integer integer=1
// CHECK-NEXT: v4 = Sub v2, v3
// CHECK-NEXT: v5 = ElemGet v0, v4
// CHECK-NEXT: v6 = Convert v5 declared={type=undefined|null|[[L_1]] flags=[IsExpected]}
// CHECK-NEXT: Return v6
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="byId"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[HasExplicitName] length=2 thisType={type=anything} parameters=[{type=undefined|null|Array<undefined|null|[[L_2]]> flags=[IsExpected]}, {type=number flags=[IsExpected]}] results=[{type=undefined|null|[[L_2]] flags=[IsExpected]}] {
// CHECK-NEXT: b0(v0: undefined|null|Array<undefined|null|[[L_2]]>, v1: number):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v2 = PropGet v0 key="find"
// CHECK-NEXT: v3 = Convert v2 declared={type=undefined|null|[[f_3]] flags=[IsExpected]}
// CHECK-NEXT: v4 = NewClosure v1 function=[[f_4]]
// CHECK-NEXT: v5 = Call v3, v0, v4 calleeKey="find" calleeName="rows.find"
// CHECK-NEXT: ReturnCall v5 casts=[{declared={type=undefined|null|[[L_2]] flags=[IsExpected]}}]
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="pair"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[HasExplicitName] length=2 thisType={type=anything} parameters=[{type=undefined|null|[[L_5]] flags=[IsExpected]}, {type=undefined|null|[[L_6]] flags=[IsExpected]}] results=[{type=undefined|null|Array<undefined|null|[[L_5]]|[[L_6]]> flags=[IsExpected]}] {
// CHECK-NEXT: b0(v0: undefined|null|[[L_5]], v1: undefined|null|[[L_6]]):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v2 = NewArray v0, v1 contents=undefined|null|[[L_5]]|[[L_6]]
// CHECK-NEXT: v3 = Convert v2 declared={type=undefined|null|Array<undefined|null|[[L_5]]|[[L_6]]> flags=[IsExpected]}
// CHECK-NEXT: Return v3
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="Box"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=BaseConstructor flags=[HasNewTarget, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=undefined|null|[[L_7]] flags=[IsExpected]}] results=[{type=object flags=[IsFromCompiler]}] functionTypes={{*}}[[f_8]]] {
// CHECK-NEXT: b0(v0: anything, v1: undefined|null|[[L_7]]):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v2 = GetConstructPrototype v0 layout=[[L_9]]
// CHECK-NEXT: v3 = NewObject v2 layout=[[L_9]]
// CHECK-NEXT: v4 = Convert v3 declared={type=[[L_9]] flags=[IsFromCompiler]} illTypedCause=FromLooseType
// CHECK-NEXT: v5 = Convert v4 declared={type=undefined|null|[[L_9]] flags=[IsExpected]}
// CHECK-NEXT: v6 = Convert v1 declared={type=undefined|null|[[L_7]] flags=[IsExpected]}
// CHECK-NEXT: PropSet v5, v6 key="content"
// CHECK-NEXT: v8 = Undefined
// CHECK-NEXT: v9 = TypeTest v8 testedType=object
// CHECK-NEXT: Branch v9 -> taken b2(| 0), notTaken b3(| 0)
// CHECK-NEXT: b2(v10):
// CHECK-NEXT: Jump -> next b4(v10)
// CHECK-NEXT: b3(v11):
// CHECK-NEXT: Jump -> next b4(v4)
// CHECK-NEXT: b4(v12):
// CHECK-NEXT: Return v12
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="map"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Method flags=[HasThis, HasExplicitName] length=1 thisType={type=[[L_9]] flags=[IsExpected]} parameters=[{type=undefined|null|[[f_10]] flags=[IsExpected]}] results=[{type=undefined|null|[[L_9]] flags=[IsExpected]}] functionTypes={{*}}[[f_11]]] {
// CHECK-NEXT: b0(v0: [[L_9]], v1: undefined|null|[[f_10]]):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v2 = GetModuleVariable variable=[[g_12]]
// CHECK-NEXT: v3 = CheckInitialized v2 name="Box"
// CHECK-NEXT: v4 = Convert v0 declared={type=undefined|null|[[L_9]] flags=[IsExpected]}
// CHECK-NEXT: v5 = PropGet v4 key="content"
// CHECK-NEXT: v6 = Convert v5 declared={type=undefined|null|[[L_7]] flags=[IsExpected]}
// CHECK-NEXT: v7 = Call v1, -, v6 calleeName="f"
// CHECK-NEXT: v8 = Convert v7 declared={type=undefined|null|[[L_13]] flags=[IsExpected]}
// CHECK-NEXT: v9 = Construct v3, -, v8 calleeName="Box"
// CHECK-NEXT: v10 = Convert v9 declared={type=undefined|null|[[L_9]] flags=[IsExpected]}
// CHECK-NEXT: Return v10
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="Shelf"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=DerivedConstructor flags=[HasRestParameter, HasNewTarget, TakesCallee, HasExplicitName] thisType={type=anything} parameters=[{type=Array flags=[IsFromCompiler]}] results=[{type=object flags=[IsFromCompiler]}] functionTypes={{*}}[[f_14]]] {
// CHECK-NEXT: b0(v0: function, v1: anything, v2: Array):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v3 = GetSuperBase v0
// CHECK-NEXT: v4 = SuperConstructList v3, v1, v2 layout=[[L_15]]
// CHECK-NEXT: v5 = Convert v4 declared={type=[[L_15]] flags=[IsFromCompiler]} illTypedCause=FromLooseType
// CHECK-NEXT: Return v5
// CHECK-NEXT: }
