// One value asked `instanceof` one class of the engine after the other: as a row of ifs, as else-ifs, as switch (true), joined by || and &&, in a loop; with nothing between the tests,
// with harmless work between them, and with work between them that changes the value's prototype. What counts is the prototype chain and never the kind of cell.
const lines = [];
function kind(value) {
    if (value instanceof Map) return "Map";
    if (value instanceof Set) return "Set";
    if (value instanceof WeakMap) return "WeakMap";
    if (value instanceof WeakSet) return "WeakSet";
    if (value instanceof Error) return "Error";
    if (value instanceof ArrayBuffer) return "ArrayBuffer";
    if (value instanceof SharedArrayBuffer) return "SharedArrayBuffer";
    if (value instanceof Int8Array) return "Int8Array";
    if (value instanceof Uint8Array) return "Uint8Array";
    if (value instanceof Uint8ClampedArray) return "Uint8ClampedArray";
    if (value instanceof Int16Array) return "Int16Array";
    if (value instanceof Uint16Array) return "Uint16Array";
    if (value instanceof Int32Array) return "Int32Array";
    if (value instanceof Uint32Array) return "Uint32Array";
    if (value instanceof Float32Array) return "Float32Array";
    if (value instanceof Float64Array) return "Float64Array";
    if (value instanceof BigInt64Array) return "BigInt64Array";
    if (value instanceof BigUint64Array) return "BigUint64Array";
    if (value instanceof DataView) return "DataView";
    if (value instanceof Date) return "Date";
    if (value instanceof RegExp) return "RegExp";
    if (value instanceof Promise) return "Promise";
    if (value instanceof Array) return "Array";
    if (value instanceof String) return "String";
    if (value instanceof Number) return "Number";
    if (value instanceof Boolean) return "Boolean";
    if (value instanceof Symbol) return "Symbol";
    if (value instanceof BigInt) return "BigInt";
    if (value instanceof WeakRef) return "WeakRef";
    if (value instanceof FinalizationRegistry) return "FinalizationRegistry";
    if (value instanceof Function) return "Function";
    if (value instanceof Object) return "Object";
    return "none";
}
function byElse(value) {
    let found;
    if (value instanceof Map) found = 1;
    else if (value instanceof Set) found = 2;
    else if (value instanceof Error) found = 3;
    else if (value instanceof Uint8Array) found = 4;
    else if (value instanceof Array) found = 5;
    else found = 0;
    return found;
}
function bySwitch(value) {
    switch (true) {
    case value instanceof Map: return 1;
    case value instanceof Set: return 2;
    case value instanceof Error: return 3;
    case value instanceof Uint8Array: return 4;
    case value instanceof Array: return 5;
    default: return 0;
    }
}
function anyOf(value) { return value instanceof Map || value instanceof Set || value instanceof Date || value instanceof RegExp || value instanceof Promise; }
function allOf(value) { return value instanceof Object && value instanceof Error && !(value instanceof Map) && !(value instanceof Array); }
function bits(value) {
    const a = value instanceof Map, b = value instanceof Set, c = value instanceof Error, d = value instanceof Array, e = value instanceof Function, f = value instanceof Object;
    return (a ? 1 : 0) | (b ? 2 : 0) | (c ? 4 : 0) | (d ? 8 : 0) | (e ? 16 : 0) | (f ? 32 : 0);
}
class OwnMap extends Map { }
class OwnerMap extends OwnMap { }
class OwnError extends TypeError { }
class OwnArray extends Array { }
class OwnBytes extends Uint8Array { }
class OwnPromise extends Promise { }
class Plain { }
const make = [
    () => undefined, () => null, () => true, () => 0, () => 1.5, () => "text", () => 10n, () => Symbol.iterator,
    () => ({}), () => ({ a: 1, b: 2 }), () => [], () => [1, 2], () => () => 0, () => function () { }, () => class { }, () => new Plain,
    () => new Map, () => new Set, () => new WeakMap, () => new WeakSet, () => new Error("e"), () => new TypeError("t"), () => new RangeError("r"), () => new AggregateError([]),
    () => new ArrayBuffer(8), () => new SharedArrayBuffer(8), () => new Int8Array(1), () => new Uint8Array(1), () => new Uint8ClampedArray(1), () => new Int16Array(1), () => new Uint16Array(1),
    () => new Int32Array(1), () => new Uint32Array(1), () => new Float32Array(1), () => new Float64Array(1), () => new BigInt64Array(1), () => new BigUint64Array(1), () => new DataView(new ArrayBuffer(8)),
    () => new Date(0), () => /x/, () => Promise.resolve(1), () => new String("s"), () => new Number(1), () => new Boolean(false), () => Object(Symbol.iterator), () => Object(1n),
    () => new WeakRef({}), () => new FinalizationRegistry(() => { }),
    () => new OwnMap, () => new OwnerMap, () => new OwnError("o"), () => new OwnArray, () => new OwnBytes(1), () => OwnPromise.resolve(1),
    () => Object.create(null), () => Object.create(Object.create(null)), () => Object.create({}), () => Object.create(Object.prototype),
    () => Object.create(Map.prototype), () => Object.create(Object.create(Set.prototype)), () => Object.create(Error.prototype), () => Object.create(Array.prototype), () => Object.create(Uint8Array.prototype), () => Object.create(Function.prototype),
    () => Object.setPrototypeOf({}, Map.prototype), () => Object.setPrototypeOf({ a: 1 }, Date.prototype), () => Object.setPrototypeOf([], Set.prototype), () => Object.setPrototypeOf(() => 0, Error.prototype),
    () => Object.setPrototypeOf(new Map, null), () => Object.setPrototypeOf(new Map, Object.prototype), () => Object.setPrototypeOf(new Map, Set.prototype), () => Object.setPrototypeOf(new Set, Map.prototype),
    () => Object.setPrototypeOf(new Uint8Array(1), Object.prototype), () => Object.setPrototypeOf(new Error("e"), Object.prototype), () => Object.setPrototypeOf([], Object.prototype), () => Object.setPrototypeOf(new Date(0), null),
    () => Object.setPrototypeOf(function () { }, Object.prototype), () => Object.setPrototypeOf(Promise.resolve(1), Array.prototype),
    () => Object.prototype, () => Map.prototype, () => Array.prototype, () => Function.prototype, () => Error.prototype, () => TypeError.prototype, () => Uint8Array.prototype, () => Object.getPrototypeOf(Uint8Array.prototype),
    () => Map, () => Object, () => Math, () => JSON, () => globalThis, () => (function () { return arguments; })(),
];
for (let round = 0; round < 3; round++) {
    const rows = make.map(each => { const value = each(); return kind(value) + " " + byElse(value) + bySwitch(value) + (anyOf(value) ? "y" : "n") + (allOf(value) ? "y" : "n") + " " + bits(value); });
    if (round === 2)
        lines.push(...rows);
}

