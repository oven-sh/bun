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
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[HasExplicitName] length=1 thisType={type=anything} parameters=[{type=undefined|null|Array flags=[IsExpected]}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: undefined|null|Array):
// CHECK-NEXT: v1 = PropGet v0 key="length"
// CHECK-NEXT: v2 = Integer integer=1
// CHECK-NEXT: v3 = Sub v1, v2
// CHECK-NEXT: v4 = ElemGet v0, v3
// CHECK-NEXT: Return v4
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="byId"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[HasExplicitName] length=2 thisType={type=anything} parameters=[{type=undefined|null|Array<undefined|null|[[L_1]]> flags=[IsExpected]}, {type=number flags=[IsExpected]}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: undefined|null|Array<undefined|null|[[L_1]]>, v1: number):
// CHECK-NEXT: v2 = PropGet v0 key="find"
// CHECK-NEXT: v3 = NewClosure v1 function=[[f_2]]
// CHECK-NEXT: v4 = Call v2, v0, v3 calleeKey="find" calleeName="rows.find"
// CHECK-NEXT: ReturnCall v4
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="pair"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[HasExplicitName] length=2 thisType={type=anything} parameters=[{type=anything}, {type=anything}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: anything, v1: anything):
// CHECK-NEXT: v2 = NewArray v0, v1 contents=anything
// CHECK-NEXT: Return v2
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="Box"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=BaseConstructor flags=[HasNewTarget, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=anything}] results=[{type=object flags=[IsFromCompiler]}] functionTypes={{*}}[[f_3]]] {
// CHECK-NEXT: b0(v0: anything, v1: anything):
// CHECK-NEXT: v2 = GetConstructPrototype v0 layout=[[L_4]]
// CHECK-NEXT: v3 = NewObject v2 layout=[[L_4]]
// CHECK-NEXT: v4 = Convert v3 declared={type=[[L_4]]}
// CHECK-NEXT: PropSet v4, v1 key="content"
// CHECK-NEXT: v6 = Undefined
// CHECK-NEXT: v7 = TypeTest v6 testedType=object
// CHECK-NEXT: Branch v7 -> taken b1(| 0), notTaken b2(v4)
// CHECK-NEXT: b1(v8):
// CHECK-NEXT: Jump -> next b2(v8)
// CHECK-NEXT: b2(v9):
// CHECK-NEXT: Return v9
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="map"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Method flags=[HasThis, HasExplicitName] length=1 thisType={type=[[L_4]] flags=[IsExpected]} parameters=[{type=undefined|null|[[f_5]] flags=[IsExpected]}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: [[L_4]], v1: undefined|null|[[f_5]]):
// CHECK-NEXT: v2 = GetModuleVariable variable=[[g_6]]
// CHECK-NEXT: v3 = CheckInitialized v2 name="Box"
// CHECK-NEXT: v4 = PropGet v0 key="content"
// CHECK-NEXT: v5 = Call v1, -, v4 calleeName="f"
// CHECK-NEXT: v6 = Construct v3, -, v5 calleeName="Box"
// CHECK-NEXT: Return v6
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="Shelf"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=DerivedConstructor flags=[HasRestParameter, HasNewTarget, TakesCallee, HasExplicitName] thisType={type=anything} parameters=[{type=Array flags=[IsFromCompiler]}] results=[{type=object flags=[IsFromCompiler]}] functionTypes={{*}}[[f_7]]] {
// CHECK-NEXT: b0(v0: function, v1: anything, v2: Array):
// CHECK-NEXT: v3 = GetSuperBase v0
// CHECK-NEXT: v4 = SuperConstructList v3, v1, v2 layout=[[L_8]]
// CHECK-NEXT: v5 = Convert v4 declared={type=[[L_8]]}
// CHECK-NEXT: Return v5
// CHECK-NEXT: }
