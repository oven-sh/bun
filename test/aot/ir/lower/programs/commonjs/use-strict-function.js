// RUN: lower
// OPTIONS: builtin-modules

// In a file of CommonJS, which is sloppy, a function whose body begins with "use strict" is strict mode code, and so are the functions inside it, as in Node. Plain Bun drops the directive of a function when it transpiles.
function sloppy() { return typeof this; }
function strict() { "use strict"; return typeof this; }
const parameters = function (a, b) { "use strict"; a = "A"; arguments[1] = "B"; return [a, b, arguments[0], arguments[1]].join(); };
const sloppyParameters = function (a, b) { a = "A"; arguments[1] = "B"; return [a, b, arguments[0], arguments[1]].join(); };
const arrow = () => { "use strict"; try { undeclaredByAnyone = 1; return "stored"; } catch (e) { return e.name; } };
const object = { method() { 'use strict'; return typeof this; }, get getter() { "use strict"; return typeof this; } };
function outer() { "use strict"; return function () { return typeof this; }; }
function notFirst() { 1; "use strict"; return typeof this; }
function behindAnother() { "use client"; "use strict"; return typeof this; }
function frozen() { "use strict"; try { Object.freeze({ a: 1 }).a = 2; return "stored"; } catch (e) { return e.name; } }
function sloppyFrozen() { try { Object.freeze({ a: 1 }).a = 2; return "no error"; } catch (e) { return e.name; } }
function deletes() { "use strict"; try { return delete Object.freeze({ a: 1 }).a; } catch (e) { return e.name; } }
function* generator() { "use strict"; yield typeof this; }
async function later() { "use strict"; return typeof this; }
console.log("this of a sloppy function:", sloppy.call(5), "| of a strict one:", strict.call(5), "| called plainly:", strict());
console.log("parameters and arguments:", parameters(1, 2), "| sloppy:", sloppyParameters(1, 2));
console.log("a store to a name that nobody declares:", arrow());
console.log("a method:", object.method.call(5), "| a getter:", Object.getOwnPropertyDescriptor(object, "getter").get.call(5));
console.log("a function within:", outer().call(5), outer()());
console.log("not the first statement:", notFirst.call(5), "| behind another directive:", behindAnother.call(5));
console.log("a store to a frozen object:", frozen(), "| sloppy:", sloppyFrozen(), "| a delete:", deletes());
console.log("a generator:", generator.call(5).next().value);
later.call(5).then(said => console.log("an async function:", said));
let hot = 0;
for (let i = 0; i < 100000; i++) if (strict.call(i) === "number" && sloppy.call(i) === "object") hot++;
console.log("a hundred thousand times:", hot);
module.exports = { strict };

