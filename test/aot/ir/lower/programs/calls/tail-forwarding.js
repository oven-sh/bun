// RUN: lower
// OPTIONS: builtin-modules

const log = [];
function say(...parts) { log.push(parts.map(String).join(" ")); }

function fixed0() { return "fixed0 " + typeof this; }
function fixed2(a, b) { return "fixed2 " + this.tag + " " + a + " " + b; }
function fixed4(a, b, c, d) { return "fixed4 " + this.tag + " " + a + " " + b + " " + c + " " + d; }
function fixed6(a, b, c, d, e, f) { return "fixed6 " + this.tag + " " + [a, b, c, d, e, f].join(","); }
function withDefault(a, b = "default") { return "withDefault " + a + " " + b; }
function rest(first, ...others) { return "rest " + this.tag + " " + first + " [" + others.join(",") + "] " + others.length; }
function usesArguments() { let text = "usesArguments " + arguments.length; for (let i = 0; i < arguments.length; i++) text += " " + arguments[i]; return text; }
function keepsArguments() { return arguments; }
function sloppyThis() { return typeof this; }
function strictThis() { "use strict"; return this === undefined ? "undefined" : typeof this; }
const arrow = (a, b) => "arrow " + a + " " + b;
const bound = fixed2.bind({ tag: "bound" }, "first");
class Klass { constructor() { this.made = true; } }
async function asyncTarget(a, b) { return "async " + a + " " + b; }
function* generatorTarget(a, b) { yield "generator " + a; yield b; }
const proxied = new Proxy(fixed2, { apply(target, thisArg, list) { return "proxied " + list.length + " " + Reflect.apply(target, thisArg, list); } });

let target = fixed2;
function forwardArguments() { return target.apply(this, arguments); }
function forwardNamed(a, b, c) { if (a === "stop") return "stopped"; return target.apply(this, arguments); }
function forwardRest(...all) { return target.apply(this, all); }
function forwardSpread(...all) { return target(...all); }
function forwardSpreadMethod(...all) { return this.method(...all); }
function forwardTail(first, ...others) { return target.apply(this, others); }
function forwardReflect() { return Reflect.apply(target, this, arguments); }
function forwardTwice() { return forwardArguments.apply(this, arguments); }
function forwardNotLast() { const result = target.apply(this, arguments); return "[" + result + "]"; }
function forwardInTry() { try { return target.apply(this, arguments); } catch (error) { return "caught " + error.constructor.name; } }

const receiver = { tag: "receiver", method(...all) { return "method " + this.tag + " " + all.join(","); } };
const lists = [[], [1], [1, 2], [1, 2, 3], [1, 2, 3, 4], [1, 2, 3, 4, 5], [1, 2, 3, 4, 5, 6, 7, 8, 9], [undefined, null], [{ toString() { return "object"; } }, 1.5]];
const targets = { fixed0, fixed2, fixed4, fixed6, withDefault, rest, usesArguments, sloppyThis, strictThis, arrow, bound, proxied, max: Math.max, concat: String.prototype.concat, push: Array.prototype.push };
const forwarders = { forwardArguments, forwardNamed, forwardRest, forwardSpread, forwardTail, forwardReflect, forwardTwice, forwardNotLast, forwardInTry };

for (const [targetName, each] of Object.entries(targets)) {
  target = each;
  for (const [forwarderName, forwarder] of Object.entries(forwarders)) {
    for (const list of lists) {
      let result;
      const self = targetName === "push" ? Object.assign([], { tag: "array" }) : targetName === "concat" ? "text" : receiver;
      try { result = forwarder.call(self, ...list); } catch (error) { result = "threw " + error.constructor.name; }
      say(targetName, forwarderName, list.length, result);
    }
  }
}
for (const list of lists) say("method", forwardSpreadMethod.call(receiver, ...list));

