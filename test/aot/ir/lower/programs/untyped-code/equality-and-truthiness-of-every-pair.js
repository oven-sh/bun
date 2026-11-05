// RUN: lower
// OPTIONS: builtin-modules

// Every kind of value against every other under `===`, `==` and `!==`, every kind under each truthiness test, and which of them stay out of the runtime.
const count = typeof aotOperationCount === "function" ? aotOperationCount : () => 0;
const one = process.argv.length > 0 ? 1 : 0;
const rope = "abcdefghij".repeat(4) + String(one);
const wide = String.fromCharCode(0x20ac);
const values = [undefined, null, true, false, 0, -0, 1, 1.5, NaN, Infinity, 2 ** 31, "", "a", String.fromCharCode(97), rope, wide, 0n, 1n, 2n ** 70n, Symbol(), {}, [], function () {}, { valueOf() { return 1; } }];

function bits(test) { return values.map(right => (test(right) ? 1 : 0)).join(""); }
for (const left of values)
  console.log(bits(right => left === right), bits(right => left == right), bits(right => left !== right));
function isTrueByBranch(value) { if (value) return true; return false; }
console.log(bits(value => !!value), bits(value => (value ? 1 : 0)), bits(isTrueByBranch));

const isBigInt = value => typeof value === "bigint";
const isString = value => typeof value === "string";
const isMixedWidth = (left, right) => isString(left) && isString(right) && (left === wide) !== (right === wide);
const pairs = values.flatMap(left => values.map(right => [left, right]));
const strictPairs = pairs.filter(([left, right]) => !isBigInt(left) && !isBigInt(right) && !isMixedWidth(left, right));
const looseInStub = ([left, right]) =>
  (typeof left === "number" && typeof right === "number") || (isString(left) && isString(right) && !isMixedWidth(left, right)) || (Object.is(left, right) && !isBigInt(left) && Object(left) !== left);
const loosePairs = pairs.filter(looseInStub);
const truthyValues = values.filter(value => !isBigInt(value));

function countStrict() { let hits = 0; for (let round = 0; round < 1000; round++) for (const [left, right] of strictPairs) if (left === right) hits++; return hits; }
function countLoose() { let hits = 0; for (let round = 0; round < 1000; round++) for (const [left, right] of loosePairs) if (left == right) hits++; return hits; }
function countTruthy() { let hits = 0; for (let round = 0; round < 1000; round++) for (const value of truthyValues) { if (value) hits++; if (!!value) hits++; hits += value ? 1 : 0; } return hits; }
function callsDuring(name, run) { const before = count(name); const result = run(); return [result, count(name) - before]; }
console.log("strict", ...callsDuring("operationAOTCompareStrictEq", countStrict));
console.log("loose", ...callsDuring("operationAOTCompareEq", countLoose));
console.log("truthy", ...callsDuring("operationAOTToBoolean", countTruthy));

const [notANumber, zero, negativeZero] = [values[8], values[4], values[5]];
console.log(notANumber === notANumber, notANumber == notANumber, zero === negativeZero, zero == negativeZero);
console.log(BigInt(one) === 1n, BigInt(one) == 1n, BigInt(one) === 2n, 1n == one);
console.log("abcdefghij".repeat(3) === "abcdefghijabcdefghijabcdefghij", rope === "abcdefghij".repeat(4) + "1", rope === "abcdefghij".repeat(4) + "2");
const latin = String.fromCharCode(0xe9) + "x";
const latinFromWide = (String.fromCharCode(0xe9) + "x€").slice(0, 2);
console.log(latin === latinFromWide, latin == latinFromWide, latin !== latinFromWide);

let valueOfCalls = 0;
const counted = { valueOf() { valueOfCalls++; return 1; } };
console.log(counted == one, valueOfCalls);
console.log(one == counted, valueOfCalls);
console.log(counted == "1", valueOfCalls);
console.log("2" == counted, valueOfCalls);
console.log(counted === one, one === counted, valueOfCalls);

