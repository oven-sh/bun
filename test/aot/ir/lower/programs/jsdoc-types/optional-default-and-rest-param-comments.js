// RUN: lower
// OPTIONS: builtin-modules

/**
 * @param {number} a
 * @param {number} [b]
 * @returns {number}
 */
function bracketed(a, b) {
  return a + (b ?? 10);
}

/**
 * @param {number} a
 * @param {number=} b
 * @returns {number}
 */
function withEquals(a, b) {
  return a + (b === undefined ? 20 : b);
}

/**
 * @param {number} a
 * @param {number} [b=30]
 * @returns {number}
 */
function withDefaultInTheComment(a, b) {
  return a + (b ?? -1);
}

/**
 * @param {number} a
 * @param {number} [b]
 * @returns {number}
 */
function withDefaultInTheCode(a, b = 40) {
  return a + b;
}

/**
 * @param {number} first
 * @param {...number} rest
 * @returns {number}
 */
function summed(first, ...rest) {
  let total = first;
  for (const n of rest) total += n;
  return total;
}

/**
 * @param {object} options
 * @param {number} options.width
 * @param {number} [options.height]
 * @param {string} [options.unit="px"]
 * @returns {string}
 */
function box(options) {
  return options.width + "x" + (options.height ?? options.width) + (options.unit ?? "px");
}

/**
 * @param {{ width: number, height?: number }} options
 * @returns {number}
 */
function area({ width, height = width }) {
  return width * height;
}

/**
 * @param {object[]} rows
 * @param {number} rows[].id
 * @param {string} [rows[].name]
 * @returns {string}
 */
function names(rows) {
  return rows.map(row => row.id + ":" + (row.name ?? "?")).join();
}

/**
 * @param {?number} n
 * @param {!string} s
 * @param {*} anything
 * @param {?} unknownKind
 * @returns {string}
 */
function oldStyle(n, s, anything, unknownKind) {
  return (n === null ? "null" : n + 1) + s + typeof anything + typeof unknownKind;
}

/**
 * @param {function(number, string): boolean} test
 * @param {Array.<number>} list
 * @param {Object.<string, number>} table
 * @returns {number}
 */
function closureStyle(test, list, table) {
  let count = 0;
  for (const n of list) if (test(n, "k" + n)) count += table["k" + n] ?? 0;
  return count;
}

function usesArguments() {
  return arguments.length;
}

let warm = 0;
for (let i = 0; i < 2000; i++) warm += bracketed(i) + bracketed(i, 1) + withEquals(i) + withDefaultInTheComment(i) + withDefaultInTheCode(i) + summed(i) + summed(i, 1, 2) + area({ width: i });
console.log("2000 rounds: " + warm);
console.log(bracketed(1), bracketed(1, 2), bracketed(1, undefined), withEquals(1), withEquals(1, 2), withDefaultInTheComment(1), withDefaultInTheComment(1, 2), withDefaultInTheCode(1), withDefaultInTheCode(1, undefined), withDefaultInTheCode(1, 2));
console.log(summed(1), summed(1, 2), summed(1, 2, 3, 4), box({ width: 1 }), box({ width: 1, height: 2, unit: "em" }), area({ width: 2 }), area({ width: 2, height: 3 }));
console.log(names([{ id: 1 }, { id: 2, name: "two" }]), oldStyle(null, "s", 1, "u"), oldStyle(1, "s", undefined, null), closureStyle((n, k) => n > 1 && k.length === 2, [1, 2, 3], { k2: 20, k3: 30 }));
console.log(usesArguments(), usesArguments(1, 2, 3), bracketed.length, withDefaultInTheCode.length, summed.length);

export {};

