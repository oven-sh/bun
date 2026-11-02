// Members are stored again and again into function objects whose prototype was set to null, or to an object that stops the store. What is remembered about one kind says nothing about another.
"use strict";
const lines = [];
const calls = [];
const withSetter = Object.create(null, {
    signal: { set(value) { calls.push("set " + value); }, get() { return "got"; }, configurable: true },
});
const readOnly = Object.create(null, { signal: { value: "fixed", writable: false, configurable: true } });
const plain = Object.create(null);
const kinds = [
    ["null", null],
    ["a setter above", withSetter],
    ["read-only above", readOnly],
    ["an empty object above", plain],
    ["Function.prototype", Function.prototype],
];
function below(fn, prototype) {
    Object.setPrototypeOf(fn, prototype);
    return fn;
}
function fill(draft, i) {
    draft.to = i;
    try {
        draft.signal = i + 1;
    } catch (error) {
        calls.push(error.constructor.name);
    }
    draft.is = () => true;
    draft.event = "e" + (i & 3);
    draft.origin = null;
    return draft;
}
const makers = [
    ["arrow", (i) => (x) => x + i],
    ["function", (i) => function named(x) { return x + i; }],
    ["bound", (i) => function (x) { return x + this; }.bind(i)],
    ["async", (i) => async (x) => x + i],
    ["generator", (i) => function* (x) { yield x + i; }],
    ["method", (i) => ({ member(x) { return x + i; } }).member],
    ["class", (i) => class { static from() { return i; } }],
];
function describe(f) {
    return Reflect.ownKeys(f).map(String).join() + " " + String(f.signal) + " " + String(f.to) + " " + String(Object.getOwnPropertyDescriptor(f, "signal")?.value);
}
function round(title, turns) {
    lines.push(title);
    for (const [makerName, make] of makers) {
        for (const [kindName, prototype] of kinds) {
            const seen = new Set();
            for (let i = 0; i < turns; i++) {
                calls.length = 0;
                const made = fill(below(make(i), prototype), i);
                seen.add(describe(made).replace(/\d+/g, "#") + " {" + calls.join().replace(/\d+/g, "#") + "}");
            }
            lines.push("  " + makerName + " below " + kindName + ": " + [...seen].join(" | "));
        }
    }
}
round("first", 1);
round("again and again", 40);
Object.defineProperty(plain, "event", { set(value) { calls.push("late " + value); }, configurable: true });
round("the empty object got a setter", 10);
delete plain.event;
round("and lost it", 10);
// A function without a prototype gets one again between its stores.
const moved = below((x) => x, null);
moved.to = 1;
Object.setPrototypeOf(moved, withSetter);
calls.length = 0;
moved.signal = 2;
lines.push("moved: " + Object.keys(moved).join() + " {" + calls.join() + "}");
// One that is not extensible, sealed or frozen takes nothing.
for (const close of [Object.preventExtensions, Object.seal, Object.freeze]) {
    const closed = close(below((x) => x, null));
    try {
        closed.to = 1;
        lines.push("stored");
    } catch (error) {
        lines.push(close.name + ": " + error.constructor.name + " " + Object.keys(closed).length);
    }
}
console.log(lines.join("\n"));
