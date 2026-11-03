// A cached read by name or by key finds a getter of every kind: arrows, functions, methods, with parameters, bound, native, a proxy, a class, async, a generator, one that throws,
// one that recurses until the stack ends, one that replaces itself; while numbers and objects are live in the caller around the read.
const lines = [];
function say(what, value) { lines.push(what + " " + value); }
const kinds = {
    arrow: () => "arrow",
    plain: function () { return "plain " + typeof this; },
    strict: function () { "use strict"; return "strict " + (this === undefined ? "undefined" : typeof this); },
    withParameter: function (a) { return "parameter " + a; },
    withThreeParameters: function (a, b, c) { return "parameters " + a + b + c + arguments.length; },
    withDefault: function (a = 7) { return "default " + a; },
    withRest: function (...rest) { return "rest " + rest.length; },
    bound: function () { return "bound " + this.tag; }.bind({ tag: "kept" }),
    boundWithArgument: function (a) { return "bound argument " + a; }.bind(null, 5),
    native: Math.random.bind === undefined ? null : Object.prototype.toString,
    hostFunction: Array.prototype.slice,
    proxy: new Proxy(function () { return "target " + typeof this; }, {}),
    proxyWithTrap: new Proxy(function () {}, { apply(target, receiver, list) { return "trap " + typeof receiver + list.length; } }),
    async: async function () { return 1; },
    generator: function* () { yield 1; },
    capturing: (text => () => "captured " + text)("value"),
    usesThis: function () { return "this.id " + this.id; },
    throws: function () { throw new RangeError("from the getter"); },
    method: { m() { return "method " + this.id; } }.m,
};
const holder = { id: 1 };
for (const name of Object.keys(kinds)) Object.defineProperty(holder, name, { get: kinds[name], configurable: true, enumerable: true });
const below = Object.create(holder);
below.id = 2;
function describe(value) {
    if (value instanceof Promise) return "a promise";
    if (value !== null && typeof value === "object" && typeof value.next === "function") return "a generator " + value.next().value;
    return Array.isArray(value) ? "an array of " + value.length : String(value);
}
function readByName(object, a, b) {
    // a and b stay live across every read, as a number, a double and an object.
    const double = a * 1.5, list = [a, b];
    let out = "";
    out += describe(object.arrow) + "|" + describe(object.plain) + "|" + describe(object.strict) + "|" + describe(object.withParameter) + "|";
    out += describe(object.withThreeParameters) + "|" + describe(object.withDefault) + "|" + describe(object.withRest) + "|" + describe(object.bound) + "|";
    out += describe(object.boundWithArgument) + "|" + describe(object.native) + "|" + describe(object.hostFunction) + "|" + describe(object.proxy) + "|";
    out += describe(object.proxyWithTrap) + "|" + describe(object.async) + "|" + describe(object.generator) + "|" + describe(object.capturing) + "|";
    out += describe(object.usesThis) + "|" + describe(object.method);
    return out + " " + (a + b) + " " + double + " " + list.join();
}
function readByKey(object, names, a) {
    const double = a / 4;
    let out = "";
    for (const name of names) out += describe(object[name]) + "|";
    return out + a + " " + double;
}
const quiet = Object.keys(kinds).filter(name => name !== "throws");
let seen = new Set();
for (let round = 0; round < 60; round++) seen.add(readByName(round & 1 ? holder : below, 3, 4));
say("by name", [...seen].join("\n  "));
seen = new Set();
for (let round = 0; round < 60; round++) seen.add(readByKey(round & 1 ? holder : below, quiet, 10));
say("by key", [...seen].join("\n  "));

function readThrowing(object, a) {
    const double = a * 2.5;
    try { return object.throws; } catch (error) { return error.constructor.name + " " + error.message + " " + a + " " + double; }
}
seen = new Set();
for (let round = 0; round < 60; round++) seen.add(readThrowing(round & 1 ? holder : below, 6));
say("a getter that throws", [...seen].join(" | "));

function testTruth(object) { return (object.arrow ? 1 : 0) + (object.usesThis ? 2 : 0) + (object.zero ? 4 : 0) + (object.missing ? 8 : 0); }
Object.defineProperty(holder, "zero", { get: () => 0, configurable: true });
let sum = 0;
for (let round = 0; round < 60; round++) sum += testTruth(round & 1 ? holder : below);
say("read and tested at once", sum);

let depth = 0;
const deep = {};
Object.defineProperty(deep, "down", { get() { depth++; return this.down; } });
function fall() { try { return deep.down; } catch (error) { return error.constructor.name; } }
say("a getter that reads itself", fall() + " " + (depth > 100) + " " + fall());

const changing = {};
let calls = 0;
Object.defineProperty(changing, "value", { get: () => { calls++; return "first"; }, configurable: true });
function readChanging() { return changing.value; }
for (let round = 0; round < 40; round++) readChanging();
Object.defineProperty(changing, "value", { get: function () { calls += 100; return "second"; }, configurable: true });
say("another getter in the same place", readChanging() + " " + calls);
Object.defineProperty(changing, "value", { get: Object.prototype.valueOf, configurable: true });
say("a native one in the same place", readChanging() === changing);
Object.defineProperty(changing, "value", { get: undefined, set(v) {}, configurable: true });
say("no getter in the same place", readChanging());
Object.defineProperty(changing, "value", { get() { Object.defineProperty(changing, "value", { value: "data now", configurable: true }); return "replaced itself"; }, configurable: true });
say("a getter that replaces itself", readChanging() + " " + readChanging());

class Shape { #side = 3; get area() { return this.#side * this.#side; } static get kind() { return "static " + this.name; } }
class Square extends Shape { get area() { return super.area + 1; } }
function readClass(shape, type) { return shape.area + " " + type.kind; }
seen = new Set();
for (let round = 0; round < 60; round++) seen.add(readClass(round & 1 ? new Shape() : new Square(), round & 1 ? Shape : Square));
say("getters of classes", [...seen].join(" | "));
console.log(lines.join("\n"));
