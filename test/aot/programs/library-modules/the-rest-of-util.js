// node:util beside inspect: promisify and its custom symbol, callbackify, inherits, deprecate, types, isDeepStrictEqual, parseArgs, styleText, stripVTControlCharacters, TextEncoder and TextDecoder, debuglog, getSystemErrorName, toUSVString and aborted.
import util from "node:util";
import { types } from "node:util";

process.noDeprecation = true;
const delayed = (value, callback) => setImmediate(callback, value === "bad" ? new Error("refused") : null, value + "!");
console.log(await util.promisify(delayed)("ok"), await util.promisify(delayed)("bad").catch(error => error.message));
function custom() {}
custom[util.promisify.custom] = () => Promise.resolve("custom form");
console.log(await util.promisify(custom)(), util.promisify(setTimeout) === util.promisify(setTimeout));
console.log(await new Promise(resolve => util.callbackify(async value => value * 2)(21, (error, value) => resolve([error, value].join()))));
console.log(await new Promise(resolve => util.callbackify(async () => { throw null; })(error => resolve(error.code))));

function Base() {}
Base.prototype.hello = function () { return "hello from Base"; };
function Derived() {}
util.inherits(Derived, Base);
console.log(new Derived().hello(), Derived.super_ === Base);

console.log(types.isPromise(Promise.resolve()), types.isRegExp(/x/), types.isDate(new Date()), types.isMap(new Map()), types.isTypedArray(new Uint8Array()), types.isProxy(new Proxy({}, {})), types.isGeneratorFunction(function* () {}), types.isAsyncFunction(async () => {}), types.isNativeError(new TypeError()), types.isBoxedPrimitive(Object(1)), types.isArrayBuffer(new ArrayBuffer(1)), types.isUint8Array(Buffer.alloc(1)));
console.log(util.isDeepStrictEqual({ a: [1, new Map([[1, 2]])] }, { a: [1, new Map([[1, 2]])] }), util.isDeepStrictEqual([1], ["1"]), util.isDeepStrictEqual(NaN, NaN), util.isDeepStrictEqual(0, -0));
const parsed = util.parseArgs({ args: ["-f", "--name=x", "--list", "a", "--list", "b", "rest"], options: { f: { type: "boolean", short: "f" }, name: { type: "string" }, list: { type: "string", multiple: true } }, allowPositionals: true });
console.log(JSON.stringify(parsed.values), parsed.positionals.join());
try {
  util.parseArgs({ args: ["--unknown"], options: {} });
} catch (error) {
  console.log(error.code);
}
console.log(JSON.stringify(util.styleText("red", "text")), util.stripVTControlCharacters("\u001b[31mtext\u001b[39m"), JSON.stringify(util.styleText(["bold", "underline"], "both")));
console.log(new util.TextDecoder().decode(new util.TextEncoder().encode("grüße")), util.TextEncoder === TextEncoder, new util.TextDecoder("utf-16le").decode(new Uint8Array([104, 0, 105, 0])));
console.log(util.getSystemErrorName(-2), util.toUSVString("a\ud800b") === "a\ufffdb", typeof util.debuglog("section"), util.debuglog("section").enabled);
console.log(util.isArray([]), typeof util.deprecate(() => 1, "old")(), util.inspect.defaultOptions.depth);
