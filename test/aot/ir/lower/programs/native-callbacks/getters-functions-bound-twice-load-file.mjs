// RUN: lower
// OPTIONS: builtin-modules

// Every read that a built-in makes of a property on its own x a getter that is a function bound twice: what the getter throws arrives at whoever asked. Each case has its own object, getter and reader.
// Beside them: a method of Array.prototype on an object with getters, and a load of a file that is named at run time.
let ran = 0;
process.on('unhandledRejection', () => {});
function rc133(o) { return "x" in new Proxy({}, o); }
function c133() { const o = {}; Object.defineProperty(o, "has", { get: function () { ran++; throw new RangeError('thrown'); }.bind().bind(), configurable: true }); return rc133(o); }
function rc134(o) { return Object.keys(new Proxy({}, o)).length; }
function c134() { const o = {}; Object.defineProperty(o, "ownKeys", { get: function () { ran++; throw new RangeError('thrown'); }.bind().bind(), configurable: true }); return rc134(o); }
function rc135(o) { return new Proxy(function () {}, o)(); }
function c135() { const o = {}; Object.defineProperty(o, "apply", { get: function () { ran++; throw new RangeError('thrown'); }.bind().bind(), configurable: true }); return rc135(o); }
function rc136(o) { return typeof Object.getPrototypeOf(new Proxy({}, o)); }
function c136() { const o = {}; Object.defineProperty(o, "getPrototypeOf", { get: function () { ran++; throw new RangeError('thrown'); }.bind().bind(), configurable: true }); return rc136(o); }
function rc137(o) { return typeof Reflect.construct(function () {}, [], o); }
function c137() { const o = (function () {}).bind(); Object.defineProperty(o, "prototype", { get: function () { ran++; throw new RangeError('thrown'); }.bind().bind(), configurable: true }); return rc137(o); }
function rc138(o) { return typeof Reflect.construct(Map, [], o); }
function c138() { const o = (function () {}).bind(); Object.defineProperty(o, "prototype", { get: function () { ran++; throw new RangeError('thrown'); }.bind().bind(), configurable: true }); return rc138(o); }
function rc139(o) { return typeof Reflect.construct(Array, [], o); }
function c139() { const o = (function () {}).bind(); Object.defineProperty(o, "prototype", { get: function () { ran++; throw new RangeError('thrown'); }.bind().bind(), configurable: true }); return rc139(o); }
function rc140(o) { return typeof Reflect.construct(Error, [], o); }
function c140() { const o = (function () {}).bind(); Object.defineProperty(o, "prototype", { get: function () { ran++; throw new RangeError('thrown'); }.bind().bind(), configurable: true }); return rc140(o); }
function rc141(o) { return typeof Reflect.construct(Promise, [() => {}], o); }
function c141() { const o = (function () {}).bind(); Object.defineProperty(o, "prototype", { get: function () { ran++; throw new RangeError('thrown'); }.bind().bind(), configurable: true }); return rc141(o); }
function rc142(o) { return String.raw(o); }
function c142() { const o = {}; Object.defineProperty(o, "raw", { get: function () { ran++; throw new RangeError('thrown'); }.bind().bind(), configurable: true }); return rc142(o); }
function rc143(o) { return String.raw({ raw: o }); }
function c143() { const o = {}; Object.defineProperty(o, "length", { get: function () { ran++; throw new RangeError('thrown'); }.bind().bind(), configurable: true }); return rc143(o); }
function rc144(o) { return typeof new Intl.NumberFormat("en", o); }
function c144() { const o = {}; Object.defineProperty(o, "style", { get: function () { ran++; throw new RangeError('thrown'); }.bind().bind(), configurable: true }); return rc144(o); }
function rc145(o) { return "a".localeCompare("b", "en", o); }
function c145() { const o = {}; Object.defineProperty(o, "sensitivity", { get: function () { ran++; throw new RangeError('thrown'); }.bind().bind(), configurable: true }); return rc145(o); }
function rc146(o) { return (1).toLocaleString("en", o); }
function c146() { const o = {}; Object.defineProperty(o, "style", { get: function () { ran++; throw new RangeError('thrown'); }.bind().bind(), configurable: true }); return rc146(o); }
function rc147(o) { return typeof new Response("", o); }
function c147() { const o = {}; Object.defineProperty(o, "status", { get: function () { ran++; throw new RangeError('thrown'); }.bind().bind(), configurable: true }); return rc147(o); }
function rc148(o) { return typeof new Request("http://a/", o); }
function c148() { const o = {}; Object.defineProperty(o, "headers", { get: function () { ran++; throw new RangeError('thrown'); }.bind().bind(), configurable: true }); return rc148(o); }
function rc149(o) { return typeof new TextDecoder("utf-8", o); }
function c149() { const o = {}; Object.defineProperty(o, "fatal", { get: function () { ran++; throw new RangeError('thrown'); }.bind().bind(), configurable: true }); return rc149(o); }
function rc150(o) { return typeof new CustomEvent("e", o); }
function c150() { const o = {}; Object.defineProperty(o, "detail", { get: function () { ran++; throw new RangeError('thrown'); }.bind().bind(), configurable: true }); return rc150(o); }
function rc151(o) { return (new EventTarget().addEventListener("e", () => {}, o), "added"); }
function c151() { const o = {}; Object.defineProperty(o, "once", { get: function () { ran++; throw new RangeError('thrown'); }.bind().bind(), configurable: true }); return rc151(o); }
function rc152(o) { return new ArrayBuffer(1, o).byteLength; }
function c152() { const o = {}; Object.defineProperty(o, "maxByteLength", { get: function () { ran++; throw new RangeError('thrown'); }.bind().bind(), configurable: true }); return rc152(o); }
function rc153(o) { return typeof new Request("http://a/", o); }
function c153() { const o = {}; Object.defineProperty(o, "signal", { get: function () { ran++; throw new RangeError('thrown'); }.bind().bind(), configurable: true }); return rc153(o); }
function rc154(o) { return 1; }
function c154() { const o = Object.create(Set.prototype); Object.defineProperty(o, "add", { get: function () { ran++; throw new RangeError('thrown'); }.bind().bind(), configurable: true }); return rc154(o); }
function rc155(o) { return new Set([1]).isSubsetOf(o); }
function c155() { const o = { size: 1 }; Object.defineProperty(o, "has", { get: function () { ran++; throw new RangeError('thrown'); }.bind().bind(), configurable: true }); return rc155(o); }
function rc156(o) { return new Set([1]).union(o).size; }
function c156() { const o = { size: 1, has() { return true; } }; Object.defineProperty(o, "keys", { get: function () { ran++; throw new RangeError('thrown'); }.bind().bind(), configurable: true }); return rc156(o); }
function rc157(o) { return o.description; }
function c157() { const o = Object(Symbol('s')); Object.defineProperty(o, "description", { get: function () { ran++; throw new RangeError('thrown'); }.bind().bind(), configurable: true }); return rc157(o); }
function rc158(o) { return 1; }
function c158() { const o = {}; Object.defineProperty(o, Symbol.unscopables, { get: function () { ran++; throw new RangeError('thrown'); }.bind().bind(), configurable: true }); return rc158(o); }
function rc159(o) { return o.k; }
function c159() { const o = {}; Object.defineProperty(o, "k", { get: function () { ran++; throw new RangeError('thrown'); }.bind().bind(), configurable: true }); return rc159(o); }
function rc160(o) { return o["k".trim()]; }
function c160() { const o = {}; Object.defineProperty(o, "k", { get: function () { ran++; throw new RangeError('thrown'); }.bind().bind(), configurable: true }); return rc160(o); }
function rc161(o) { return Reflect.get(o, "k"); }
function c161() { const o = {}; Object.defineProperty(o, "k", { get: function () { ran++; throw new RangeError('thrown'); }.bind().bind(), configurable: true }); return rc161(o); }
function rc162(o) { return Object.create(o).k; }
function c162() { const o = {}; Object.defineProperty(o, "k", { get: function () { ran++; throw new RangeError('thrown'); }.bind().bind(), configurable: true }); return rc162(o); }
function rc163(o) { return o?.k; }
function c163() { const o = {}; Object.defineProperty(o, "k", { get: function () { ran++; throw new RangeError('thrown'); }.bind().bind(), configurable: true }); return rc163(o); }
function rc164(o) { return (({ k }) => k)(o); }
function c164() { const o = {}; Object.defineProperty(o, "k", { get: function () { ran++; throw new RangeError('thrown'); }.bind().bind(), configurable: true }); return rc164(o); }
function rc165(o) { return o.k(); }
function c165() { const o = {}; Object.defineProperty(o, "k", { get: function () { ran++; throw new RangeError('thrown'); }.bind().bind(), configurable: true }); return rc165(o); }
function rc166(o) { return typeof o.k; }
function c166() { const o = {}; Object.defineProperty(o, "k", { get: function () { ran++; throw new RangeError('thrown'); }.bind().bind(), configurable: true }); return rc166(o); }
function rc167(o) { return delete o.k; }
function c167() { const o = {}; Object.defineProperty(o, "k", { get: function () { ran++; throw new RangeError('thrown'); }.bind().bind(), configurable: true }); return rc167(o); }
function rc168(o) { return "k" in o; }
function c168() { const o = {}; Object.defineProperty(o, "k", { get: function () { ran++; throw new RangeError('thrown'); }.bind().bind(), configurable: true }); return rc168(o); }
function rc169(o) { return typeof Object.getOwnPropertyDescriptor(o, "k").get; }
function c169() { const o = {}; Object.defineProperty(o, "k", { get: function () { ran++; throw new RangeError('thrown'); }.bind().bind(), configurable: true }); return rc169(o); }
async function rc170(o) { return await Promise.resolve(o); }
async function c170() { const o = {}; Object.defineProperty(o, "then", { get: function () { ran++; throw new RangeError('thrown'); }.bind().bind(), configurable: true }); return await rc170(o); }
async function rc171(o) { return await o; }
async function c171() { const o = {}; Object.defineProperty(o, "then", { get: function () { ran++; throw new RangeError('thrown'); }.bind().bind(), configurable: true }); return await rc171(o); }
async function rc172(o) { return await (async () => o)(); }
async function c172() { const o = {}; Object.defineProperty(o, "then", { get: function () { ran++; throw new RangeError('thrown'); }.bind().bind(), configurable: true }); return await rc172(o); }
async function rc173(o) { return await new Promise(r => r(o)); }
async function c173() { const o = {}; Object.defineProperty(o, "then", { get: function () { ran++; throw new RangeError('thrown'); }.bind().bind(), configurable: true }); return await rc173(o); }
async function rc174(o) { return (await Promise.all([o])).length; }
async function c174() { const o = {}; Object.defineProperty(o, "then", { get: function () { ran++; throw new RangeError('thrown'); }.bind().bind(), configurable: true }); return await rc174(o); }
async function rc175(o) { return await Promise.resolve(1).then(() => o); }
async function c175() { const o = {}; Object.defineProperty(o, "then", { get: function () { ran++; throw new RangeError('thrown'); }.bind().bind(), configurable: true }); return await rc175(o); }
async function rc176(o) { return (await Promise.allSettled([o]))[0].status; }
async function c176() { const o = {}; Object.defineProperty(o, "then", { get: function () { ran++; throw new RangeError('thrown'); }.bind().bind(), configurable: true }); return await rc176(o); }
async function rc177(o) { return await Promise.race([o]); }
async function c177() { const o = {}; Object.defineProperty(o, "then", { get: function () { ran++; throw new RangeError('thrown'); }.bind().bind(), configurable: true }); return await rc177(o); }
async function rc178(o) { return await (async () => { for await (const x of o) return x; })(); }
async function c178() { const o = {}; Object.defineProperty(o, Symbol.asyncIterator, { get: function () { ran++; throw new RangeError('thrown'); }.bind().bind(), configurable: true }); return await rc178(o); }
async function rc179(o) { return await (async () => { for await (const x of o) return x; })(); }
async function c179() { const o = {}; Object.defineProperty(o, Symbol.iterator, { get: function () { ran++; throw new RangeError('thrown'); }.bind().bind(), configurable: true }); return await rc179(o); }
async function rc180(o) { return (await Promise.all(o)).length; }
async function c180() { const o = {}; Object.defineProperty(o, Symbol.iterator, { get: function () { ran++; throw new RangeError('thrown'); }.bind().bind(), configurable: true }); return await rc180(o); }
async function rc181(o) { return await Promise.race(o); }
async function c181() { const o = {}; Object.defineProperty(o, Symbol.iterator, { get: function () { ran++; throw new RangeError('thrown'); }.bind().bind(), configurable: true }); return await rc181(o); }
async function rc182(o) { return (await Array.fromAsync(o)).length; }
async function c182() { const o = {}; Object.defineProperty(o, Symbol.asyncIterator, { get: function () { ran++; throw new RangeError('thrown'); }.bind().bind(), configurable: true }); return await rc182(o); }
async function rc183(o) { return await (p => (p.constructor = o, p.then()))(Promise.resolve(1)); }
async function c183() { const o = {}; Object.defineProperty(o, Symbol.species, { get: function () { ran++; throw new RangeError('thrown'); }.bind().bind(), configurable: true }); return await rc183(o); }
async function rc184(o) { return await o; }
async function c184() { const o = Promise.resolve(1); Object.defineProperty(o, "constructor", { get: function () { ran++; throw new RangeError('thrown'); }.bind().bind(), configurable: true }); return await rc184(o); }
const cases = [["handler has", c133], ["handler ownKeys", c134], ["handler apply", c135], ["handler getPrototypeOf", c136], ["newTarget prototype", c137], ["newTarget prototype Map", c138], ["newTarget prototype Array", c139], ["newTarget prototype Error", c140], ["newTarget prototype Promise", c141], ["raw", c142], ["raw length", c143], ["options style", c144], ["options localeCompare", c145], ["options toLocaleString", c146], ["options status", c147], ["options headers", c148], ["options fatal", c149], ["options detail", c150], ["options once", c151], ["options maxByteLength", c152], ["options signal", c153], ["adder", c154], ["set has", c155], ["set keys", c156], ["description", c157], ["with", c158], ["named", c159], ["keyed", c160], ["Reflect.get", c161], ["inherited", c162], ["optional", c163], ["pattern", c164], ["call", c165], ["typeof", c166], ["delete-no-read", c167], ["has-no-read", c168], ["descriptor-no-read", c169], ["then resolve", c170], ["then await", c171], ["then return", c172], ["then resolver", c173], ["then all", c174], ["then chain", c175], ["then allSettled", c176], ["then race", c177], ["asyncIterator", c178], ["iterator for-await", c179], ["iterator all", c180], ["iterator race", c181], ["iterator fromAsync", c182], ["species await then", c183], ["constructor await", c184]];
const only = process.argv[2];
if (process.env.A_FILE_NAMED_AT_RUN_TIME) await import(process.env.A_FILE_NAMED_AT_RUN_TIME);
for (let i = 0; i < cases.length; i++) {
  if (only !== undefined && Number(only) !== i) continue;
  let said; const before = ran;
  try { said = String(await cases[i][1]()); } catch (e) { said = "throws " + (e && e.name); }
  console.log(i + " " + cases[i][0] + ": " + said.slice(0, 60) + " | the getter ran " + (ran - before));
}
let getterCalls = 0;
class Item {
  constructor(size) {
    this.size = size;
  }
  double() {
    return this.size * 2;
  }
}
const item = new Item(1.5);
const probe = {
  count: 0,
  work: Array.prototype.toSpliced,
  get length() {
    getterCalls++;
    this.count++;
    console.log("length");
    return 3;
  },
  get 0() {
    getterCalls++;
    this.count++;
    console.log("element 0");
    return 1.5;
  },
  get 1() {
    getterCalls++;
    this.count++;
    console.log("element 1");
    return item;
  },
  get 2() {
    getterCalls++;
    this.count++;
    console.log("element 2");
    return "two";
  },
};
const result = probe.work(1, 2, 3.5, "x");
console.log(Array.isArray(result), result.length, typeof result[0], result[0] + 1);
console.log(typeof result[1], result[1] + 1, typeof result[2], result[2].length, result[2]);
console.log(typeof probe, Object.keys(probe).join(), typeof probe[0], probe[0] + 1, probe[1].double());
console.log(typeof probe[2], probe[2].length, probe[2], typeof probe.count, probe.count + 1);
console.log(getterCalls, probe.count);

