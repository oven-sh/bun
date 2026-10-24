// A new instance of a built-in class with locked prototypes gets another prototype or an own property under the name of a member, and the next read answers as in plain Bun. Each row is a function of its own, so the compiler sees the allocation, the change and the read together.
function headersLink() { const o = new Headers({ a: "1" }); Object.setPrototypeOf(o, null); return typeof o.get; }
function headersOwn() { const o = new Headers({ a: "1" }); Object.defineProperty(o, "get", { value: 1 }); return typeof o.get; }
function headersStore() { const o = new Headers({ a: "1" }); o.get = 1; return typeof o.get; }
function headersProto() { const o = new Headers({ a: "1" }); o.__proto__ = { get: 2 }; return typeof o.get; }
function headersReflect() { const o = new Headers({ a: "1" }); Reflect.setPrototypeOf(o, { get: "x" }); return typeof o.get; }
function urlLink() { const o = new URL("http://a/b"); Object.setPrototypeOf(o, null); return typeof o.pathname + " " + typeof o.toString; }
function urlOwn() { const o = new URL("http://a/b"); Object.defineProperty(o, "pathname", { value: 1 }); return typeof o.pathname; }
function paramsLink() { const o = new URLSearchParams("a=1"); Object.setPrototypeOf(o, null); return typeof o.get; }
function paramsOwn() { const o = new URLSearchParams("a=1"); o.get = 1; return typeof o.get; }
function requestLink() { const o = new Request("http://a/b"); Object.setPrototypeOf(o, null); return typeof o.method + " " + typeof o.json; }
function requestOwn() { const o = new Request("http://a/b"); Object.defineProperty(o, "method", { value: 1 }); return typeof o.method; }
function responseLink() { const o = new Response("a"); Object.setPrototypeOf(o, null); return typeof o.status + " " + typeof o.text; }
function responseOwn() { const o = new Response("a"); Object.defineProperty(o, "status", { value: "s" }); return typeof o.status; }
function blobLink() { const o = new Blob(["a"]); Object.setPrototypeOf(o, null); return typeof o.size + " " + typeof o.text; }
function blobOwn() { const o = new Blob(["a"]); Object.defineProperty(o, "size", { value: "s" }); return typeof o.size; }
function headersIteratorLink() { const o = new Headers({ a: "1" }).entries(); Object.setPrototypeOf(o, null); return typeof o.next; }
function headersIteratorOwn() { const o = new Headers({ a: "1" }).keys(); o.next = 1; return typeof o.next; }
function paramsIteratorLink() { const o = new URLSearchParams("a=1").entries(); Object.setPrototypeOf(o, null); return typeof o.next; }
function paramsIteratorOwn() { const o = new URLSearchParams("a=1").values(); o.next = 1; return typeof o.next; }
function arrayLink() { const o = [1]; Object.setPrototypeOf(o, null); return typeof o.push; }
function arrayOwn() { const o = [1]; o.push = 1; return typeof o.push; }
function arrayIteratorLink() { const o = [1].values(); Object.setPrototypeOf(o, null); return typeof o.next; }
function arrayIteratorOwn() { const o = [1][Symbol.iterator](); o.next = 1; return typeof o.next; }
function mapLink() { const o = new Map(); Object.setPrototypeOf(o, null); return typeof o.get + " " + typeof o.size; }
function mapOwn() { const o = new Map(); o.get = 1; return typeof o.get; }
function mapIteratorLink() { const o = new Map().entries(); Object.setPrototypeOf(o, null); return typeof o.next; }
function mapIteratorOwn() { const o = new Map().keys(); o.next = 1; return typeof o.next; }
function setLink() { const o = new Set(); Object.setPrototypeOf(o, null); return typeof o.has; }
function setIteratorLink() { const o = new Set().values(); Object.setPrototypeOf(o, null); return typeof o.next; }
function setIteratorOwn() { const o = new Set().values(); o.next = 1; return typeof o.next; }
function stringIteratorLink() { const o = "ab"[Symbol.iterator](); Object.setPrototypeOf(o, null); return typeof o.next; }
function stringIteratorOwn() { const o = "ab"[Symbol.iterator](); o.next = 1; return typeof o.next; }
function regExpStringIteratorLink() { const o = "ab".matchAll(/a/g); Object.setPrototypeOf(o, null); return typeof o.next; }
function regExpStringIteratorOwn() { const o = "ab".matchAll(/a/g); o.next = 1; return typeof o.next; }
function iteratorHelperLink() { const o = [1].values().map(x => x); Object.setPrototypeOf(o, null); return typeof o.next; }
function iteratorHelperOwn() { const o = [1].values().filter(x => x); o.next = 1; return typeof o.next; }
function wrapLink() { const o = Iterator.from({ next() { return { done: true } } }); Object.setPrototypeOf(o, null); return typeof o.next; }
function wrapOwn() { const o = Iterator.from({ next() { return { done: true } } }); o.next = 1; return typeof o.next; }
function* numbers() { yield 1; }
async function* later() { yield 1; }
function generatorLink() { const o = numbers(); Object.setPrototypeOf(o, null); return typeof o.next; }
function generatorOwn() { const o = numbers(); o.next = 1; return typeof o.next; }
function asyncGeneratorLink() { const o = later(); Object.setPrototypeOf(o, null); return typeof o.next; }
function asyncGeneratorOwn() { const o = later(); o.next = 1; return typeof o.next; }
function objectLink() { const o = new Object(); Object.setPrototypeOf(o, null); return typeof o.toString; }
function objectOwn() { const o = new Object(); o.toString = 1; return typeof o.toString; }
function literalLink() { const o = { a: 1 }; Object.setPrototypeOf(o, null); return typeof o.hasOwnProperty; }
function promiseLink() { const o = Promise.resolve(1); Object.setPrototypeOf(o, null); return typeof o.then; }
function promiseOwn() { const o = new Promise(() => {}); o.then = 1; return typeof o.then; }
function regExpLink() { const o = /a/; Object.setPrototypeOf(o, null); return typeof o.exec + " " + typeof o.flags; }
function regExpOwn() { const o = /a/; Object.defineProperty(o, "exec", { value: 1 }); return typeof o.exec; }
function weakMapLink() { const o = new WeakMap(); Object.setPrototypeOf(o, null); return typeof o.get; }
function weakSetLink() { const o = new WeakSet(); Object.setPrototypeOf(o, null); return typeof o.has; }
function bufferLink() { const o = new ArrayBuffer(1); Object.setPrototypeOf(o, null); return typeof o.byteLength + " " + typeof o.slice; }
function sharedLink() { const o = new SharedArrayBuffer(1); Object.setPrototypeOf(o, null); return typeof o.byteLength; }
function dataViewLink() { const o = new DataView(new ArrayBuffer(1)); Object.setPrototypeOf(o, null); return typeof o.getInt8; }
function bytesLink() { const o = new Uint8Array(1); Object.setPrototypeOf(o, null); return typeof o.length + " " + typeof o.fill; }
function bytesOwn() { const o = new Uint8Array(1); Object.defineProperty(o, "length", { value: "s" }); return typeof o.length; }
function doublesLink() { const o = new Float64Array(1); Object.setPrototypeOf(o, null); return typeof o.length; }
function dateLink() { const o = new Date(0); Object.setPrototypeOf(o, null); return typeof o.getTime; }
function errorLink() { const o = new Error("a"); Object.setPrototypeOf(o, null); return typeof o.toString + " " + typeof o.name; }
function* shadowed() { yield 1; }
shadowed.prototype.next = function () { return "mine"; };
function generatorShadowedByItsFunction() { return shadowed().next(); }
function* unlinked() { yield 1; }
Object.setPrototypeOf(unlinked.prototype, null);
function generatorOfUnlinkedPrototype() { return typeof unlinked().next; }
function* replaced() { yield 1; }
replaced.prototype = { next: 1 };
function generatorOfReplacedPrototype() { return typeof replaced().next; }
for (const row of [headersLink, headersOwn, headersStore, headersProto, headersReflect, urlLink, urlOwn, paramsLink, paramsOwn, requestLink, requestOwn, responseLink, responseOwn, blobLink, blobOwn,
  headersIteratorLink, headersIteratorOwn, paramsIteratorLink, paramsIteratorOwn, arrayLink, arrayOwn, arrayIteratorLink, arrayIteratorOwn, mapLink, mapOwn, mapIteratorLink, mapIteratorOwn, setLink,
  setIteratorLink, setIteratorOwn, stringIteratorLink, stringIteratorOwn, regExpStringIteratorLink, regExpStringIteratorOwn, iteratorHelperLink, iteratorHelperOwn, wrapLink, wrapOwn, generatorLink,
  generatorOwn, asyncGeneratorLink, asyncGeneratorOwn, objectLink, objectOwn, literalLink, promiseLink, promiseOwn, regExpLink, regExpOwn, weakMapLink, weakSetLink, bufferLink, sharedLink, dataViewLink,
  bytesLink, bytesOwn, doublesLink, dateLink, errorLink, generatorShadowedByItsFunction, generatorOfUnlinkedPrototype, generatorOfReplacedPrototype])
  console.log(row.name, row());
