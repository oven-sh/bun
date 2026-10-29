// RUN: lower
// OPTIONS: builtin-modules

// In a file of CommonJS, which is sloppy, a function whose body begins with "use strict" is as sloppy as the file: plain Bun drops the directive of a function when it transpiles, and --aot does what plain Bun does. The stored output is that of plain Bun; run-aot-matches-executable.test.ts reads it.
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
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsSloppy, HasExplicitName] thisType={type=anything} results=[{type=anything}] {
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
// CHECK-NEXT: v5 = PropDelete v4 key="a" mode=Sloppy
// CHECK-NEXT: Return v5
// CHECK-NEXT: b3() role=CatchHandler:
// CHECK-NEXT: v6 = CatchValue
// CHECK-NEXT: v7 = PropGet v6 key="name"
// CHECK-NEXT: Return v7
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="generator"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsGenerator, IsSloppy, HasThis, TakesCallee, HasExplicitName] thisType={type=anything} results=[{type=undefined|null|Generator<undefined|null|"bigint"|"boolean"|"function"|"number"|"object"|"string"|"symbol"|"undefined"> flags=[IsExpected]}] {
// CHECK-NEXT: b0(v0: anything, v1: function):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v2 = ToThis v0
// CHECK-NEXT: InitialYield
// CHECK-NEXT: v4 = TypeOf v2
// CHECK-NEXT: v5 = Convert v4 declared={type=undefined|null|"bigint"|"boolean"|"function"|"number"|"object"|"string"|"symbol"|"undefined" flags=[IsExpected]}
// CHECK-NEXT: v6 = Yield v5
// CHECK-NEXT: v7 = ResultAt v6
// CHECK-NEXT: v8 = ResultAt v6 index=1
// CHECK-NEXT: Switch v8 cases=[1, 2] -> case b2(), case b3(), otherwise b4()
// CHECK-NEXT: b2():
// CHECK-NEXT: Throw v7
// CHECK-NEXT: b3():
// CHECK-NEXT: Return v7
// CHECK-NEXT: b4():
// CHECK-NEXT: v9 = Undefined
// CHECK-NEXT: Return v9
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="later"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsAsync, IsSloppy, HasThis, HasExplicitName] thisType={type=anything} results=[{type=undefined|null|Promise<undefined|null|"bigint"|"boolean"|"function"|"number"|"object"|"string"|"symbol"|"undefined"> flags=[IsExpected]}] {
// CHECK-NEXT: b0(v0: anything):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = ToThis v0
// CHECK-NEXT: v2 = TypeOf v1
// CHECK-NEXT: v3 = Convert v2 declared={type=undefined|null|object|"bigint"|"boolean"|"function"|"number"|"object"|"string"|"symbol"|"undefined" flags=[IsExpected]}
// CHECK-NEXT: Return v3
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="parameters"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsSloppy, TakesCallee, HasArgumentCount, HasHiddenRest] length=2 thisType={type=anything} parameters=[{type=undefined|null|string flags=[IsExpected]}, {type=anything}] results=[{type=undefined|null|string flags=[IsExpected]}] functionTypes={{*}}[[f_3]]] {
// CHECK-NEXT: b0(v0: function, v1: int[0, 4294967295], v2: undefined|null|string, v3: anything, v4: Array):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v5 = CreateMappedArguments v0, v1, v4, v2, v3
// CHECK-NEXT: v6 = String string="A"
// CHECK-NEXT: v7 = Convert v6 declared={type=undefined|null|string flags=[IsExpected]}
// CHECK-NEXT: SetMappedArgument v5, v7
// CHECK-NEXT: v9 = Integer integer=1
// CHECK-NEXT: v10 = String string="B"
// CHECK-NEXT: ElemSet v5, v9, v10 mode=Sloppy
// CHECK-NEXT: v12 = GetMappedArgument v5
// CHECK-NEXT: v13 = GetMappedArgument v5 index=1
// CHECK-NEXT: v14 = Convert v13 declared={type=number flags=[IsExpected]}
// CHECK-NEXT: v15 = Integer
// CHECK-NEXT: v16 = ElemGet v5, v15
// CHECK-NEXT: v17 = Integer integer=1
// CHECK-NEXT: v18 = ElemGet v5, v17
// CHECK-NEXT: v19 = NewArray v12, v14, v16, v18 contents=anything
// CHECK-NEXT: v20 = Convert v19 declared={type=undefined|null|Array flags=[IsExpected]}
// CHECK-NEXT: v21 = PropGet v20 key="join"
// CHECK-NEXT: v22 = Convert v21 declared={type=undefined|null|[[f_4]] flags=[IsExpected]}
// CHECK-NEXT: v23 = Call v22, v20 calleeKey="join" calleeName="join"
// CHECK-NEXT: v24 = Convert v23 declared={type=undefined|null|string flags=[IsExpected]}
// CHECK-NEXT: Return v24
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="method"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Method flags=[IsSloppy, HasThis, HasExplicitName] thisType={type=anything} results=[{type=undefined|null|"bigint"|"boolean"|"function"|"number"|"object"|"string"|"symbol"|"undefined" flags=[IsExpected]}] functionTypes={{*}}[[f_5]]] {
// CHECK-NEXT: b0(v0: anything):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = ToThis v0
// CHECK-NEXT: v2 = Convert v1 declared={type=undefined|null|[[L_6]] flags=[IsExpected]}
// CHECK-NEXT: v3 = TypeOf v2
// CHECK-NEXT: v4 = Convert v3 declared={type=undefined|null|"bigint"|"boolean"|"function"|"number"|"object"|"string"|"symbol"|"undefined" flags=[IsExpected]}
// CHECK-NEXT: Return v4
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="getter"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Getter flags=[IsSloppy, HasThis, HasExplicitName] thisType={type=anything} results=[{type=undefined|null|"bigint"|"boolean"|"function"|"number"|"object"|"string"|"symbol"|"undefined" flags=[IsExpected]}] {
// CHECK-NEXT: b0(v0: anything):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = ToThis v0
// CHECK-NEXT: v2 = Convert v1 declared={type=undefined|null|[[L_6]] flags=[IsExpected]}
// CHECK-NEXT: v3 = TypeOf v2
// CHECK-NEXT: v4 = Convert v3 declared={type=undefined|null|"bigint"|"boolean"|"function"|"number"|"object"|"string"|"symbol"|"undefined" flags=[IsExpected]}
// CHECK-NEXT: Return v4
// CHECK-NEXT: }
