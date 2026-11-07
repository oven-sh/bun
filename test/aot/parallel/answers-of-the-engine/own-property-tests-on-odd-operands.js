// Object.hasOwn refuses undefined and null before it converts its key, hasOwnProperty converts the key first. A stub or one operation stands in the place of either call only where nobody can tell: primitives, proxies with traps, keys that talk or throw, indexes and symbols answer as the functions do, in a loop and outside.
// Under: --aot-testing=WritesBodiesStraight: the closed ways give the same answers
globalThis.report = value => { console.log(typeof value === "string" ? JSON.stringify(value) : Object.is(value, -0) ? "-0" : String(value)); };
const attempt = (way) => { try { return way(); } catch (error) { return error.name; } };
const log = [];
const hasOwn = Object.hasOwn;
const hasOwnProperty = Object.prototype.hasOwnProperty;
const talkingKey = { toString() { log.push("key"); return "a"; } };
const throwingKey = { toString() { throw new RangeError("key"); } };
const watched = new Proxy({ a: 1 }, { getOwnPropertyDescriptor(target, key) { log.push("trap " + String(key)); return Reflect.getOwnPropertyDescriptor(target, key); } });
const throwing = new Proxy({}, { getOwnPropertyDescriptor() { throw new EvalError("trap"); } });
class Below { constructor() { this.own = 1; } inherited() {} }
const receivers = [undefined, null, true, 0, 1n, "abc", Symbol.iterator, {}, { a: 1 }, { 0: 1 }, [7], Object.create({ a: 1 }), Object.create(null), new Below(), () => 1, watched, throwing, new Map([["a", 1]]), new String("abc"), Object.freeze({ a: 2 })];
const keys = ["a", "0", 0, "length", "own", "inherited", "name", "__proto__", Symbol.iterator, undefined, null, 1.5, -0, talkingKey, throwingKey];
function byFunction(object, key) { let answer; for (let turn = 0; turn < 2; turn++) answer = hasOwn(object, key); return answer; }
function byMethod(object, key) { let answer; for (let turn = 0; turn < 2; turn++) answer = hasOwnProperty.call(object, key); return answer; }
function once(object, key) { return Object.hasOwn(object, key); }
for (const object of receivers) for (const key of keys) report([attempt(() => byFunction(object, key)), attempt(() => byMethod(object, key)), attempt(() => once(object, key))].join(" "));
report(log.join(","));
function written(object) { return [Object.hasOwn(object, "a"), Object.hasOwn(object, "own"), Object.hasOwn(object, "length"), Object.hasOwn(object, "0"), Object.hasOwn(object, "__proto__"), Object.hasOwn(object, "inherited")].join(" "); }
for (const object of receivers) report(attempt(() => written(object)));
function writtenOnObject(object) { if (typeof object !== "object" || object === null) return "no object"; return [Object.hasOwn(object, "a"), object.hasOwnProperty === hasOwnProperty && object.hasOwnProperty("own"), hasOwnProperty.call(object, "length")].join(" "); }
for (const object of receivers) report(attempt(() => writtenOnObject(object)));
report(attempt(() => Object.hasOwn()));
report(attempt(() => Object.hasOwn({})));
report(Object.hasOwn({ undefined: 1 }));
report(attempt(() => hasOwnProperty.call()));
report(hasOwnProperty.call({ undefined: 1 }));
report(log.length);
report("end");
