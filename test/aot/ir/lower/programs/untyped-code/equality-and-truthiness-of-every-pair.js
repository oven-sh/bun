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
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[HasExplicitName] thisType={type=anything} results=[{type=anything}] {
// CHECK-NEXT: b0():
// CHECK-NEXT: v0 = Integer
// CHECK-NEXT: v1 = Convert v0 declared={type=number flags=[IsExpected]}
// CHECK-NEXT: v2 = Integer
// CHECK-NEXT: v3 = Convert v2 declared={type=number flags=[IsExpected]}
// CHECK-NEXT: Jump -> next b1(v1, v3)
// CHECK-NEXT: b1(v4, v5):
// CHECK-NEXT: LoopHint
// CHECK-NEXT: v7 = Integer integer=1000
// CHECK-NEXT: v8 = Less v5, v7
// CHECK-NEXT: Branch v8 -> taken b2(), notTaken b13()
// CHECK-NEXT: b2():
// CHECK-NEXT: v9 = GetModuleVariable variable=[[g_1]]
// CHECK-NEXT: v10 = CheckInitialized v9 name="loosePairs"
// CHECK-NEXT: v11 = IteratorOpen v10
// CHECK-NEXT: Jump -> next b3(v4)
// CHECK-NEXT: b3(v12):
// CHECK-NEXT: LoopHint
// CHECK-NEXT: v14 = IteratorResume v11
// CHECK-NEXT: v15 = ResultAt v14
// CHECK-NEXT: v16 = ResultAt v14 index=1
// CHECK-NEXT: Branch v15 -> taken b4(), notTaken b5()
// CHECK-NEXT: b4():
// CHECK-NEXT: v17 = Increment v5
// CHECK-NEXT: v18 = Convert v17 declared={type=number flags=[IsExpected]}
// CHECK-NEXT: Jump -> next b1(v12, v18)
// CHECK-NEXT: b5():
// CHECK-NEXT: Jump -> next b6()
// CHECK-NEXT: b6() handler=b12():
// CHECK-NEXT: v19 = IteratorOpen v16 elementCount=2 [isDestructuring]
// CHECK-NEXT: Jump -> next b7()
// CHECK-NEXT: b7() handler=b11():
// CHECK-NEXT: v20 = IteratorResume v19 stepIndex=0
// CHECK-NEXT: v21 = ResultAt v20
// CHECK-NEXT: v22 = ResultAt v20 index=1
// CHECK-NEXT: v23 = IteratorResume v19 stepIndex=1
// CHECK-NEXT: v24 = ResultAt v23
// CHECK-NEXT: v25 = ResultAt v23 index=1
// CHECK-NEXT: Jump -> next b8()
// CHECK-NEXT: b8() handler=b12():
// CHECK-NEXT: IteratorClose v19
// CHECK-NEXT: v27 = Eq v22, v25
// CHECK-NEXT: Branch v27 -> taken b9(), notTaken b10(v12)
// CHECK-NEXT: b9() handler=b12():
// CHECK-NEXT: v28 = Increment v12
// CHECK-NEXT: v29 = Convert v28 declared={type=number flags=[IsExpected]}
// CHECK-NEXT: Jump -> next b10(v29)
// CHECK-NEXT: b10(v30) handler=b12():
// CHECK-NEXT: Jump -> next b3(v30)
// CHECK-NEXT: b11() role=IterationCleanup subject=v19 handler=b12():
// CHECK-NEXT: v31 = CatchException
// CHECK-NEXT: IteratorClose v19 completion=Throw
// CHECK-NEXT: Rethrow v31
// CHECK-NEXT: b12() role=IterationCleanup subject=v11:
// CHECK-NEXT: v33 = CatchException
// CHECK-NEXT: IteratorClose v11 completion=Throw
// CHECK-NEXT: Rethrow v33
// CHECK-NEXT: b13():
// CHECK-NEXT: Return v4
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="isBigInt"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Arrow length=1 thisType={type=anything} parameters=[{type=undefined|null|boolean|number|string|symbol|bigint|[[L_2]]|[[L_3]]|[[f_4]]|Array<never> flags=[IsExpected]}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: undefined|null|boolean|number|string|symbol|bigint|[[L_2]]|[[L_3]]|[[f_4]]|Array<never>):
// CHECK-NEXT: v1 = TypeTest v0 testedType=bigint
// CHECK-NEXT: Return v1
// CHECK-NEXT: }
