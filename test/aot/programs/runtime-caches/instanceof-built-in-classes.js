// `x instanceof C` where C is a class of the language and nothing is known about x: primitives, plain objects, objects without a prototype, instances,
// instances of subclasses, objects that were given the prototype later, and proxies, whose trap runs once for each step of the walk.
// Then the global binding `Promise` is replaced, and the same code has to ask the new value.
const box = JSON.parse("[0]");
function hidden(value) { box[0] = value; return box[0]; }
const rounds = JSON.parse("40");

class OwnPromise extends Promise {}
class OwnError extends TypeError {}
class OwnArray extends Array {}
class OwnMap extends Map {}

let trapCalls = 0;
const proxyOf = target => new Proxy(target, { getPrototypeOf(object) { trapCalls++; return Reflect.getPrototypeOf(object); } });
const throwingProxy = new Proxy({}, { getPrototypeOf() { throw new RangeError("no prototype for you"); } });

const adopted = {};
Object.setPrototypeOf(adopted, Promise.prototype);
const orphanedArray = [1, 2];
Object.setPrototypeOf(orphanedArray, null);
const heirOfInstance = Object.create(new Map());

const values = [
    ["undefined", undefined], ["null", null], ["number", 1.5], ["string", "text"], ["symbol", Symbol.iterator], ["bigint", 10n], ["boolean", true],
    ["plain", {}], ["without prototype", Object.create(null)], ["function", function () {}], ["arrow", () => 1], ["class", OwnPromise],
    ["array", [1]], ["own array", new OwnArray()], ["orphaned array", orphanedArray],
    ["promise", Promise.resolve(1)], ["own promise", OwnPromise.resolve(1)], ["adopted", adopted], ["thenable", { then() {} }],
    ["error", new Error("e")], ["type error", new TypeError("t")], ["own error", new OwnError("o")],
    ["map", new Map()], ["own map", new OwnMap()], ["heir of a map", heirOfInstance], ["set", new Set()],
    ["date", new Date(0)], ["regexp", /a/], ["bytes", new Uint8Array(2)], ["buffer", new ArrayBuffer(2)],
    ["Promise.prototype", Promise.prototype], ["Object.prototype", Object.prototype], ["Array.prototype", Array.prototype],
    ["proxy of a promise", proxyOf(Promise.resolve(2))], ["proxy of an array", proxyOf([])], ["proxy of a plain object", proxyOf({})],
    ["heir of a proxy", Object.create(proxyOf(new Map()))],
];

function isPromise(x) { return x instanceof Promise; }
function isError(x) { return x instanceof Error; }
function isTypeError(x) { return x instanceof TypeError; }
function isArray(x) { return x instanceof Array; }
function isMap(x) { return x instanceof Map; }
function isObject(x) { return x instanceof Object; }
function isFunction(x) { return x instanceof Function; }
function isDate(x) { return x instanceof Date; }
function isRegExp(x) { return x instanceof RegExp; }
function isBytes(x) { return x instanceof Uint8Array; }
const tests = [isPromise, isError, isTypeError, isArray, isMap, isObject, isFunction, isDate, isRegExp, isBytes];

function describe(title) {
    console.log(title);
    for (const [name, value] of values) {
        let line = "";
        for (const test of tests) {
            let yes = 0;
            for (let i = 0; i < rounds; i++)
                yes += test(hidden(value)) ? 1 : 0;
            line += yes === rounds ? "y" : yes ? "?" : "-";
        }
        console.log(" ", line, name);
    }
    console.log("  trap calls", trapCalls);
    trapCalls = 0;
}

describe("as the language defines them");

for (const test of tests) {
    try {
        console.log(test.name, test(hidden(throwingProxy)));
    } catch (error) {
        console.log(test.name, "throws", error instanceof RangeError, error.message);
    }
}

Object.setPrototypeOf(adopted, Map.prototype);
Object.setPrototypeOf(orphanedArray, OwnError.prototype);
describe("after two objects got other prototypes");

const RealPromise = Promise;
globalThis.Promise = class Impostor {
    static [Symbol.hasInstance](value) { return typeof value === "number"; }
};
describe("with another Promise");
globalThis.Promise = function Plain() {};
globalThis.Promise.prototype = Map.prototype;
describe("with a function whose prototype is that of Map");
globalThis.Promise = 5;
try {
    console.log(isPromise(hidden({})));
} catch (error) {
    console.log("not callable:", error instanceof TypeError);
}
globalThis.Promise = RealPromise;
describe("with the first Promise again");
