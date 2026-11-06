// RUN: lower
// OPTIONS: builtin-modules

// A function that native code calls (a JSON reviver, a sort comparator, a promise job, a timer, a proxy trap ..) ends in a tail call, so no compiled frame is left between the native caller and the callee, whatever kind of callee that is.
declare const console: any, setTimeout: any;
const plain: any = function (x: any) { return "plain " + String(x); };
const callees: [string, any][] = [
  ["function", plain], ["arrow", (x: any) => "arrow " + String(x)], ["proxy", new Proxy(plain, {})], ["proxy of a proxy", new Proxy(new Proxy(plain, {}), {})],
  ["proxy with a trap", new Proxy(plain, { apply(t: any, _: any, a: any[]) { return "trapped " + t(...a); } })], ["bound", plain.bind(null)], ["bound with an argument", plain.bind(null, "b")],
  ["bound proxy", new Proxy(plain, {}).bind(null)], ["host", Math.abs], ["String", String], ["Number", Number], ["Boolean", Boolean], ["Object", Object], ["Array", Array], ["Symbol", (x: any) => String(Symbol(String(x)))],
  ["Error", (x: any) => String(Error(String(x)))], ["class", class K { }], ["async", async (x: any) => x], ["generator", function* (x: any) { yield x; }], ["rest", (...a: any[]) => "rest " + a.length],
  ["arguments", function () { return "arguments " + arguments.length; }], ["six parameters", (a: any, b: any, c: any, d: any, e: any, f: any) => "six " + String(a) + String(f)], ["object", {}], ["undefined", undefined], ["number", 7],
];
function show(v: any): string { return typeof v === "object" && v !== null ? Object.prototype.toString.call(v) : String(v); }
function attempt(f: () => any): string { try { return show(f()); } catch (e: any) { return "threw " + e.constructor.name; } }
const later: Promise<string>[] = [];
for (const [name, callee] of callees) {
  const one: any = function (x: any) { return callee(x); };
  const two: any = function (a: any, b: any) { return callee(a, b); };
  const many: any = function (a: any) { return callee(a, 1, 2, 3, 4, 5, 6, 7, 8, 9); };
  const spread: any = function (...a: any[]) { return callee(...a); };
  const applied: any = function () { return callee.apply(undefined, arguments); };
  const line = [
    attempt(() => JSON.parse("[1]", function (k: any, v: any) { return k === "0" ? show(callee(v)) : v; })[0]),
    attempt(() => { let r: any; JSON.parse("1", function (_: any, v: any) { r = attempt(() => one(v)); return v; }); return r; }),
    attempt(() => { let seen: any; try { JSON.parse("1", one); seen = "returned"; } catch (e: any) { seen = "threw " + e.constructor.name; } return seen; }),
    attempt(() => { try { JSON.parse("1", many); return "returned"; } catch (e: any) { return "threw " + e.constructor.name; } }),
    attempt(() => { try { JSON.parse("1", spread); return "returned"; } catch (e: any) { return "threw " + e.constructor.name; } }),
    attempt(() => { try { JSON.parse("1", applied); return "returned"; } catch (e: any) { return "threw " + e.constructor.name; } }),
    attempt(() => Reflect.apply(one, undefined, [2])),
    attempt(() => Reflect.apply(many, undefined, [2])),
    attempt(() => Reflect.apply(spread, undefined, [2, 3, 4, 5, 6, 7])),
    attempt(() => "x".replace("x", one).length > 0),
    attempt(() => Array.from([3], one)[0]),
    attempt(() => Array.from({ length: 1, 0: 4 } as any, two)[0]),
    attempt(() => { try { [2, 1].sort(two); return "sorted"; } catch (e: any) { return "threw " + e.constructor.name; } }),
    attempt(() => (new Proxy({}, { get: two } as any) as any).key),
    attempt(() => { try { return String({ [Symbol.toPrimitive]: one }).length >= 0; } catch (e: any) { return "threw " + e.constructor.name; } }),
    attempt(() => { try { return JSON.stringify({ toJSON: one }) !== ""; } catch (e: any) { return "threw " + e.constructor.name; } }),
  ];
  console.log(name + ": " + line.join(" | "));
  later.push(Promise.resolve(5).then(one).then(show, (e: any) => "rejected " + e.constructor.name).then(s => name + " in a promise job: " + s));
  later.push(new Promise<string>(resolve => { setTimeout(function () { resolve(name + " in a timer: fired"); try { } catch { } return typeof callee === "function" && name !== "class" ? callee(7) : undefined; }, 0); }));
}
Promise.all(later).then(lines => console.log(lines.join("\n")));
export {};

