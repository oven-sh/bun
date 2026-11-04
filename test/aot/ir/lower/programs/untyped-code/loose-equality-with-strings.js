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
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[HasExplicitName] length=1 thisType={type=anything} parameters=[{type=anything}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: anything):
// CHECK-NEXT: v1 = String string="[object Arguments]"
// CHECK-NEXT: v2 = Eq v1, v0
// CHECK-NEXT: v3 = LogicalNot v2
// CHECK-NEXT: Return v3
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="countConstructors"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[HasExplicitName] length=1 thisType={type=anything} parameters=[{type=undefined|null|Array flags=[IsExpected]}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: undefined|null|Array):
// CHECK-NEXT: v1 = Undefined
// CHECK-NEXT: v2 = Integer
// CHECK-NEXT: v3 = Convert v2 declared={type=undefined|number flags=[IsExpected]}
// CHECK-NEXT: v4 = Integer
// CHECK-NEXT: v5 = Convert v4 declared={type=undefined|i32 flags=[IsExpected]}
// CHECK-NEXT: Jump -> next b1(v3, v5)
// CHECK-NEXT: b1(v6, v7):
// CHECK-NEXT: LoopHint
// CHECK-NEXT: v9 = PropGet v0 key="length"
// CHECK-NEXT: v10 = Less v7, v9
// CHECK-NEXT: Branch v10 -> taken b2(), notTaken b5()
// CHECK-NEXT: b2():
// CHECK-NEXT: v11 = ElemGet v0, v7
// CHECK-NEXT: v12 = String string="constructor"
// CHECK-NEXT: v13 = Eq v11, v12
// CHECK-NEXT: Branch v13 -> taken b3(), notTaken b4(v6)
// CHECK-NEXT: b3():
// CHECK-NEXT: v14 = Increment v6
// CHECK-NEXT: v15 = Convert v14 declared={type=undefined|number flags=[IsExpected]}
// CHECK-NEXT: Jump -> next b4(v15)
// CHECK-NEXT: b4(v16):
// CHECK-NEXT: v17 = Increment v7
// CHECK-NEXT: v18 = Convert v17 declared={type=undefined|i32 flags=[IsExpected]}
// CHECK-NEXT: Jump -> next b1(v16, v18)
// CHECK-NEXT: b5():
// CHECK-NEXT: Return v6
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="turnsInto"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[HasExplicitName] length=1 thisType={type=anything} parameters=[{type=undefined|null|string flags=[IsExpected]}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: undefined|null|string):
// CHECK-NEXT: v1 = NewClosure v0 function=[[f_1]]
// CHECK-NEXT: v2 = NewObject -, v1 layout=[[L_2]] fields=[0]
// CHECK-NEXT: v3 = FinishObject v2
// CHECK-NEXT: Return v3
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="valueOf"
// CHECK: module=[[m_0]] position={{*}} text={{*}} thisType={type=anything} results=[{type=anything}] {
// CHECK-NEXT: b0():
// CHECK-NEXT: v0 = Builtin builtin=GlobalThis
// CHECK-NEXT: v1 = PropGet v0 key="RangeError" [isFreeName]
// CHECK-NEXT: v2 = Convert v1 declared={type=builtin(RangeError) flags=[IsExpected]}
// CHECK-NEXT: v3 = String string="asked"
// CHECK-NEXT: v4 = Construct v2, -, v3 calleeName="RangeError"
// CHECK-NEXT: Throw v4
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="toString"
// CHECK: module=[[m_0]] position={{*}} text={{*}} captures=[{type=undefined|null|string flags=[IsExpected] variableName="text"}] thisType={type=anything} results=[{type=anything}] {
// CHECK-NEXT: b0(v0: undefined|null|string):
// CHECK-NEXT: v1 = GetModuleVariable variable=[[g_3]]
// CHECK-NEXT: v2 = PropGet v1 key="push"
// CHECK-NEXT: v3 = String string="toString "
// CHECK-NEXT: v4 = Add v3, v0
// CHECK-NEXT: v5 = Call v2, v1, v4 calleeKey="push" calleeName="calls.push"
// CHECK-NEXT: Return v0
// CHECK-NEXT: }
