// A free name that finds a member of the global object which never changes is that built-in, and `instanceof` against it walks the chain of the value alone. A name that the program stores, declares or adds later is looked up, and a chain that was changed, a proxy and a primitive answer as the operator says.
// Under: --aot-testing=ForceStraightCompilation: the closed ways give the same answers
globalThis.report = value => { console.log(typeof value === "string" ? JSON.stringify(value) : Object.is(value, -0) ? "-0" : String(value)); };
const attempt = (way) => { try { return way(); } catch (error) { return error.name; } };
const Native = Promise;
function current() { return Promise; }
function isWaiting(value) { return value instanceof Promise; }
function kindOf() { return typeof Promise; }
report(current() === Native);
report(kindOf());
report(isWaiting(Native.resolve(1)));
report(isWaiting(undefined));
report(isWaiting(null));
report(isWaiting(1));
report(isWaiting("text"));
report(isWaiting({}));
report(isWaiting({ then() {} }));
report(isWaiting(Object.create(Native.prototype)));
report(isWaiting(Object.setPrototypeOf(Native.resolve(1), null)));
report(isWaiting(Object.setPrototypeOf(Native.resolve(1), Array.prototype)));
report(isWaiting(Object.setPrototypeOf([], Native.prototype)));
report(isWaiting(new (class Later extends Native {})(() => {})));
report(isWaiting(new Proxy(Native.resolve(1), {})));
report(isWaiting(new Proxy({}, { getPrototypeOf() { return Native.prototype; } })));
report(attempt(() => isWaiting(new Proxy({}, { getPrototypeOf() { throw new RangeError("asked"); } }))));
function isList(value) { return value instanceof Array; }
function isMap(value) { return value instanceof Map; }
function isObject(value) { return value instanceof Object; }
function isFunction(value) { return value instanceof Function; }
function isError(value) { return value instanceof Error; }
function isBytes(value) { return value instanceof Uint8Array; }
const values = [undefined, null, 0, "", Symbol.iterator, 1n, {}, [], new Map(), () => 1, new TypeError("no"), new Uint8Array(1), Object.create(null), Object.create(Array.prototype), Object.create(Map.prototype), class {}];
for (const value of values) report([isList(value), isMap(value), isObject(value), isFunction(value), isError(value), isBytes(value)].join(" "));
report(attempt(() => 1 instanceof Math));
report(attempt(() => ({}) instanceof Math.floor));
report(attempt(() => ({}) instanceof JSON));
function written(value) { return JSON.stringify(value); }
report(written({ a: [1, "b", null] }));
report(written(undefined));
report(written(() => 1));
report(attempt(() => written(1n)));
const nativeStringify = JSON.stringify;
JSON.stringify = () => "mine";
report(written({ a: 1 }));
JSON.stringify = nativeStringify;
report(written({ a: 1 }));
function least() { return Math.min(3, 2); }
report(least());
function shadowed(Promise) { return typeof Promise; }
report(shadowed(1));
function declaredInside() { let Promise = 5; return Promise; }
report(declaredInside());
report((0, eval)("(function () { let Promise = 6; return Promise; })()"));
report(attempt(() => missingName));
report(typeof missingName);
globalThis.addedLater = 7;
function readsAdded() { return addedLater; }
report(readsAdded());
delete globalThis.addedLater;
report(attempt(readsAdded));
report("end");
