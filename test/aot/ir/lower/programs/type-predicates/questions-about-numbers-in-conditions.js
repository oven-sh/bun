// RUN: lower
// OPTIONS: builtin-modules

// Number.isFinite, isInteger, isSafeInteger and isNaN in a condition test the type first and ask the number behind it: no conversion runs, and a replaced or shadowed one is an ordinary call.
const log = [];
const watched = { valueOf() { log.push("valueOf"); return 1; }, toString() { log.push("toString"); return "1"; }, [Symbol.toPrimitive]() { log.push("toPrimitive"); return 1; } };
const values = () => [undefined, null, true, 0, -0, 1, -1, 1.5, NaN, Infinity, -Infinity, 2 ** 31, 2 ** 53, 2 ** 53 - 1, -(2 ** 53), 1e308, 5e-324, 10n, "", "1", "NaN", Symbol.iterator, {}, [], [1], watched, new Number(1), new Number(NaN), () => 1, new Date(0), new Proxy({}, {})];
const show = (label, ask) => console.log(label, values().map(value => { try { return String(ask(value)); } catch (error) { return error.constructor.name; } }).join(" "), "|", log.splice(0).join());

show("isFinite", function (x) { return Number.isFinite(x) ? x + 1 : "-"; });
show("isInteger", function (x) { return Number.isInteger(x) ? x % 7 : "-"; });
show("isSafeInteger", function (x) { return Number.isSafeInteger(x) ? x - 1 : "-"; });
show("isNaN", function (x) { return Number.isNaN(x) ? typeof x : "-"; });
show("not", function (x) { if (!Number.isFinite(x)) return typeof x; return x * 2; });
show("and", function (x) { return Number.isInteger(x) && x >= 0 ? x | 0 : "-"; });
show("or", function (x) { return Number.isNaN(x) || x === undefined ? "none" : typeof x; });
show("both", function (x) { return Number.isFinite(x) && !Number.isInteger(x) ? Math.floor(x) : "-"; });
show("in a loop", function (x) { let turns = 0; while (Number.isFinite(x) && turns < 3) { x = turns === 1 ? "text" : x + 1; turns++; } return `${turns} ${typeof x}`; });
show("as a value", function (x) { const answer = Number.isFinite(x); return answer ? x + 1 : answer; });
show("of an expression", function (x) { return Number.isFinite(x?.length) ? x.length : "-"; });
show("of an assignment", function (x) { let kept; return Number.isFinite((kept = x)) ? kept + 1 : typeof kept; });
show("of a call", function (x) { let calls = 0; const give = () => (calls++, x); return `${Number.isInteger(give()) ? "whole" : "-"}${calls}`; });
show("no operand", function () { return Number.isFinite() ? "never" : Number.isNaN() ? "never" : "-"; });
show("two operands", function (x) { let seen = 0; return `${Number.isFinite(x, seen++) ? x + 1 : "-"}${seen}`; });
show("a spread", function (x) { return Number.isFinite(...[x]) ? x + 1 : "-"; });
show("optional call", function (x) { return Number.isFinite?.(x) ? x + 1 : "-"; });
show("optional member", function (x) { return Number?.isFinite(x) ? x + 1 : "-"; });
show("by a key", function (x) { return Number["isFinite"](x) ? x + 1 : "-"; });
show("taken off", function (x) { const { isFinite: ask } = Number; return ask(x) ? x + 1 : "-"; });
show("through call", function (x) { return Number.isFinite.call(null, x) ? x + 1 : "-"; });
show("the global ones convert", function (x) { return `${isFinite(x) ? "f" : "-"}${isNaN(x) ? "n" : "-"}`; });
show("another Number", function (x) { const Number = { isFinite: value => value === "1", isNaN: () => true }; return `${Number.isFinite(x) ? "mine" : "-"}${Number.isNaN(x) ? "!" : ""}`; });
show("a parameter called Number", (x, Number = { isInteger: value => typeof value === "string" }) => (Number.isInteger(x) ? "text" : "-"));
{
  class Number { static isFinite(value) { return value === null; } }
  show("a class called Number", x => (Number.isFinite(x) ? "null" : "-"));
}