// GENERATED: deletes generator later parameters method getter
// CHECK-LABEL: function {{*}}name="deletes"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[HasExplicitName] thisType={type=anything} results=[{type=anything}] {
// CHECK-NEXT: b0():
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: Jump -> next b2()
// CHECK-NEXT: b2() handler=b3():
// CHECK-NEXT: v0 = Builtin builtin=Object
// CHECK-NEXT: v1 = Builtin builtin=ObjectFreeze
// CHECK-NEXT: v2 = Data data=[[d_1]]
// CHECK-NEXT: v3 = Call v1, v0, v2 calleeName="Object.freeze"
// CHECK-NEXT: v4 = Convert v3 declared={type=undefined|null|[[L_2]] flags=[IsExpected]}
// CHECK-NEXT: v5 = PropDelete v4 key="a"
// CHECK-NEXT: Return v5
// CHECK-NEXT: b3() role=CatchHandler:
// CHECK-NEXT: v6 = CatchValue
// CHECK-NEXT: v7 = PropGet v6 key="name"
// CHECK-NEXT: Return v7
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="generator"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsGenerator, HasThis, TakesCallee, HasExplicitName] thisType={type=anything} results=[{type=undefined|null|Generator<undefined|null|"bigint"|"boolean"|"function"|"number"|"object"|"string"|"symbol"|"undefined"> flags=[IsExpected]}] {
// CHECK-NEXT: b0(v0: anything, v1: function):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: InitialYield
// CHECK-NEXT: v3 = TypeOf v0
// CHECK-NEXT: v4 = Convert v3 declared={type=undefined|null|"bigint"|"boolean"|"function"|"number"|"object"|"string"|"symbol"|"undefined" flags=[IsExpected]}
// CHECK-NEXT: v5 = Yield v4
// CHECK-NEXT: v6 = ResultAt v5
// CHECK-NEXT: v7 = ResultAt v5 index=1
// CHECK-NEXT: Switch v7 cases=[1, 2] -> case b2(), case b3(), otherwise b4()
// CHECK-NEXT: b2():
// CHECK-NEXT: Throw v6
// CHECK-NEXT: b3():
// CHECK-NEXT: Return v6
// CHECK-NEXT: b4():
// CHECK-NEXT: v8 = Undefined
// CHECK-NEXT: Return v8
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="later"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsAsync, HasThis, HasExplicitName] thisType={type=anything} results=[{type=undefined|null|Promise<undefined|null|"bigint"|"boolean"|"function"|"number"|"object"|"string"|"symbol"|"undefined"> flags=[IsExpected]}] {
// CHECK-NEXT: b0(v0: anything):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = TypeOf v0
// CHECK-NEXT: v2 = Convert v1 declared={type=undefined|null|object|"bigint"|"boolean"|"function"|"number"|"object"|"string"|"symbol"|"undefined" flags=[IsExpected]}
// CHECK-NEXT: Return v2
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="parameters"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[HasArgumentCount, HasHiddenRest] length=2 thisType={type=anything} parameters=[{type=undefined|null|string flags=[IsExpected]}, {type=anything}] results=[{type=undefined|null|string flags=[IsExpected]}] functionTypes={{*}}[[f_3]]] {
// CHECK-NEXT: b0(v0: int[0, 4294967295], v1: undefined|null|string, v2: anything, v3: Array):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v4 = CreateUnmappedArguments v0, v3, v1, v2
// CHECK-NEXT: v5 = String string="A"
// CHECK-NEXT: v6 = Convert v5 declared={type=undefined|null|string flags=[IsExpected]}
// CHECK-NEXT: v7 = Integer integer=1
// CHECK-NEXT: v8 = String string="B"
// CHECK-NEXT: ElemSet v4, v7, v8
// CHECK-NEXT: v10 = Convert v2 declared={type=number flags=[IsExpected]}
// CHECK-NEXT: v11 = Integer
// CHECK-NEXT: v12 = ElemGet v4, v11
// CHECK-NEXT: v13 = Integer integer=1
// CHECK-NEXT: v14 = ElemGet v4, v13
// CHECK-NEXT: v15 = NewArray v6, v10, v12, v14 contents=anything
// CHECK-NEXT: v16 = Convert v15 declared={type=undefined|null|Array flags=[IsExpected]}
// CHECK-NEXT: v17 = PropGet v16 key="join"
// CHECK-NEXT: v18 = Convert v17 declared={type=undefined|null|[[f_4]] flags=[IsExpected]}
// CHECK-NEXT: v19 = Call v18, v16 calleeKey="join" calleeName="join"
// CHECK-NEXT: ReturnCall v19 casts=[{declared={type=undefined|null|string flags=[IsExpected]}}]
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="method"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Method flags=[HasThis, HasExplicitName] thisType={type=anything} results=[{type=undefined|null|"bigint"|"boolean"|"function"|"number"|"object"|"string"|"symbol"|"undefined" flags=[IsExpected]}] functionTypes={{*}}[[f_5]]] {
// CHECK-NEXT: b0(v0: anything):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = Convert v0 declared={type=undefined|null|[[L_6]] flags=[IsExpected]}
// CHECK-NEXT: v2 = TypeOf v1
// CHECK-NEXT: v3 = Convert v2 declared={type=undefined|null|"bigint"|"boolean"|"function"|"number"|"object"|"string"|"symbol"|"undefined" flags=[IsExpected]}
// CHECK-NEXT: Return v3
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="getter"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Getter flags=[HasThis, HasExplicitName] thisType={type=anything} results=[{type=undefined|null|"bigint"|"boolean"|"function"|"number"|"object"|"string"|"symbol"|"undefined" flags=[IsExpected]}] {
// CHECK-NEXT: b0(v0: anything):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = Convert v0 declared={type=undefined|null|[[L_6]] flags=[IsExpected]}
// CHECK-NEXT: v2 = TypeOf v1
// CHECK-NEXT: v3 = Convert v2 declared={type=undefined|null|"bigint"|"boolean"|"function"|"number"|"object"|"string"|"symbol"|"undefined" flags=[IsExpected]}
// CHECK-NEXT: Return v3
// CHECK-NEXT: }
