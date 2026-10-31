// RUN: lower
// OPTIONS: builtin-modules

// `key == "constructor"`, `tag == "[object Arguments]"`: a text that is no number is loosely equal to a string with its characters, to an object that turns into such a string, and to nothing else. One stub answers that from the characters in the image: no cell is made or fetched for the text.
function countConstructors(keys) { var count = 0; for (var index = 0; index < keys.length; index++) { if (keys[index] == "constructor") count++; } return count; }
function countOnes(keys) { var count = 0; for (var index = 0; index < keys.length; index++) { if (keys[index] == "1") count++; } return count; }
function isConstructor(key) { return key == "constructor"; }
function isNotArguments(tag) { return "[object Arguments]" != tag; }
function isOne(value) { return value == "1"; }
function isEmpty(value) { return value == ""; }
function isSpace(value) { return value == " "; }
function isInfinity(value) { return value == "Infinity"; }
function isTrue(value) { return value == "true"; }
function isNaNText(value) { return value == "NaN"; }
var calls = [];
function turnsInto(text) { return { toString: function () { calls.push("toString " + text); return text; } }; }
var thrower = { valueOf: function () { throw new RangeError("asked"); } };
var values = ["constructor", "construct" + "or".slice(0), "constructo", "constructors", "Constructor", "[object Arguments]", "[object Object]", "", " ", "1", "true", "NaN", "Infinity", "constructorĀ".slice(0, 11), "Ā",
  0, 1, -0, NaN, Infinity, true, false, null, undefined, 1n, 0n, Symbol("constructor"), Symbol.iterator,
  turnsInto("constructor"), turnsInto("[object Arguments]"), turnsInto("1"), turnsInto(""), turnsInto("true"), new String("constructor"), new String("NaN"), ["constructor"], [], [1], {}, function () {}, new Number(1), new Boolean(true), Object.create(null, { valueOf: { value: function () { return "Infinity"; } } })];
var tests = [isConstructor, isNotArguments, isOne, isEmpty, isSpace, isInfinity, isTrue, isNaNText];
console.log(values.map(function (value) { return [isConstructor(value), isNotArguments(value), isOne(value), isEmpty(value), isSpace(value), isInfinity(value), isTrue(value), isNaNText(value)].map(Number).join(""); }).join(" "));
console.log(calls.length, calls.slice(0, 9).join());
console.log(countConstructors(values), countOnes(values), calls.length);
for (var test of tests) { try { console.log(test(thrower)); } catch (error) { console.log(error.name, error.message); } }
try { console.log(isConstructor(Object.create(null))); } catch (error) { console.log(error.name); }
var rope = "const"; for (var part of ["ru", "ct", "or"]) rope += part;
console.log(isConstructor(rope), isConstructor(rope + "s"), isConstructor(("x" + rope).slice(1)));

