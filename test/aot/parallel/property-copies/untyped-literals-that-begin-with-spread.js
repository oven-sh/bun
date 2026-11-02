// The same in code without types: `{ ...source, name: value }`, where nothing says what the source is.
"use strict";
const lines = [];
const calls = [];
function describe(object) {
    if (object === null || typeof object !== "object")
        return String(object);
    return Reflect.ownKeys(object).map((key) => {
        const d = Object.getOwnPropertyDescriptor(object, key);
        return String(key) + ":" + (d.writable ? "w" : "-") + (d.enumerable ? "e" : "-") + (d.configurable ? "c" : "-") + ":" + (d.get ? "accessor" : JSON.stringify(d.value));
    }).join(" ") + (Object.getPrototypeOf(object) === Object.prototype ? "" : " OTHER PROTOTYPE") + (Object.isExtensible(object) ? "" : " CLOSED");
}
const withName = (source, value) => ({ ...source, name: value });
const merged = (defaults, given) => ({ ...defaults, ...given });
const nameBetween = (a, b) => ({ ...a, between: 1, ...b });
const withMethod = (source) => ({ ...source, method() { return this.name; } });
const withPrototype = (source, prototype) => ({ ...source, __proto__: prototype });
const withComputed = (source, key) => ({ ...source, [key]: "computed" });
function Made(a) { this.a = a; this.name = "made"; }
Made.prototype.inherited = 1;
const sources = {
    literal: () => ({ a: 1, b: "two", name: "old" }),
    empty: () => ({}),
    constructed: () => new Made(3),
    parsed: () => JSON.parse('{"z":1,"name":"parsed","a":[1]}'),
    created: () => Object.assign(Object.create({ above: 1 }), { a: 1 }),
    frozen: () => Object.freeze({ a: 1, name: "frozen" }),
    withGetter: () => ({ a: 1, get name() { calls.push("get"); return "got"; } }),
    withHidden: () => Object.defineProperty({ a: 1 }, "hidden", { value: 2, enumerable: false }),
    withSymbol: () => ({ [Symbol.for("s")]: 1, a: 2 }),
    withIndexes: () => ({ 2: "two", a: 1, 0: "zero" }),
    array: () => [1, 2],
    text: () => "hi",
    nothing: () => undefined,
    none: () => null,
    number: () => 4,
    grown: () => { const o = { a: 1 }; o.later = 2; o.name = "grown"; delete o.a; return o; },
};
for (const [title, make] of Object.entries(sources)) {
    const said = [];
    for (let round = 0; round < 10; round++) {
        calls.length = 0;
        const outcome = [
            describe(withName(make(), round & 1 ? "odd" : "even")),
            describe(merged(make(), { a: "given", more: true })),
            describe(merged({ a: "default", d: 1 }, make())),
            describe(nameBetween(make(), make())),
            describe(withMethod(make())).replace(/method:wec:undefined/, "method"),
            describe(withPrototype(make(), null)),
            describe(withComputed(make(), "a")),
            calls.join(),
        ].join(" | ");
        if (said[said.length - 1] !== outcome)
            said.push(outcome);
    }
    lines.push(title + ": " + said.join("\n   > "));
}
console.log(lines.join("\n"));
