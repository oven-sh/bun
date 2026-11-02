// RUN: lower
// OPTIONS: builtin-modules

// Function.prototype.call where the compiler does not see which function is called: the callee is a parameter of a function that anybody may call, `call` itself is taken as a value,
// handed to Reflect.apply, bound, called through itself. With no argument up to more than fit in registers; callees of every kind; receivers that cannot be called.
const lines = [];
function show(name, run) {
  const seen = [];
  for (let turn = 0; turn < 3; turn++) {
    try {
      seen.push(String(JSON.stringify(run(turn)) ?? "undefined"));
    } catch (error) {
      seen.push(error.constructor.name + (error instanceof RangeError ? ": " + error.message : ""));
    }
  }
  lines.push(name + ": " + seen.join(" | "));
}
const describe = value => (value === undefined ? "undefined" : value === null ? "null" : value === globalThis ? "globalThis" : typeof value === "object" ? "object " + Object.prototype.toString.call(value) + " " + String(value.valueOf()) : typeof value + " " + String(value));

function sloppy() { return [describe(this), arguments.length, ...arguments]; }
function strict() { "use strict"; return [describe(this), arguments.length, ...arguments]; }
function three(a, b, c) { "use strict"; return [describe(this), a, b, c]; }
function rest(first, ...others) { "use strict"; return [describe(this), first, others]; }
function defaults(a = "A", b = a + "B") { "use strict"; return [describe(this), a, b]; }
const arrow = (...all) => ["arrow", all];
const method = { name: "holder", m(a, b) { return [this === undefined ? "undefined" : this.name, a, b]; } }.m;
class Base { constructor() { this.made = true; } static s(a) { return [this === Base, a]; } get g() { return "getter of " + this.name; } }
async function later(a, b) { return [describe(this), a, b]; }
function* steps(a, b) { yield describe(this); yield a; yield b; }
const bound = strict.bind("bound this", "bound argument");
function thrower(a) { "use strict"; throw new RangeError("thrown with " + a + " under " + describe(this)); }
const proxied = new Proxy(strict, {});
const trapped = new Proxy(strict, { apply: (target, self, list) => ["trap", describe(self), list] });

const callers = {
  member0: f => f.call(),
  member1: f => f.call("T"),
  member2: f => f.call("T", 1),
  member3: f => f.call("T", 1, 2),
  member4: f => f.call("T", 1, 2, 3),
  member5: f => f.call("T", 1, 2, 3, 4),
  member6: f => f.call("T", 1, 2, 3, 4, 5),
  member9: f => f.call("T", 1, 2, 3, 4, 5, 6, 7, 8),
  spread: f => f.call(...["T", 1, 2, 3]),
  spreadMany: f => f.call("T", ...Array.from({ length: 40 }, (_, i) => i)),
  undefinedThis: f => f.call(undefined, 1),
  nullThis: f => f.call(null, 1),
  numberThis: f => f.call(7, 1),
  objectThis: f => f.call({ name: "given", valueOf: () => "given" }, 1, 2),
};
globalThis.callersForAnybody = callers;
const callees = { sloppy, strict, three, rest, defaults, arrow, method, bound, proxied, trapped, "a static method": Base.s, "a native function": Array.prototype.concat, "Math.max": Math.max, "String.prototype.slice": String.prototype.slice };
for (const [calleeName, callee] of Object.entries(callees))
  for (const [callerName, caller] of Object.entries(globalThis.callersForAnybody))
    show(calleeName + " by " + callerName, () => caller(callee));