// GENERATED: summed area names usesArguments
// CHECK-LABEL: function {{*}}name="summed"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[HasRestParameter, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=number flags=[IsExpected]}, {type=Array<number> flags=[IsFromCompiler]}] results=[{type=number flags=[IsExpected]}] {
// CHECK-NEXT: b0(v0: number, v1: Array<number>):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v2 = Convert v0 declared={type=number flags=[IsExpected]}
// CHECK-NEXT: v3 = IteratorOpen v1
// CHECK-NEXT: Jump -> next b2(v2)
// CHECK-NEXT: b2(v4):
// CHECK-NEXT: LoopHint
// CHECK-NEXT: v6 = IteratorResume v3
// CHECK-NEXT: v7 = ResultAt v6
// CHECK-NEXT: v8 = ResultAt v6 index=1
// CHECK-NEXT: Branch v7 -> taken b3(), notTaken b4()
// CHECK-NEXT: b3():
// CHECK-NEXT: v9 = Convert v4 declared={type=number flags=[IsExpected]}
// CHECK-NEXT: Return v9
// CHECK-NEXT: b4():
// CHECK-NEXT: Jump -> next b5()
// CHECK-NEXT: b5() handler=b7():
// CHECK-NEXT: v10 = Convert v8 declared={type=number flags=[IsExpected]}
// CHECK-NEXT: v11 = Add v4, v10
// CHECK-NEXT: v12 = Convert v11 declared={type=number flags=[IsExpected]}
// CHECK-NEXT: Jump -> next b6()
// CHECK-NEXT: b6() handler=b7():
// CHECK-NEXT: Jump -> next b2(v12)
// CHECK-NEXT: b7() role=IterationCleanup subject=v3:
// CHECK-NEXT: v13 = CatchException
// CHECK-NEXT: IteratorClose v3 completion=Throw
// CHECK-NEXT: Rethrow v13
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="area"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[HasExplicitName] length=1 thisType={type=anything} parameters=[{type=undefined|null|[[L_1]] flags=[IsExpected]}] results=[{type=number flags=[IsExpected]}] {
// CHECK-NEXT: b0(v0: undefined|null|[[L_1]]):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = TypeTest v0 testedType=undefined|null
// CHECK-NEXT: Branch v1 -> taken b2(| 0), notTaken b4(| 0)
// CHECK-NEXT: b2(v2):
// CHECK-NEXT: Jump -> next b3()
// CHECK-NEXT: b3() frequency=Unlikely:
// CHECK-NEXT: v3 = NewRuntimeError runtimeError=NotDestructurable name="width"
// CHECK-NEXT: Throw v3
// CHECK-NEXT: b4(v4):
// CHECK-NEXT: v5 = PropGet v4 key="width"
// CHECK-NEXT: v6 = Convert v5 declared={type=number flags=[IsExpected]}
// CHECK-NEXT: v7 = PropGet v4 key="height"
// CHECK-NEXT: v8 = TypeTest v7 testedType=undefined
// CHECK-NEXT: Branch v8 -> taken b5(| 0), notTaken b7(| 0)
// CHECK-NEXT: b5(v9):
// CHECK-NEXT: Jump -> next b6()
// CHECK-NEXT: b6():
// CHECK-NEXT: Jump -> next b8(v6)
// CHECK-NEXT: b7(v10):
// CHECK-NEXT: Jump -> next b8(v10)
// CHECK-NEXT: b8(v11):
// CHECK-NEXT: v12 = Convert v11 declared={type=number flags=[IsExpected]}
// CHECK-NEXT: v13 = Mul v6, v12
// CHECK-NEXT: v14 = Convert v13 declared={type=number flags=[IsExpected]}
// CHECK-NEXT: Return v14
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="names"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[HasExplicitName] length=1 thisType={type=anything} parameters=[{type=undefined|null|Array<undefined|null|[[L_2]]> flags=[IsExpected]}] results=[{type=undefined|null|string flags=[IsExpected]}] {
// CHECK-NEXT: b0(v0: undefined|null|Array<undefined|null|[[L_2]]>):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = PropGet v0 key="map"
// CHECK-NEXT: v2 = Convert v1 declared={type=undefined|null|[[f_3]] flags=[IsExpected]}
// CHECK-NEXT: v3 = NewClosure function=[[f_4]]
// CHECK-NEXT: v4 = Call v2, v0, v3 calleeKey="map" calleeName="rows.map"
// CHECK-NEXT: v5 = Convert v4 declared={type=undefined|null|Array<undefined|null|string> flags=[IsExpected]}
// CHECK-NEXT: v6 = PropGet v5 key="join"
// CHECK-NEXT: v7 = Convert v6 declared={type=undefined|null|[[f_5]] flags=[IsExpected]}
// CHECK-NEXT: v8 = Call v7, v5 calleeKey="join" calleeName="join"
// CHECK-NEXT: ReturnCall v8 casts=[{declared={type=undefined|null|string flags=[IsExpected]}}]
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="usesArguments"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[HasArgumentCount, HasHiddenRest, HasExplicitName] thisType={type=anything} results=[{type=number flags=[IsExpected]}] {
// CHECK-NEXT: b0(v0: int[0, 4294967295], v1: Array):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v2 = CreateUnmappedArguments v0, v1
// CHECK-NEXT: v3 = PropGet v2 key="length"
// CHECK-NEXT: v4 = Convert v3 declared={type=number flags=[IsExpected]}
// CHECK-NEXT: Return v4
// CHECK-NEXT: }
