// Frozen, sealed and non-extensible objects, fields that were redefined, and values that the slot of a field does not admit.
const lines = [];
function attempt(what, action) {
    try {
        lines.push(what + ": " + action());
    } catch (error) {
        lines.push(what + ": " + error.constructor.name);
    }
}
function describe(object) {
    return JSON.stringify(object) + " [" + Reflect.ownKeys(object).map(String).join() + "] " + JSON.stringify(Object.getOwnPropertyDescriptors(object));
}
// What comes out of evaluated text is anything: nothing is proven about the receivers.
const hide = (0, eval)("(value) => value");
function strictStore(given, first, second) {
    "use strict";
    const object = hide(given);
    object.first = first;
    object.second = second;
    return object;
}
function sloppyStore(given, first, second) {
    const object = hide(given);
    object.first = first;
    object.second = second;
    return object;
}
function make(withSecond) {
    const made = { first: "f" };
    if (withSecond)
        made.second = 2;
    return made;
}
const changes = {
    "as made": object => object,
    frozen: Object.freeze,
    sealed: Object.seal,
    "not extensible": Object.preventExtensions,
    "first deleted": object => { delete object.first; return object; },
    "first deleted, not extensible": object => { delete object.first; return Object.preventExtensions(object); },
    "first read-only": object => Object.defineProperty(object, "first", { writable: false }),
    "first hidden": object => Object.defineProperty(object, "first", { enumerable: false }),
    "first not configurable": object => Object.defineProperty(object, "first", { configurable: false }),
    "first a setter": object => Object.defineProperty(object, "first", { set(value) { lines.push("  set " + String(value)); }, get() { return "got"; } }),
    "first a getter": object => Object.defineProperty(object, "first", { get() { return "got"; } }),
    "second a setter": object => Object.defineProperty(object, "second", { set(value) { lines.push("  set second " + String(value)); }, configurable: true, enumerable: true }),
    "second read-only": object => Object.defineProperty(object, "second", { value: 1, writable: false, configurable: true, enumerable: true }),
    "a stranger": object => { object.stranger = 1; return object; },
    "a stranger, then first an accessor": object => { object.stranger = 1; return Object.defineProperty(object, "first", { get() { return "got"; }, set(value) { lines.push("  set " + String(value)); }, enumerable: true, configurable: true }); },
};
const values = [["x", 1], [1, "x"], [undefined, null], [null, undefined], [{ toJSON() { return "object"; } }, [1]], [1.5, -0], [2 ** 31, -(2 ** 31) - 1], [true, false], [Symbol.iterator, 10n]];
for (const [name, change] of Object.entries(changes)) {
    for (const withSecond of [false, true]) {
        for (const store of [strictStore, sloppyStore]) {
            attempt(name + (withSecond ? ", both" : ", one") + ", " + store.name, () => describe(store(change(make(withSecond)), "new", 7)));
        }
    }
}
for (const [first, second] of values) {
    attempt("values " + String(first) + " " + String(second), () => {
        const object = strictStore(make(false), first, second);
        return typeof object.first + " " + typeof object.second + " " + String(object.first) + " " + String(object.second) + " " + Object.keys(object).join() + " " + Object.is(object.second, second);
    });
    attempt("values over values " + String(first) + " " + String(second), () => {
        const object = strictStore(strictStore(make(true), "a", 1), first, second);
        return typeof object.first + " " + typeof object.second + " " + String(object.first) + " " + String(object.second) + " " + Object.keys(object).join() + " " + Object.is(object.first, first);
    });
}
// The store is the one that changes the prototype.
function storeProto(given, value) {
    const object = hide(given);
    object.__proto__ = value;
    return object;
}
const parent = { inherited: "yes" };
attempt("__proto__ of a literal", () => { const object = storeProto(make(false), parent); return object.inherited + " " + Object.keys(object).join() + " " + (Object.getPrototypeOf(object) === parent); });
attempt("__proto__ below null", () => { const object = storeProto(Object.assign(Object.create(null), { first: 1 }), parent); return String(object.inherited) + " " + Object.keys(object).join() + " " + (Object.getPrototypeOf(object) === null); });
attempt("an own __proto__", () => { const object = { ["__proto__"]: 1, first: 2 }; storeProto(object, parent); return String(object.inherited) + " " + Object.keys(object).join() + " " + (Object.getPrototypeOf(object) === Object.prototype); });
attempt("then a field", () => { const object = strictStore(storeProto(make(false), { set second(value) { lines.push("  above " + value); } }), "a", "b"); return describe(object); });
console.log(lines.join("\n"));