let asked = 0;
function watched(prototype) { return new Proxy({}, { getPrototypeOf() { asked++; return prototype; } }); }
for (const prototype of [Object.prototype, Map.prototype, Error.prototype, null]) {
    asked = 0;
    const proxy = watched(prototype);
    lines.push("proxy " + kind(proxy) + " " + asked + " " + bits(proxy) + " " + asked + " " + bySwitch(proxy) + " " + asked);
    asked = 0;
    const below = Object.create(proxy);
    lines.push("below a proxy " + kind(below) + " " + asked + " " + bits(below) + " " + asked);
}

function changedBetween(value, prototype) {
    const before = value instanceof Map;
    Object.setPrototypeOf(value, prototype);
    const after = value instanceof Map;
    const alsoSet = value instanceof Set;
    return before + " " + after + " " + alsoSet;
}
lines.push(changedBetween({}, Map.prototype), changedBetween({}, Set.prototype), changedBetween(new Map, Object.prototype), changedBetween({}, Object.prototype), changedBetween(new Map, null));
function changedByCallee(value, change) {
    if (value instanceof Map) return "Map at first";
    change(value);
    if (value instanceof Map) return "Map later";
    if (value instanceof Set) return "Set later";
    return "neither";
}
lines.push(changedByCallee({}, v => Object.setPrototypeOf(v, Map.prototype)), changedByCallee({}, v => Object.setPrototypeOf(v, Set.prototype)), changedByCallee({}, () => 0), changedByCallee(new Map, () => 0));
const turning = { [Symbol.hasInstance](value) { Object.setPrototypeOf(value, Set.prototype); return false; } };
function changedByAnotherTest(value) {
    if (value instanceof Map) return "Map";
    if (value instanceof turning) return "turning";
    if (value instanceof Set) return "Set";
    return "none";
}
lines.push(changedByAnotherTest({}), changedByAnotherTest({ a: 1 }), changedByAnotherTest(new Map), changedByAnotherTest(5));
function changedByGetter(value, holder) {
    const a = value instanceof Map;
    const read = holder.read;
    const b = value instanceof Map;
    return a + " " + b + " " + read;
}
const target = {};
lines.push(changedByGetter(target, { get read() { Object.setPrototypeOf(target, Map.prototype); return "got"; } }), changedByGetter({}, { read: "plain" }));
function harmlessBetween(value, n) {
    let sum = 0;
    if (value instanceof Map) sum += 1;
    sum += n * 2;
    if (value instanceof Set) sum += 10;
    const text = "n" + n;
    if (value instanceof Error) sum += 100;
    if (text.length > 1 && value instanceof Array) sum += 1000;
    return sum;
}
lines.push([{}, new Map, new Set, new Error("e"), [], 5, null].map(value => harmlessBetween(value, 3)).join());
function twoValues(a, b) {
    return (a instanceof Map ? 1 : 0) + (b instanceof Map ? 2 : 0) + (a instanceof Set ? 4 : 0) + (b instanceof Set ? 8 : 0);
}
lines.push([twoValues({}, new Map), twoValues(new Map, {}), twoValues(new Set, new Map), twoValues({}, {}), twoValues(new Set, new Set)].join());
function inLoop(values) {
    let maps = 0, sets = 0, errors = 0;
    for (const value of values) {
        if (value instanceof Map) maps++;
        else if (value instanceof Set) sets++;
        else if (value instanceof Error) errors++;
    }
    return maps + " " + sets + " " + errors;
}
lines.push(inLoop(make.map(each => each())));
console.log(lines.join("\n"));