// GENERATED: [Symbol.toPrimitive] values Number give
// CHECK-LABEL: function {{*}}name="[Symbol.toPrimitive]"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Method flags=[IsNamedByComputedKey] thisType={type=anything} results=[{type=number flags=[IsExpected]}] {
// CHECK-NEXT: b0():
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v0 = GetModuleVariable variable=[[g_1]]
// CHECK-NEXT: v1 = CheckInitialized v0 name="log"
// CHECK-NEXT: v2 = PropGet v1 key="push"
// CHECK-NEXT: v3 = Convert v2 declared={type=undefined|null|[[f_2]] flags=[IsExpected]}
// CHECK-NEXT: v4 = String string="toPrimitive"
// CHECK-NEXT: v5 = Call v3, v1, v4 calleeKey="push" calleeName="log.push"
// CHECK-NEXT: v6 = Integer integer=1
// CHECK-NEXT: v7 = Convert v6 declared={type=number flags=[IsExpected]}
// CHECK-NEXT: Return v7
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="values"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Arrow thisType={type=anything} results=[{type=undefined|null|Array flags=[IsExpected]}] functionTypes={{*}}[[f_3]]] {
// CHECK-NEXT: b0():
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v0 = Undefined
// CHECK-NEXT: v1 = Null
// CHECK-NEXT: v2 = Boolean boolean=true
// CHECK-NEXT: v3 = Integer
// CHECK-NEXT: v4 = Double number=-0
// CHECK-NEXT: v5 = Integer integer=1
// CHECK-NEXT: v6 = Integer integer=-1
// CHECK-NEXT: v7 = Double number=1.5
// CHECK-NEXT: v8 = Double number=NaN
// CHECK-NEXT: v9 = Double number=Infinity
// CHECK-NEXT: v10 = Double number=-Infinity
// CHECK-NEXT: v11 = Integer integer=2147483648
// CHECK-NEXT: v12 = Integer integer=9007199254740992
// CHECK-NEXT: v13 = Integer integer=9007199254740991
// CHECK-NEXT: v14 = Integer integer=-9007199254740992
// CHECK-NEXT: v15 = Double number=1e+308
// CHECK-NEXT: v16 = Double number=5e-324
// CHECK-NEXT: v17 = BigInt digits="10"
// CHECK-NEXT: v18 = String string=""
// CHECK-NEXT: v19 = String string="1"
// CHECK-NEXT: v20 = String string="NaN"
// CHECK-NEXT: v21 = Builtin builtin=SymbolIterator
// CHECK-NEXT: v22 = Data data=[[d_4]]
// CHECK-NEXT: v23 = Data data=[[d_5]]
// CHECK-NEXT: v24 = Convert v23 declared={type=undefined|null|Array<never> flags=[IsExpected]}
// CHECK-NEXT: v25 = Data data=[[d_6]]
// CHECK-NEXT: v26 = Convert v25 declared={type=undefined|null|Array<number> flags=[IsExpected]}
// CHECK-NEXT: v27 = GetModuleVariable variable=[[g_7]]
// CHECK-NEXT: v28 = CheckInitialized v27 name="watched"
// CHECK-NEXT: v29 = Builtin builtin=Number
// CHECK-NEXT: v30 = Integer integer=1
// CHECK-NEXT: v31 = Construct v29, -, v30 calleeName="Number"
// CHECK-NEXT: v32 = Convert v31 declared={type=undefined|null|number|Number flags=[IsExpected]}
// CHECK-NEXT: v33 = Builtin builtin=Number
// CHECK-NEXT: v34 = Double number=NaN
// CHECK-NEXT: v35 = Construct v33, -, v34 calleeName="Number"
// CHECK-NEXT: v36 = Convert v35 declared={type=undefined|null|number|Number flags=[IsExpected]}
// CHECK-NEXT: v37 = NewClosure function=[[f_8]]
// CHECK-NEXT: v38 = Builtin builtin=GlobalThis
// CHECK-NEXT: v39 = PropGet v38 key="Date" [isFreeName]
// CHECK-NEXT: v40 = Convert v39 declared={type=builtin(Date) flags=[IsExpected]}
// CHECK-NEXT: v41 = Integer
// CHECK-NEXT: v42 = Construct v40, -, v41 calleeName="Date"
// CHECK-NEXT: v43 = Convert v42 declared={type=undefined|null|Date flags=[IsExpected]}
// CHECK-NEXT: v44 = Builtin builtin=Proxy
// CHECK-NEXT: v45 = Data data=[[d_9]]
// CHECK-NEXT: v46 = Data data=[[d_10]]
// CHECK-NEXT: v47 = Construct v44, -, v45, v46 calleeName="Proxy"
// CHECK-NEXT: v48 = NewArray v0, v1, v2, v3, v4, v5, v6, v7, v8, v9, v10, v11, v12, v13, v14, v15, v16, v17, v18, v19, v20, v21, v22, v24, v26, v28, v32, v36, v37, v43, v47 contents=anything
// CHECK-NEXT: v49 = Convert v48 declared={type=undefined|null|Array flags=[IsExpected]}
// CHECK-NEXT: Return v49
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="Number"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=BaseConstructor flags=[HasNewTarget, HasExplicitName] thisType={type=anything} results=[{type=object flags=[IsFromCompiler]}] {
// CHECK-NEXT: b0(v0: anything):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = GetConstructPrototype v0 layout=[[L_11]]
// CHECK-NEXT: v2 = NewObject v1 layout=[[L_11]]
// CHECK-NEXT: v3 = Convert v2 declared={type=[[L_11]] flags=[IsFromCompiler]} illTypedCause=FromLooseType
// CHECK-NEXT: Return v3
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="give"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Arrow captures=[{type=env [[L_12]] flags=[IsFromCompiler]}, {type=anything}] thisType={type=anything} results=[{type=anything}] functionTypes={{*}}[[f_13]]] {
// CHECK-NEXT: b0(v0: env [[L_12]], v1: anything):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v2 = GetEnvironmentField v0 layout=[[L_12]]
// CHECK-NEXT: v3 = CheckInitialized v2 name="calls"
// CHECK-NEXT: v4 = Increment v3
// CHECK-NEXT: v5 = Convert v4 declared={type=number flags=[IsExpected]}
// CHECK-NEXT: v6 = GetEnvironmentField v0 layout=[[L_12]]
// CHECK-NEXT: v7 = CheckInitialized v6 name="calls"
// CHECK-NEXT: PutEnvironmentField v0, v5 layout=[[L_12]]
// CHECK-NEXT: Return v1
// CHECK-NEXT: }
