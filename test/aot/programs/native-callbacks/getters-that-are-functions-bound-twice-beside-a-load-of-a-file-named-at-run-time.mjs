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