// GENERATED: isNotArguments countConstructors turnsInto valueOf toString
// CHECK-LABEL: function {{*}}name="isNotArguments"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[HasExplicitName] length=1 thisType={type=anything} parameters=[{type=anything}] results=[{type=boolean flags=[IsExpected]}] functionTypes={{*}}[[f_1]]] {
// CHECK-NEXT: b0(v0: anything):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = String string="[object Arguments]"
// CHECK-NEXT: v2 = Eq v1, v0
// CHECK-NEXT: v3 = LogicalNot v2
// CHECK-NEXT: v4 = Convert v3 declared={type=boolean flags=[IsExpected]}
// CHECK-NEXT: Return v4
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="countConstructors"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[HasExplicitName] length=1 thisType={type=anything} parameters=[{type=undefined|null|string|Array flags=[IsExpected]}] results=[{type=number flags=[IsExpected]}] {
// CHECK-NEXT: b0(v0: undefined|null|string|Array):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = Undefined
// CHECK-NEXT: v2 = Integer
// CHECK-NEXT: v3 = Convert v2 declared={type=undefined|number flags=[IsExpected]}
// CHECK-NEXT: v4 = Integer
// CHECK-NEXT: v5 = Convert v4 declared={type=undefined|i32 flags=[IsExpected]}
// CHECK-NEXT: Jump -> next b2(v3, v5)
// CHECK-NEXT: b2(v6, v7):
// CHECK-NEXT: LoopHint
// CHECK-NEXT: v9 = Convert v7 declared={type=i32 flags=[IsExpected]}
// CHECK-NEXT: v10 = PropGet v0 key="length"
// CHECK-NEXT: v11 = Convert v10 declared={type=number flags=[IsExpected]}
// CHECK-NEXT: v12 = Less v9, v11
// CHECK-NEXT: Branch v12 -> taken b3(| 0), notTaken b8(| 0)
// CHECK-NEXT: b3(v13):
// CHECK-NEXT: Jump -> next b4()
// CHECK-NEXT: b4():
// CHECK-NEXT: v14 = Convert v13 declared={type=i32 flags=[IsExpected]}
// CHECK-NEXT: v15 = ElemGet v0, v14
// CHECK-NEXT: v16 = String string="constructor"
// CHECK-NEXT: v17 = Eq v15, v16
// CHECK-NEXT: Branch v17 -> taken b5(), notTaken b6(v6)
// CHECK-NEXT: b5():
// CHECK-NEXT: v18 = Increment v6
// CHECK-NEXT: v19 = Convert v18 declared={type=undefined|number flags=[IsExpected]}
// CHECK-NEXT: Jump -> next b6(v19)
// CHECK-NEXT: b6(v20):
// CHECK-NEXT: Jump -> next b7()
// CHECK-NEXT: b7():
// CHECK-NEXT: v21 = Increment v14
// CHECK-NEXT: v22 = Convert v21 declared={type=undefined|i32 flags=[IsExpected]}
// CHECK-NEXT: Jump -> next b2(v20, v22)
// CHECK-NEXT: b8(v23):
// CHECK-NEXT: Jump -> next b9()
// CHECK-NEXT: b9():
// CHECK-NEXT: v24 = Convert v6 declared={type=number flags=[IsExpected]}
// CHECK-NEXT: Return v24
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="turnsInto"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[HasExplicitName] length=1 thisType={type=anything} parameters=[{type=undefined|null|string flags=[IsExpected]}] results=[{type=undefined|null|boolean|number|string|symbol|bigint|[[L_2]] flags=[IsExpected]}] {
// CHECK-NEXT: b0(v0: undefined|null|string):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = NewClosure v0 function=[[f_3]]
// CHECK-NEXT: v2 = Convert v1 declared={type=undefined|null|[[f_4]] flags=[IsExpected]}
// CHECK-NEXT: v3 = NewObject layout=[[L_2]]
// CHECK-NEXT: PropDefine v3, v2 key="toString"
// CHECK-NEXT: v5 = FinishObject v3
// CHECK-NEXT: v6 = Convert v5 declared={type=undefined|null|boolean|number|string|symbol|bigint|[[L_2]] flags=[IsExpected]}
// CHECK-NEXT: Return v6
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="valueOf"
// CHECK: module=[[m_0]] position={{*}} text={{*}} thisType={type=anything} results=[{type=anything}] functionTypes={{*}}[[f_5]]] {
// CHECK-NEXT: b0():
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v0 = Builtin builtin=GlobalThis
// CHECK-NEXT: v1 = PropGet v0 key="RangeError" [isFreeName]
// CHECK-NEXT: v2 = Convert v1 declared={type=builtin(RangeError) flags=[IsExpected]}
// CHECK-NEXT: v3 = String string="asked"
// CHECK-NEXT: v4 = Construct v2, -, v3 calleeName="RangeError"
// CHECK-NEXT: v5 = Convert v4 declared={type=undefined|null|RangeError flags=[IsExpected]}
// CHECK-NEXT: Throw v5
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="toString"
// CHECK: module=[[m_0]] position={{*}} text={{*}} captures=[{type=undefined|null|string flags=[IsExpected]}] thisType={type=anything} results=[{type=undefined|null|string flags=[IsExpected]}] functionTypes={{*}}[[f_4]]] {
// CHECK-NEXT: b0(v0: undefined|null|string):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = GetModuleVariable variable=[[g_6]]
// CHECK-NEXT: v2 = PropGet v1 key="push"
// CHECK-NEXT: v3 = Convert v2 declared={type=undefined|null|[[f_7]] flags=[IsExpected]}
// CHECK-NEXT: v4 = String string="toString "
// CHECK-NEXT: v5 = Add v4, v0
// CHECK-NEXT: v6 = Call v3, v1, v5 calleeKey="push" calleeName="calls.push"
// CHECK-NEXT: v7 = Convert v0 declared={type=undefined|null|string flags=[IsExpected]}
// CHECK-NEXT: Return v7
// CHECK-NEXT: }