const call = Function.prototype.call;
show("call has its name and length", () => [call.name, call.length, typeof call, Object.getOwnPropertyNames(call).sort(), "prototype" in call]);
show("call through call", () => [call.call(strict, "T", 1, 2), call.call(call, strict, "T", 1), call.call(call, call, strict, "T", 1)]);
show("call through apply", () => [call.apply(strict, ["T", 1, 2]), call.apply(strict, []), call.apply(strict), call.apply(strict, ["T", 1, 2, 3, 4, 5, 6, 7])]);
show("call through Reflect.apply", () => [Reflect.apply(call, strict, ["T", 1]), Reflect.apply(call, three, ["T", 1, 2, 3, 4, 5, 6])]);
show("call that is bound", () => [call.bind(strict)("T", 1), call.bind(strict, "T")(1, 2), call.bind(strict, "T", 1, 2, 3, 4, 5)(6)]);
show("call as a callback", () => [[strict, three].map(call, strict).length, ["a", "b"].map(Function.prototype.call, String.prototype.toUpperCase)]);
show("call kept in an object", () => { const o = { f: strict, call }; return [o.call === call, o.f.call(o.f.name, 1)]; });
show("a function with its own call", () => { const f = function () { return "body"; }; f.call = (...all) => ["own call", all]; return globalThis.callersForAnybody.member3(f); });
show("an object with a call that is no function", () => globalThis.callersForAnybody.member2({ call: (...all) => ["a member named call", all] }));
for (const [name, value] of Object.entries({ "an object": {}, "a number": 1, "a string": "s", undefined, null: null, "a symbol": Symbol.iterator, "an array": [], "a class": Base, "a derived class": class extends Base {} })) {
  show("call on " + name + " with nothing", () => call.call(value));
  show("call on " + name + " with three", () => call.call(value, "T", 1, 2));
  show("call on " + name + " with nine", () => call.call(value, "T", 1, 2, 3, 4, 5, 6, 7, 8));
}
show("new call", () => new call());
show("the callee throws", turn => globalThis.callersForAnybody["member" + (turn + 1)](thrower));
show("a generator", () => [...globalThis.callersForAnybody.member3(steps)]);
show("a getter's function", () => globalThis.callersForAnybody.objectThis(Object.getOwnPropertyDescriptor(Base.prototype, "g").get));
show("arguments are evaluated in order, before the callee is tested", () => { const order = []; try { globalThis.callersForAnybody.order = f => f.call((order.push("this"), "T"), (order.push("first"), 1), (order.push("second"), 2)); globalThis.callersForAnybody.order(3); } catch (error) { order.push(error.constructor.name); } return order; });
show("deep", () => { "use strict"; function down(n) { return n === 0 ? describe(this) : down.call(this, n - 1); } return globalThis.callersForAnybody.member2.call(null, { call: (self, n) => down.call(self, 2000 + n) }); });
const waited = [];
for (const name of ["member1", "member3", "member6"]) waited.push(globalThis.callersForAnybody[name](later).then(value => name + ": " + JSON.stringify(value)));
Promise.all(waited).then(all => { lines.push("an async function: " + all.join(" | ")); console.log(lines.join("\n")); });