for (const bad of [undefined, null, 1, "text", {}, Klass, Symbol.iterator]) {
  target = bad;
  for (const forwarder of [forwardArguments, forwardRest, forwardSpread, forwardReflect, forwardInTry]) {
    try { say("bad", typeof bad, forwarder.name, forwarder.call(receiver, 1, 2)); } catch (error) { say("bad", typeof bad, forwarder.name, "threw", error.constructor.name); }
  }
}

target = keepsArguments;
const kept = forwardArguments.call(receiver, "a", "b", "c");
fixed6.call(receiver, 9, 9, 9, 9, 9, 9);
say("kept", kept.length, kept[0], kept[1], kept[2], Array.prototype.join.call(kept, "+"));
const keptLong = forwardArguments.call(receiver, 1, 2, 3, 4, 5, 6, 7);
fixed6.call(receiver, 9, 9, 9, 9, 9, 9);
say("kept", keptLong.length, Array.prototype.join.call(keptLong, "+"));

target = generatorTarget;
say("generator", [...forwardArguments.call(receiver, "x", "y")].join(" "));
target = asyncTarget;
forwardArguments.call(receiver, "x", "y").then(value => { say("then", value); console.log(log.join("\n")); });

function countDown(n, total) { if (n === 0) return total; return countDown.apply(this, [n - 1, total + n]); }
say("countDown", countDown(1000, 0));
function pingArguments(n) { if (n === 0) return "ping done"; arguments[0] = n - 1; return pongArguments.apply(this, arguments); }
function pongArguments(n) { "use strict"; if (n === 0) return "pong done"; return pingArguments.apply(this, [n - 1]); }
say("ping", pingArguments(20001));
function forever() { return 1 + forever.apply(this, arguments); }
try { forever(1, 2); } catch (error) { say("forever", error.constructor.name); }

function Emitter() { this.handlers = {}; }
Emitter.prototype.on = function (name, handler) { (this.handlers[name] ||= []).push(handler); return this; };
Emitter.prototype.emit = function emit(name, ...values) {
  const list = this.handlers[name];
  if (list === undefined) return false;
  for (const handler of list) {
    switch (values.length) {
      case 0: handler.call(this); break;
      case 1: handler.call(this, values[0]); break;
      case 2: handler.call(this, values[0], values[1]); break;
      default: handler.apply(this, values);
    }
  }
  return true;
};
function Response() { Emitter.call(this); this.seen = 0; }
Object.setPrototypeOf(Response.prototype, Emitter.prototype);
Response.prototype.emit = function (name) { this.seen++; return Emitter.prototype.emit.apply(this, arguments); };
const response = new Response();
response.on("data", function (...values) { say("data", this.seen, values.length, values.join(",")); });
for (const list of lists.slice(0, 7)) say("emit", response.emit("data", ...list), response.emit("none", ...list));