// GENERATED: show attempt K spread applied
// CHECK-LABEL: function {{*}}name="show"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=anything}] results=[{type=undefined|null|string site=[[w_1]] flags=[OmitsNull, OmitsUndefined]}] functionTypes={{*}}[[f_2]]] {
// CHECK-NEXT: b0(v0: anything):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = TypeTest v0 testedType=function
// CHECK-NEXT: Branch v1 -> taken b2(| 0), notTaken b3(| 0)
// CHECK-NEXT: b2(v2):
// CHECK-NEXT: Jump -> next b10(v2)
// CHECK-NEXT: b3(v3):
// CHECK-NEXT: v4 = TypeTest v3 testedType=null|object
// CHECK-NEXT: Branch v4 -> taken b4(| 0), notTaken b9(| 0)
// CHECK-NEXT: b4(v5):
// CHECK-NEXT: Jump -> next b5()
// CHECK-NEXT: b5():
// CHECK-NEXT: v6 = TypeTest v5 testedType=null
// CHECK-NEXT: Branch v6 -> taken b6(| 0), notTaken b7(| 0)
// CHECK-NEXT: b6(v7):
// CHECK-NEXT: Jump -> next b10(v7)
// CHECK-NEXT: b7(v8):
// CHECK-NEXT: Jump -> next b8()
// CHECK-NEXT: b8():
// CHECK-NEXT: v9 = Builtin builtin=ObjectPrototypeToString
// CHECK-NEXT: v10 = PropGet v9 key="call"
// CHECK-NEXT: v11 = Convert v10 declared={type=builtin(FunctionPrototypeCall) flags=[IsExpected]}
// CHECK-NEXT: v12 = Call v11, v9, v8 calleeKey="call" calleeName="Object.prototype.toString.call"
// CHECK-NEXT: ReturnCall v12 casts=[{declared={type=undefined|null|string site=[[w_3]] flags=[OmitsNull, OmitsUndefined]}}, {declared={type=undefined|null|string site=[[w_1]] flags=[OmitsNull, OmitsUndefined]}}]
// CHECK-NEXT: b9(v13):
// CHECK-NEXT: Jump -> next b10(v13)
// CHECK-NEXT: b10(v14):
// CHECK-NEXT: v15 = Builtin builtin=String
// CHECK-NEXT: v16 = Call v15, -, v14 calleeName="String"
// CHECK-NEXT: ReturnCall v16 casts=[{declared={type=undefined|null|string site=[[w_4]] flags=[OmitsNull, OmitsUndefined]}}, {declared={type=undefined|null|string site=[[w_1]] flags=[OmitsNull, OmitsUndefined]}}]
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="attempt"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=undefined|null|[[f_5]] site=[[w_6]] flags=[OmitsNull, OmitsUndefined]}] results=[{type=undefined|null|string site=[[w_7]] flags=[OmitsNull, OmitsUndefined]}] {
// CHECK-NEXT: b0(v0: undefined|null|[[f_5]]):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: Jump -> next b2()
// CHECK-NEXT: b2() handler=b3():
// CHECK-NEXT: v1 = GetModuleVariable variable=[[g_8]]
// CHECK-NEXT: v2 = Call v0 calleeName="f"
// CHECK-NEXT: v3 = Call v1, -, v2 calleeName="show"
// CHECK-NEXT: v4 = Convert v3 declared={type=undefined|null|string site=[[w_9]] flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: Return v4
// CHECK-NEXT: b3() role=CatchHandler:
// CHECK-NEXT: v5 = CatchValue
// CHECK-NEXT: v6 = String string="threw "
// CHECK-NEXT: v7 = PropGet v5 key="constructor"
// CHECK-NEXT: v8 = Convert v7 declared={type=undefined|null|number|string|symbol|bigint|[[L_10]] flags=[IsExpected]}
// CHECK-NEXT: v9 = PropGet v8 key="name"
// CHECK-NEXT: v10 = Add v6, v9
// CHECK-NEXT: v11 = Convert v10 declared={type=undefined|null|string site=[[w_7]] flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: Return v11
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="K"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=BaseConstructor flags=[HasNewTarget, IsChecked, HasExplicitName] thisType={type=anything} results=[{type=object flags=[IsFromCompiler]}] {
// CHECK-NEXT: b0(v0: anything):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = GetConstructPrototype v0 layout=[[L_11]]
// CHECK-NEXT: v2 = NewObject v1 layout=[[L_11]]
// CHECK-NEXT: v3 = Convert v2 declared={type=[[L_11]] flags=[IsFromCompiler]} illTypedCause=FromLooseType
// CHECK-NEXT: Return v3
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="spread"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[HasRestParameter, IsChecked] captures=[{type=anything}] thisType={type=anything} parameters=[{type=Array site=[[w_12]] flags=[IsFromCompiler, OmitsNull, OmitsUndefined]}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: anything, v1: Array):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v2 = Convert v0 declared={type=undefined|null|function flags=[IsExpected]}
// CHECK-NEXT: v3 = NewArray contents=anything
// CHECK-NEXT: AppendSpread v3, v1
// CHECK-NEXT: v5 = CallList v2, -, v3 calleeName="callee"
// CHECK-NEXT: ReturnCall v5
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="applied"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[HasArgumentCount, HasHiddenRest, IsChecked] captures=[{type=anything}] thisType={type=anything} results=[{type=anything}] {
// CHECK-NEXT: b0(v0: anything, v1: int[0, 4294967295], v2: Array):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v3 = CreateUnmappedArguments v1, v2
// CHECK-NEXT: v4 = Convert v0 declared={type=undefined|null|function flags=[IsExpected]}
// CHECK-NEXT: v5 = PropGet v4 key="apply"
// CHECK-NEXT: v6 = Convert v5 declared={type=undefined|null|[[f_13]] flags=[IsExpected]}
// CHECK-NEXT: v7 = Undefined
// CHECK-NEXT: v8 = Call v6, v4, v7, v3 calleeKey="apply" calleeName="callee.apply"
// CHECK-NEXT: ReturnCall v8
// CHECK-NEXT: }