// GENERATED: strict steps Base spreadMany
// CHECK-LABEL: function {{*}}name="strict"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[HasThis, HasArgumentCount, HasHiddenRest, HasExplicitName] thisType={type=anything} results=[{type=undefined|null|Array flags=[IsExpected]}] functionTypes={{*}}[[f_1]]] {
// CHECK-NEXT: b0(v0: anything, v1: int[0, 4294967295], v2: Array):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v3 = CreateUnmappedArguments v1, v2
// CHECK-NEXT: v4 = GetModuleVariable variable=[[g_2]]
// CHECK-NEXT: v5 = CheckInitialized v4 name="describe"
// CHECK-NEXT: v6 = Call v5, -, v0 calleeName="describe"
// CHECK-NEXT: v7 = Convert v6 declared={type=undefined|null|string flags=[IsExpected]}
// CHECK-NEXT: v8 = PropGet v3 key="length"
// CHECK-NEXT: v9 = Convert v8 declared={type=number flags=[IsExpected]}
// CHECK-NEXT: v10 = NewArray v7, v9 contents=anything
// CHECK-NEXT: AppendSpread v10, v3
// CHECK-NEXT: v12 = Convert v10 declared={type=undefined|null|Array flags=[IsExpected]}
// CHECK-NEXT: Return v12
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="steps"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsGenerator, HasThis, TakesCallee, HasExplicitName] length=2 thisType={type=anything} parameters=[{type=anything}, {type=anything}] results=[{type=undefined|null|Generator flags=[IsExpected]}] {
// CHECK-NEXT: b0(v0: anything, v1: function, v2: anything, v3: anything):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: InitialYield v2, v3
// CHECK-NEXT: v5 = GetModuleVariable variable=[[g_2]]
// CHECK-NEXT: v6 = CheckInitialized v5 name="describe"
// CHECK-NEXT: v7 = Call v6, -, v0 calleeName="describe"
// CHECK-NEXT: v8 = Convert v7 declared={type=undefined|null|string flags=[IsExpected]}
// CHECK-NEXT: v9 = Yield v8, v2, v3
// CHECK-NEXT: v10 = ResultAt v9
// CHECK-NEXT: v11 = ResultAt v9 index=1
// CHECK-NEXT: Switch v11 cases=[1, 2] -> case b2(), case b3(), otherwise b4()
// CHECK-NEXT: b2():
// CHECK-NEXT: Throw v10
// CHECK-NEXT: b3():
// CHECK-NEXT: Return v10
// CHECK-NEXT: b4():
// CHECK-NEXT: v12 = Yield v2, v2, v3
// CHECK-NEXT: v13 = ResultAt v12
// CHECK-NEXT: v14 = ResultAt v12 index=1
// CHECK-NEXT: Switch v14 cases=[1, 2] -> case b5(), case b6(), otherwise b7()
// CHECK-NEXT: b5():
// CHECK-NEXT: Throw v13
// CHECK-NEXT: b6():
// CHECK-NEXT: Return v13
// CHECK-NEXT: b7():
// CHECK-NEXT: v15 = Yield v3, v2, v3
// CHECK-NEXT: v16 = ResultAt v15
// CHECK-NEXT: v17 = ResultAt v15 index=1
// CHECK-NEXT: Switch v17 cases=[1, 2] -> case b8(), case b9(), otherwise b10()
// CHECK-NEXT: b8():
// CHECK-NEXT: Throw v16
// CHECK-NEXT: b9():
// CHECK-NEXT: Return v16
// CHECK-NEXT: b10():
// CHECK-NEXT: v18 = Undefined
// CHECK-NEXT: Return v18
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="Base"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=BaseConstructor flags=[HasNewTarget, HasExplicitName] thisType={type=anything} results=[{type=object flags=[IsFromCompiler]}] functionTypes={{*}}[[f_3]]] {
// CHECK-NEXT: b0(v0: anything):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = GetConstructPrototype v0 layout=[[L_4]]
// CHECK-NEXT: v2 = NewObject v1 layout=[[L_4]]
// CHECK-NEXT: v3 = Convert v2 declared={type=[[L_4]] flags=[IsFromCompiler]} illTypedCause=FromLooseType
// CHECK-NEXT: v4 = Convert v3 declared={type=undefined|null|[[L_4]] flags=[IsExpected]}
// CHECK-NEXT: v5 = Boolean boolean=true
// CHECK-NEXT: v6 = Convert v5 declared={type=boolean flags=[IsExpected]}
// CHECK-NEXT: PropSet v4, v6 key="made"
// CHECK-NEXT: v8 = Undefined
// CHECK-NEXT: v9 = TypeTest v8 testedType=object
// CHECK-NEXT: Branch v9 -> taken b2(| 0), notTaken b3(| 0)
// CHECK-NEXT: b2(v10):
// CHECK-NEXT: Jump -> next b4(v10)
// CHECK-NEXT: b3(v11):
// CHECK-NEXT: Jump -> next b4(v3)
// CHECK-NEXT: b4(v12):
// CHECK-NEXT: Return v12
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="spreadMany"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Arrow length=1 thisType={type=anything} parameters=[{type=anything}] results=[{type=anything}] functionTypes={{*}}[[f_5]]] {
// CHECK-NEXT: b0(v0: anything):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = PropGet v0 key="call"
// CHECK-NEXT: v2 = Convert v1 declared={type=undefined|null|function flags=[IsExpected]}
// CHECK-NEXT: v3 = String string="T"
// CHECK-NEXT: v4 = NewArray v3 contents=anything
// CHECK-NEXT: v5 = Builtin builtin=ArrayFrom
// CHECK-NEXT: v6 = Integer integer=40
// CHECK-NEXT: v7 = Undefined
// CHECK-NEXT: v8 = NewClosure function=[[f_6]]
// CHECK-NEXT: v9 = Builtin builtin=CompilerHelpersArrayFromLength [isNotReadFromHolder]
// CHECK-NEXT: v10 = Call v9, -, v6, v8
// CHECK-NEXT: v11 = Convert v10 declared={type=undefined|null|Array<number> flags=[IsExpected]}
// CHECK-NEXT: AppendSpread v4, v11
// CHECK-NEXT: v13 = CallList v2, v0, v4 calleeKey="call" calleeName="f.call"
// CHECK-NEXT: ReturnCall v13
// CHECK-NEXT: }