// GENERATED: rc138 rc144 rc150 rc182 c154
// CHECK-LABEL: function {{*}}name="rc138"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[HasExplicitName] length=1 thisType={type=anything} parameters=[{type=undefined|null|[[f_1]] flags=[IsExpected]}] results=[{type=undefined|null|"bigint"|"boolean"|"function"|"number"|"object"|"string"|"symbol"|"undefined" flags=[IsExpected]}] {
// CHECK-NEXT: b0(v0: undefined|null|[[f_1]]):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = Builtin builtin=Reflect
// CHECK-NEXT: v2 = Builtin builtin=ReflectConstruct
// CHECK-NEXT: v3 = Builtin builtin=Map
// CHECK-NEXT: v4 = Data data=[[d_2]]
// CHECK-NEXT: v5 = Convert v4 declared={type=undefined|null|Array<never> flags=[IsExpected]}
// CHECK-NEXT: v6 = Call v2, v1, v3, v5, v0 calleeName="Reflect.construct" [isDoneInPlace]
// CHECK-NEXT: v7 = Convert v6 declared={type=undefined|null|Map flags=[IsExpected]}
// CHECK-NEXT: v8 = TypeOf v7
// CHECK-NEXT: v9 = Convert v8 declared={type=undefined|null|"bigint"|"boolean"|"function"|"number"|"object"|"string"|"symbol"|"undefined" flags=[IsExpected]}
// CHECK-NEXT: Return v9
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="rc144"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[HasExplicitName] length=1 thisType={type=anything} parameters=[{type=undefined|null|number|string|symbol|bigint|[[L_3]] flags=[IsExpected]}] results=[{type=undefined|null|"bigint"|"boolean"|"function"|"number"|"object"|"string"|"symbol"|"undefined" flags=[IsExpected]}] {
// CHECK-NEXT: b0(v0: undefined|null|number|string|symbol|bigint|[[L_3]]):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = Builtin builtin=GlobalThis
// CHECK-NEXT: v2 = PropGet v1 key="Intl" [isFreeName]
// CHECK-NEXT: v3 = Convert v2 declared={type=builtin(Intl) flags=[IsExpected]}
// CHECK-NEXT: v4 = PropGet v3 key="NumberFormat"
// CHECK-NEXT: v5 = Convert v4 declared={type=builtin(IntlNumberFormat) flags=[IsExpected]}
// CHECK-NEXT: v6 = String string="en"
// CHECK-NEXT: v7 = Construct v5, -, v6, v0 calleeName="Intl.NumberFormat"
// CHECK-NEXT: v8 = Convert v7 declared={type=undefined|null|IntlNumberFormat flags=[IsExpected]}
// CHECK-NEXT: v9 = TypeOf v8
// CHECK-NEXT: v10 = Convert v9 declared={type=undefined|null|"bigint"|"boolean"|"function"|"number"|"object"|"string"|"symbol"|"undefined" flags=[IsExpected]}
// CHECK-NEXT: Return v10
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="rc150"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[HasExplicitName] length=1 thisType={type=anything} parameters=[{type=undefined|null|number|string|symbol|bigint|[[L_4]] flags=[IsExpected]}] results=[{type=undefined|null|"bigint"|"boolean"|"function"|"number"|"object"|"string"|"symbol"|"undefined" flags=[IsExpected]}] {
// CHECK-NEXT: b0(v0: undefined|null|number|string|symbol|bigint|[[L_4]]):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = Builtin builtin=GlobalThis
// CHECK-NEXT: v2 = PropGet v1 key="CustomEvent" [isFreeName]
// CHECK-NEXT: v3 = Convert v2 declared={type=builtin(CustomEvent) flags=[IsExpected]}
// CHECK-NEXT: v4 = String string="e"
// CHECK-NEXT: v5 = Construct v3, -, v4, v0 calleeName="CustomEvent"
// CHECK-NEXT: v6 = Convert v5 declared={type=undefined|null|[[L_5]]|Event flags=[IsExpected]}
// CHECK-NEXT: v7 = TypeOf v6
// CHECK-NEXT: v8 = Convert v7 declared={type=undefined|null|"bigint"|"boolean"|"function"|"number"|"object"|"string"|"symbol"|"undefined" flags=[IsExpected]}
// CHECK-NEXT: Return v8
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="rc182"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsAsync, HasThis, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=undefined|null|string|Array|AsyncGenerator flags=[IsExpected]}] results=[{type=undefined|null|Promise<number> flags=[IsExpected]}] {
// CHECK-NEXT: b0(v0: anything, v1: undefined|null|string|Array|AsyncGenerator):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v2 = Builtin builtin=Array
// CHECK-NEXT: v3 = Builtin builtin=ArrayFromAsync
// CHECK-NEXT: v4 = Call v3, v2, v1 calleeName="Array.fromAsync"
// CHECK-NEXT: v5 = Convert v4 declared={type=undefined|null|Promise<undefined|null|Array> flags=[IsExpected]}
// CHECK-NEXT: v6 = Await v5, v1
// CHECK-NEXT: v7 = Convert v6 declared={type=undefined|null|Array flags=[IsExpected]}
// CHECK-NEXT: v8 = PropGet v7 key="length"
// CHECK-NEXT: v9 = Convert v8 declared={type=number flags=[IsExpected]}
// CHECK-NEXT: v10 = Convert v9 declared={type=number|object flags=[IsExpected]}
// CHECK-NEXT: Return v10
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="c154"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[HasExplicitName] thisType={type=anything} results=[{type=number flags=[IsExpected]}] functionTypes={{*}}[[f_6]]] {
// CHECK-NEXT: b0():
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v0 = Builtin builtin=Object
// CHECK-NEXT: v1 = Builtin builtin=ObjectCreate
// CHECK-NEXT: v2 = Builtin builtin=SetPrototype
// CHECK-NEXT: v3 = Call v1, v0, v2 calleeName="Object.create"
// CHECK-NEXT: v4 = Builtin builtin=Object
// CHECK-NEXT: v5 = Builtin builtin=ObjectDefineProperty
// CHECK-NEXT: v6 = String string="add"
// CHECK-NEXT: v7 = NewClosure function=[[f_7]]
// CHECK-NEXT: v8 = PropGet v7 key="bind"
// CHECK-NEXT: v9 = Convert v8 declared={type=undefined|null|[[f_8]] flags=[IsExpected]}
// CHECK-NEXT: v10 = Call v9, v7 calleeKey="bind" calleeName="bind"
// CHECK-NEXT: v11 = Convert v10 declared={type=undefined|null|[[f_9]] flags=[IsExpected]}
// CHECK-NEXT: v12 = PropGet v11 key="bind"
// CHECK-NEXT: v13 = Convert v12 declared={type=undefined|null|[[f_8]] flags=[IsExpected]}
// CHECK-NEXT: v14 = Call v13, v11 calleeKey="bind" calleeName="bind"
// CHECK-NEXT: v15 = Convert v14 declared={type=undefined|null|[[f_9]] flags=[IsExpected]}
// CHECK-NEXT: v16 = Convert v15 declared={type=undefined|null|[[f_10]] flags=[IsExpected]}
// CHECK-NEXT: v17 = NewObject layout=[[L_11]]
// CHECK-NEXT: PropDefine v17, v16 key="get"
// CHECK-NEXT: v19 = Boolean boolean=true
// CHECK-NEXT: v20 = Convert v19 declared={type=undefined|boolean flags=[IsExpected]}
// CHECK-NEXT: PropDefine v17, v20 key="configurable"
// CHECK-NEXT: v22 = FinishObject v17
// CHECK-NEXT: v23 = Call v5, v4, v3, v6, v22 calleeName="Object.defineProperty"
// CHECK-NEXT: v24 = GetModuleVariable variable=[[g_12]]
// CHECK-NEXT: v25 = Call v24, -, v3 calleeName="rc154"
// CHECK-NEXT: ReturnCall v25 casts=[{declared={type=number flags=[IsExpected]}}]
// CHECK-NEXT: }