// GENERATED: countLoose isBigInt
// CHECK-LABEL: function {{*}}name="countLoose"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[HasExplicitName] thisType={type=anything} results=[{type=number flags=[IsExpected]}] functionTypes={{*}}[[f_1]]] {
// CHECK-NEXT: b0():
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v0 = Integer
// CHECK-NEXT: v1 = Convert v0 declared={type=number flags=[IsExpected]}
// CHECK-NEXT: v2 = Integer
// CHECK-NEXT: v3 = Convert v2 declared={type=number flags=[IsExpected]}
// CHECK-NEXT: Jump -> next b2(v1, v3)
// CHECK-NEXT: b2(v4, v5):
// CHECK-NEXT: LoopHint
// CHECK-NEXT: v7 = Integer integer=1000
// CHECK-NEXT: v8 = Less v5, v7
// CHECK-NEXT: Branch v8 -> taken b3(| 0), notTaken b22(| 0)
// CHECK-NEXT: b3(v9):
// CHECK-NEXT: Jump -> next b4()
// CHECK-NEXT: b4():
// CHECK-NEXT: v10 = GetModuleVariable variable=[[g_2]]
// CHECK-NEXT: v11 = CheckInitialized v10 name="loosePairs"
// CHECK-NEXT: v12 = IteratorOpen v11
// CHECK-NEXT: Jump -> next b5(v4)
// CHECK-NEXT: b5(v13):
// CHECK-NEXT: LoopHint
// CHECK-NEXT: v15 = IteratorResume v12
// CHECK-NEXT: v16 = ResultAt v15
// CHECK-NEXT: v17 = ResultAt v15 index=1
// CHECK-NEXT: Branch v16 -> taken b6(), notTaken b8()
// CHECK-NEXT: b6():
// CHECK-NEXT: Jump -> next b7()
// CHECK-NEXT: b7():
// CHECK-NEXT: v18 = Increment v9
// CHECK-NEXT: v19 = Convert v18 declared={type=number flags=[IsExpected]}
// CHECK-NEXT: Jump -> next b2(v13, v19)
// CHECK-NEXT: b8():
// CHECK-NEXT: Jump -> next b9()
// CHECK-NEXT: b9() handler=b21():
// CHECK-NEXT: v20 = IteratorOpen v17 elementCount=2 [isDestructuring]
// CHECK-NEXT: Jump -> next b10()
// CHECK-NEXT: b10() handler=b20():
// CHECK-NEXT: v21 = IteratorResume v20 stepIndex=0
// CHECK-NEXT: v22 = ResultAt v21
// CHECK-NEXT: v23 = ResultAt v21 index=1
// CHECK-NEXT: v24 = Convert v23 declared={type=undefined|null|boolean|number|string|symbol|bigint|[[L_3]]|[[L_4]]|[[f_5]]|Array<never> flags=[IsExpected]}
// CHECK-NEXT: Jump -> next b11()
// CHECK-NEXT: b11() handler=b20():
// CHECK-NEXT: v25 = IteratorResume v20 stepIndex=1
// CHECK-NEXT: v26 = ResultAt v25
// CHECK-NEXT: v27 = ResultAt v25 index=1
// CHECK-NEXT: v28 = Convert v27 declared={type=undefined|null|boolean|number|string|symbol|bigint|[[L_3]]|[[L_4]]|[[f_5]]|Array<never> flags=[IsExpected]}
// CHECK-NEXT: Jump -> next b12()
// CHECK-NEXT: b12() handler=b20():
// CHECK-NEXT: Jump -> next b13()
// CHECK-NEXT: b13() handler=b21():
// CHECK-NEXT: IteratorClose v20
// CHECK-NEXT: Jump -> next b14()
// CHECK-NEXT: b14() handler=b21():
// CHECK-NEXT: v30 = Eq v24, v28
// CHECK-NEXT: Branch v30 -> taken b15(| 0, 1), notTaken b18(| 0, 1)
// CHECK-NEXT: b15(v31, v32) handler=b21():
// CHECK-NEXT: Jump -> next b16()
// CHECK-NEXT: b16() handler=b21():
// CHECK-NEXT: v33 = Increment v13
// CHECK-NEXT: v34 = Convert v33 declared={type=number flags=[IsExpected]}
// CHECK-NEXT: Jump -> next b17()
// CHECK-NEXT: b17() handler=b21():
// CHECK-NEXT: Jump -> next b19(v34)
// CHECK-NEXT: b18(v35, v36) handler=b21():
// CHECK-NEXT: Jump -> next b19(v13)
// CHECK-NEXT: b19(v37) handler=b21():
// CHECK-NEXT: Jump -> next b5(v37)
// CHECK-NEXT: b20() role=IterationCleanup subject=v20 handler=b21():
// CHECK-NEXT: v38 = CatchException
// CHECK-NEXT: IteratorClose v20 completion=Throw
// CHECK-NEXT: Rethrow v38
// CHECK-NEXT: b21() role=IterationCleanup subject=v12:
// CHECK-NEXT: v40 = CatchException
// CHECK-NEXT: IteratorClose v12 completion=Throw
// CHECK-NEXT: Rethrow v40
// CHECK-NEXT: b22(v42):
// CHECK-NEXT: Jump -> next b23()
// CHECK-NEXT: b23():
// CHECK-NEXT: v43 = Convert v4 declared={type=number flags=[IsExpected]}
// CHECK-NEXT: Return v43
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="isBigInt"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Arrow length=1 thisType={type=anything} parameters=[{type=undefined|null|boolean|number|string|symbol|bigint|[[L_3]]|[[L_4]]|[[f_5]]|Array<never> flags=[IsExpected]}] results=[{type=boolean flags=[IsExpected]}] functionTypes={{*}}[[f_6]]] {
// CHECK-NEXT: b0(v0: undefined|null|boolean|number|string|symbol|bigint|[[L_3]]|[[L_4]]|[[f_5]]|Array<never>):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = TypeTest v0 testedType=bigint
// CHECK-NEXT: v2 = Convert v1 declared={type=boolean flags=[IsExpected]}
// CHECK-NEXT: Return v2
// CHECK-NEXT: }