// GENERATED: Emitter asyncTarget generatorTarget forwardSpread forwardReflect Klass
// CHECK-LABEL: function {{*}}name="Emitter"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[HasThis, HasExplicitName] thisType={type=[[L_1]] flags=[IsExpected]} results=[{type=anything}] {
// CHECK-NEXT: b0(v0: [[L_1]]):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = Convert v0 declared={type=undefined|null|number|string|symbol|bigint|[[L_2]] flags=[IsExpected]}
// CHECK-NEXT: v2 = Data data=[[d_3]]
// CHECK-NEXT: PropSet v1, v2 key="handlers"
// CHECK-NEXT: v4 = Undefined
// CHECK-NEXT: Return v4
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="asyncTarget"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsAsync, HasThis, HasExplicitName] length=2 thisType={type=anything} parameters=[{type=anything}, {type=anything}] results=[{type=undefined|null|Promise<undefined|null|string> flags=[IsExpected]}] functionTypes={{*}}[[f_4]]] {
// CHECK-NEXT: b0(v0: anything, v1: anything, v2: anything):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v3 = String string="async "
// CHECK-NEXT: v4 = Add v3, v1
// CHECK-NEXT: v5 = String string=" "
// CHECK-NEXT: v6 = Add v4, v5
// CHECK-NEXT: v7 = Add v6, v2
// CHECK-NEXT: v8 = Convert v7 declared={type=undefined|null|string|object flags=[IsExpected]}
// CHECK-NEXT: Return v8
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="generatorTarget"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsGenerator, HasThis, TakesCallee, HasExplicitName] length=2 thisType={type=anything} parameters=[{type=anything}, {type=anything}] results=[{type=undefined|null|Generator flags=[IsExpected]}] functionTypes={{*}}[[f_5]]] {
// CHECK-NEXT: b0(v0: anything, v1: function, v2: anything, v3: anything):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: InitialYield v2, v3
// CHECK-NEXT: v5 = String string="generator "
// CHECK-NEXT: v6 = Add v5, v2
// CHECK-NEXT: v7 = Yield v6, v2, v3
// CHECK-NEXT: v8 = ResultAt v7
// CHECK-NEXT: v9 = ResultAt v7 index=1
// CHECK-NEXT: Switch v9 cases=[1, 2] -> case b2(), case b3(), otherwise b4()
// CHECK-NEXT: b2():
// CHECK-NEXT: Throw v8
// CHECK-NEXT: b3():
// CHECK-NEXT: Return v8
// CHECK-NEXT: b4():
// CHECK-NEXT: v10 = Yield v3, v2, v3
// CHECK-NEXT: v11 = ResultAt v10
// CHECK-NEXT: v12 = ResultAt v10 index=1
// CHECK-NEXT: Switch v12 cases=[1, 2] -> case b5(), case b6(), otherwise b7()
// CHECK-NEXT: b5():
// CHECK-NEXT: Throw v11
// CHECK-NEXT: b6():
// CHECK-NEXT: Return v11
// CHECK-NEXT: b7():
// CHECK-NEXT: v13 = Undefined
// CHECK-NEXT: Return v13
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="forwardSpread"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[HasRestParameter, HasExplicitName] thisType={type=anything} parameters=[{type=Array flags=[IsFromCompiler]}] results=[{type=undefined|null|string flags=[IsExpected]}] functionTypes={{*}}[[f_6]]] {
// CHECK-NEXT: b0(v0: Array):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = GetModuleVariable variable=[[g_7]]
// CHECK-NEXT: v2 = CheckInitialized v1 name="target"
// CHECK-NEXT: v3 = NewArray contents=anything
// CHECK-NEXT: AppendSpread v3, v0
// CHECK-NEXT: v5 = CallList v2, -, v3 calleeName="target"
// CHECK-NEXT: ReturnCall v5 casts=[{declared={type=undefined|null|string flags=[IsExpected]}}]
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="forwardReflect"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[HasThis, HasArgumentCount, HasHiddenRest, HasExplicitName] thisType={type=anything} results=[{type=anything}] functionTypes={{*}}[[f_8]]] {
// CHECK-NEXT: b0(v0: anything, v1: int[0, 4294967295], v2: Array):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v3 = CreateUnmappedArguments v1, v2
// CHECK-NEXT: v4 = Builtin builtin=Reflect
// CHECK-NEXT: v5 = Builtin builtin=ReflectApply
// CHECK-NEXT: v6 = GetModuleVariable variable=[[g_7]]
// CHECK-NEXT: v7 = CheckInitialized v6 name="target"
// CHECK-NEXT: v8 = Call v5, v4, v7, v0, v3 calleeName="Reflect.apply"
// CHECK-NEXT: ReturnCall v8
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="Klass"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=BaseConstructor flags=[HasNewTarget, HasExplicitName] thisType={type=anything} results=[{type=object flags=[IsFromCompiler]}] functionTypes={{*}}[[f_9]]] {
// CHECK-NEXT: b0(v0: anything):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = GetConstructPrototype v0 layout=[[L_10]]
// CHECK-NEXT: v2 = NewObject v1 layout=[[L_10]]
// CHECK-NEXT: v3 = Convert v2 declared={type=[[L_10]] flags=[IsFromCompiler]} illTypedCause=FromLooseType
// CHECK-NEXT: v4 = Convert v3 declared={type=undefined|null|[[L_10]] flags=[IsExpected]}
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
