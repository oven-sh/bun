// RUN: lower
// OPTIONS: builtin-modules

// Object.hasOwn(proxy, "name") and hasOwnProperty.call(proxy, "name") call the getOwnPropertyDescriptor trap with the target and the name. What it answers is held against the target: a descriptor always, that there is none where the target is closed or the property cannot be configured.
const log = [];
const told = work => { try { return work(); } catch (error) { return error.constructor.name + ": " + error.message.slice(0, 50); } };
const shown = value => JSON.stringify(value, (key, held) => held === undefined ? "undefined" : typeof held === "function" ? "function" : typeof held === "symbol" ? String(held) : held);
function say(label, value) { console.log(label + ": " + shown(value) + (log.length ? " | " + log.splice(0).join(" ") : "")); }
const has = Object.prototype.hasOwnProperty;
for (let round = 0; round < 3; round++) {
  {
    const honest = new Proxy({ alpha: 1, beta: undefined }, { getOwnPropertyDescriptor(target, key) { log.push("asked " + String(key) + " " + (this === undefined ? "nobody" : Object.keys(this).length) + " " + arguments.length); return Reflect.getOwnPropertyDescriptor(target, key); } });
    say("an honest trap", [Object.hasOwn(honest, "alpha"), Object.hasOwn(honest, "beta"), Object.hasOwn(honest, "gamma"), has.call(honest, "alpha"), has.call(honest, "gamma"), honest.hasOwnProperty("alpha"), Object.hasOwn(honest, "toString")]);
  }
  {
    const none = new Proxy({ alpha: 1 }, {});
    say("no trap", [Object.hasOwn(none, "alpha"), Object.hasOwn(none, "gamma"), has.call(none, "alpha"), has.call(none, "gamma")]);
  }
  {
    const handler = { getOwnPropertyDescriptor: undefined }, later = new Proxy({ alpha: 1 }, handler);
    const first = [Object.hasOwn(later, "alpha"), Object.hasOwn(later, "gamma")];
    handler.getOwnPropertyDescriptor = () => ({ value: 9, configurable: true });
    const second = [Object.hasOwn(later, "alpha"), Object.hasOwn(later, "gamma")];
    handler.getOwnPropertyDescriptor = null;
    const third = [Object.hasOwn(later, "alpha"), Object.hasOwn(later, "gamma")];
    handler.getOwnPropertyDescriptor = 5;
    say("a trap that comes, goes and is no function", [first, second, third, told(() => Object.hasOwn(later, "alpha")), told(() => has.call(later, "gamma"))]);
  }
  {
    const hides = new Proxy({ alpha: 1 }, { getOwnPropertyDescriptor() { } });
    const invents = new Proxy({ alpha: 1 }, { getOwnPropertyDescriptor() { return { value: 2, writable: true, enumerable: true, configurable: true }; } });
    say("what is there is hidden, what is not is made up", [Object.hasOwn(hides, "alpha"), Object.hasOwn(hides, "gamma"), Object.hasOwn(invents, "alpha"), Object.hasOwn(invents, "gamma")]);
  }
  for (const [label, close] of [["closed", Object.preventExtensions], ["sealed", Object.seal], ["frozen", Object.freeze], ["one fixed", made => Object.defineProperty(made, "alpha", { configurable: false })]]) {
    const hides = new Proxy(close({ alpha: 1 }), { getOwnPropertyDescriptor() { } });
    const invents = new Proxy(close({ alpha: 1 }), { getOwnPropertyDescriptor() { return { value: 1, writable: true, enumerable: true, configurable: true }; } });
    const honest = new Proxy(close({ alpha: 1 }), { getOwnPropertyDescriptor(target, key) { return Reflect.getOwnPropertyDescriptor(target, key); } });
    say(label, [told(() => Object.hasOwn(hides, "alpha")), told(() => Object.hasOwn(hides, "gamma")), told(() => Object.hasOwn(invents, "alpha")), told(() => Object.hasOwn(invents, "gamma")), told(() => Object.hasOwn(honest, "alpha")), told(() => Object.hasOwn(honest, "gamma"))]);
  }
  {
    const answers = [5, null, "text", true, Symbol("s"), [], () => { }, {}, { value: 1 }, { configurable: false }, { get: 5 }, { get() { }, value: 1 }, { get configurable() { log.push("read configurable"); return true; } }, new Proxy({ configurable: true }, { get(target, key) { log.push("get " + String(key)); return target[key]; }, has(target, key) { log.push("has " + String(key)); return key in target; } })];
    say("what a trap may answer", answers.map(answer => told(() => { const made = new Proxy({ alpha: 1 }, { getOwnPropertyDescriptor() { return answer; } }); return [Object.hasOwn(made, "alpha"), Object.hasOwn(made, "gamma")]; })));
  }
  {
    const closes = new Proxy({ alpha: 1 }, { getOwnPropertyDescriptor(target) { Object.preventExtensions(target); } });
    const throws = new Proxy({ alpha: 1 }, { getOwnPropertyDescriptor() { throw new RangeError("from the trap"); } });
    const deletes = new Proxy({ alpha: 1 }, { getOwnPropertyDescriptor(target, key) { const found = Reflect.getOwnPropertyDescriptor(target, key); delete target[key]; return found; } });
    say("a trap that closes the target, throws, deletes", [told(() => Object.hasOwn(closes, "alpha")), told(() => Object.hasOwn(throws, "alpha")), told(() => [Object.hasOwn(deletes, "alpha"), Object.hasOwn(deletes, "alpha")])]);
  }
  {
    const made = Proxy.revocable({ alpha: 1 }, { getOwnPropertyDescriptor() { log.push("never"); } });
    made.revoke();
    const inner = new Proxy({ alpha: 1 }, { getOwnPropertyDescriptor(target, key) { log.push("inner " + key); return Reflect.getOwnPropertyDescriptor(target, key); } });
    const outer = new Proxy(inner, { getOwnPropertyDescriptor(target, key) { log.push("outer " + key); return Reflect.getOwnPropertyDescriptor(target, key); } });
    say("revoked, and a proxy of a proxy", [told(() => Object.hasOwn(made.proxy, "alpha")), told(() => has.call(made.proxy, "alpha")), Object.hasOwn(outer, "alpha"), Object.hasOwn(outer, "gamma")]);
  }
  {
    class Handler { asked = 0; getOwnPropertyDescriptor(target, key) { this.asked++; return Reflect.getOwnPropertyDescriptor(target, key); } }
    const handler = new Handler, ofClass = new Proxy(new class { alpha = 1; #hidden = 2; }, handler), ofList = new Proxy([1, 2], handler), ofFunction = new Proxy(function named() { }, handler);
    say("a handler of a class, and other targets", [Object.hasOwn(ofClass, "alpha"), Object.hasOwn(ofClass, "hidden"), Object.hasOwn(ofList, "length"), Object.hasOwn(ofList, "0"), Object.hasOwn(ofList, "2"), Object.hasOwn(ofFunction, "name"), Object.hasOwn(ofFunction, "prototype"), Object.hasOwn(ofFunction, "call"), handler.asked]);
  }
}
let asked = 0, found = 0;
const often = new Proxy({ alpha: 1 }, { getOwnPropertyDescriptor(target, key) { asked++; return Reflect.getOwnPropertyDescriptor(target, key); } });
for (let i = 0; i < 60000; i++) { if (Object.hasOwn(often, "alpha")) found++; if (has.call(often, "beta")) found++; }
console.log(found, asked);

// GENERATED: told shown configurable has Handler named
// CHECK-LABEL: function {{*}}name="told"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Arrow length=1 thisType={type=anything} parameters=[{type=undefined|null|function flags=[IsExpected]}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: undefined|null|function):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1() handler=b2():
// CHECK-NEXT: v1 = Call v0 calleeName="work"
// CHECK-NEXT: Return v1
// CHECK-NEXT: b2() role=CatchHandler:
// CHECK-NEXT: v2 = CatchValue
// CHECK-NEXT: v3 = PropGet v2 key="constructor"
// CHECK-NEXT: v4 = PropGet v3 key="name"
// CHECK-NEXT: v5 = String string=": "
// CHECK-NEXT: v6 = Add v4, v5
// CHECK-NEXT: v7 = PropGet v2 key="message"
// CHECK-NEXT: v8 = PropGet v7 key="slice"
// CHECK-NEXT: v9 = Integer
// CHECK-NEXT: v10 = Integer integer=50
// CHECK-NEXT: v11 = Call v8, v7, v9, v10 calleeKey="slice" calleeName="error.message.slice"
// CHECK-NEXT: v12 = Add v6, v11
// CHECK-NEXT: Return v12
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="shown"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Arrow length=1 thisType={type=anything} parameters=[{type=undefined|null|Array flags=[IsExpected]}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: undefined|null|Array):
// CHECK-NEXT: v1 = Builtin builtin=JSON
// CHECK-NEXT: v2 = PropGet v1 key="stringify"
// CHECK-NEXT: v3 = Convert v2 declared={type=builtin(JSONStringify) flags=[IsExpected]}
// CHECK-NEXT: v4 = NewClosure function=[[f_1]]
// CHECK-NEXT: v5 = Call v3, v1, v0, v4 calleeKey="stringify" calleeName="JSON.stringify"
// CHECK-NEXT: ReturnCall v5
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="configurable"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Getter flags=[HasExplicitName] thisType={type=anything} results=[{type=anything}] {
// CHECK-NEXT: b0():
// CHECK-NEXT: v0 = GetModuleVariable variable=[[g_2]]
// CHECK-NEXT: v1 = CheckInitialized v0 name="log"
// CHECK-NEXT: v2 = PropGet v1 key="push"
// CHECK-NEXT: v3 = String string="read configurable"
// CHECK-NEXT: v4 = Call v2, v1, v3 calleeKey="push" calleeName="log.push"
// CHECK-NEXT: v5 = Boolean boolean=true
// CHECK-NEXT: Return v5
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="has"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Method flags=[HasExplicitName] length=2 thisType={type=anything} parameters=[{type=undefined|null|[[L_3]] flags=[IsExpected]}, {type=undefined|null|string|symbol flags=[IsExpected]}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: undefined|null|[[L_3]], v1: undefined|null|string|symbol):
// CHECK-NEXT: v2 = GetModuleVariable variable=[[g_2]]
// CHECK-NEXT: v3 = CheckInitialized v2 name="log"
// CHECK-NEXT: v4 = PropGet v3 key="push"
// CHECK-NEXT: v5 = String string="has "
// CHECK-NEXT: v6 = Builtin builtin=String
// CHECK-NEXT: v7 = Call v6, -, v1 calleeName="String"
// CHECK-NEXT: v8 = Add v5, v7
// CHECK-NEXT: v9 = Call v4, v3, v8 calleeKey="push" calleeName="log.push"
// CHECK-NEXT: v10 = ElemHas v0, v1
// CHECK-NEXT: Return v10
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="Handler"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=BaseConstructor flags=[HasNewTarget, HasExplicitName] thisType={type=anything} results=[{type=object flags=[IsFromCompiler]}] {
// CHECK-NEXT: b0(v0: anything):
// CHECK-NEXT: v1 = GetConstructPrototype v0 layout=[[L_4]]
// CHECK-NEXT: v2 = NewObject v1 layout=[[L_4]]
// CHECK-NEXT: v3 = Convert v2 declared={type=[[L_4]]}
// CHECK-NEXT: v4 = CallDirect v3 function=[[f_5]]
// CHECK-NEXT: Return v3
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="named"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[HasExplicitName] thisType={type=anything} results=[{type=anything}] {
// CHECK-NEXT: b0():
// CHECK-NEXT: v0 = Undefined
// CHECK-NEXT: Return v0
// CHECK-NEXT: }
