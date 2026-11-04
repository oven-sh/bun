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
function rest(first, ...others) { return [describe(this), first, others]; }
function defaults(a = "A", b = a + "B") { return [describe(this), a, b]; }
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
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[HasThis, HasArgumentCount, HasHiddenRest, HasExplicitName] thisType={type=anything} results=[{type=anything}] functionTypes={{*}}[[f_1]]] {
// CHECK-NEXT: b0(v0: anything, v1: int[0, 4294967295], v2: Array):
// CHECK-NEXT: v3 = CreateUnmappedArguments v1, v2
// CHECK-NEXT: v4 = GetModuleVariable variable=[[g_2]]
// CHECK-NEXT: v5 = CheckInitialized v4 name="describe"
// CHECK-NEXT: v6 = Call v5, -, v0 calleeName="describe"
// CHECK-NEXT: v7 = PropGet v3 key="length"
// CHECK-NEXT: v8 = NewArray v6, v7 contents=anything
// CHECK-NEXT: AppendSpread v8, v3
// CHECK-NEXT: Return v8
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="steps"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsGenerator, HasThis, TakesCallee, HasExplicitName] length=2 thisType={type=anything} parameters=[{type=anything}, {type=anything}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: anything, v1: function, v2: anything, v3: anything):
// CHECK-NEXT: InitialYield v2, v3
// CHECK-NEXT: v5 = GetModuleVariable variable=[[g_2]]
// CHECK-NEXT: v6 = CheckInitialized v5 name="describe"
// CHECK-NEXT: v7 = Call v6, -, v0 calleeName="describe"
// CHECK-NEXT: v8 = Yield v7, v2, v3
// CHECK-NEXT: v9 = ResultAt v8
// CHECK-NEXT: v10 = ResultAt v8 index=1
// CHECK-NEXT: Switch v10 cases=[1, 2] -> case b1(), case b2(), otherwise b3()
// CHECK-NEXT: b1():
// CHECK-NEXT: Throw v9
// CHECK-NEXT: b2():
// CHECK-NEXT: Return v9
// CHECK-NEXT: b3():
// CHECK-NEXT: v11 = Yield v2, v2, v3
// CHECK-NEXT: v12 = ResultAt v11
// CHECK-NEXT: v13 = ResultAt v11 index=1
// CHECK-NEXT: Switch v13 cases=[1, 2] -> case b4(), case b5(), otherwise b6()
// CHECK-NEXT: b4():
// CHECK-NEXT: Throw v12
// CHECK-NEXT: b5():
// CHECK-NEXT: Return v12
// CHECK-NEXT: b6():
// CHECK-NEXT: v14 = Yield v3, v2, v3
// CHECK-NEXT: v15 = ResultAt v14
// CHECK-NEXT: v16 = ResultAt v14 index=1
// CHECK-NEXT: Switch v16 cases=[1, 2] -> case b7(), case b8(), otherwise b9()
// CHECK-NEXT: b7():
// CHECK-NEXT: Throw v15
// CHECK-NEXT: b8():
// CHECK-NEXT: Return v15
// CHECK-NEXT: b9():
// CHECK-NEXT: v17 = Undefined
// CHECK-NEXT: Return v17
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="Base"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=BaseConstructor flags=[HasNewTarget, HasExplicitName] thisType={type=anything} results=[{type=object flags=[IsFromCompiler]}] functionTypes={{*}}[[f_3]]] {
// CHECK-NEXT: b0(v0: anything):
// CHECK-NEXT: v1 = GetConstructPrototype v0 layout=[[L_4]]
// CHECK-NEXT: v2 = NewObject v1 layout=[[L_4]]
// CHECK-NEXT: v3 = Convert v2 declared={type=[[L_4]]}
// CHECK-NEXT: v4 = Boolean boolean=true
// CHECK-NEXT: PropSet v3, v4 key="made"
// CHECK-NEXT: v6 = Undefined
// CHECK-NEXT: v7 = TypeTest v6 testedType=object
// CHECK-NEXT: Branch v7 -> taken b1(| 0), notTaken b2(v3)
// CHECK-NEXT: b1(v8):
// CHECK-NEXT: Jump -> next b2(v8)
// CHECK-NEXT: b2(v9):
// CHECK-NEXT: Return v9
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="spreadMany"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Arrow length=1 thisType={type=anything} parameters=[{type=anything}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: anything):
// CHECK-NEXT: v1 = PropGet v0 key="call"
// CHECK-NEXT: v2 = String string="T"
// CHECK-NEXT: v3 = NewArray v2 contents=anything
// CHECK-NEXT: v4 = Builtin builtin=ArrayFrom
// CHECK-NEXT: v5 = Integer integer=40
// CHECK-NEXT: v6 = Undefined
// CHECK-NEXT: v7 = NewClosure function=[[f_5]]
// CHECK-NEXT: v8 = Builtin builtin=CompilerHelpersArrayFromLength [isNotReadFromHolder]
// CHECK-NEXT: v9 = Call v8, -, v5, v7
// CHECK-NEXT: AppendSpread v3, v9
// CHECK-NEXT: v11 = CallList v1, v0, v3 calleeKey="call" calleeName="f.call"
// CHECK-NEXT: ReturnCall v11
// CHECK-NEXT: }
