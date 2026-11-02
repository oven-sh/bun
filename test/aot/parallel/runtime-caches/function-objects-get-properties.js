// Function objects get properties by name, again and again, so that whatever remembers has remembered. What is above them, and what they are, decides each store anew.
"use strict";
const lines = [];
const calls = [];
const TAG = Symbol("TAG");
function attempt(title, make, rounds = 24) {
    const said = [];
    for (let round = 0; round < rounds; round++) {
        calls.length = 0;
        let outcome;
        try {
            const made = make(round);
            outcome = Reflect.ownKeys(made).map(String).join() + " | " + String(made.kind) + " " + String(made.order) + " " + String(made[TAG]);
        } catch (error) {
            outcome = error.constructor.name;
        }
        if (calls.length)
            outcome += " {" + calls.join() + "}";
        outcome = outcome.replace(/\b\d+\b/g, "n");
        if (said[said.length - 1] !== outcome)
            said.push(outcome);
    }
    lines.push(title + ": " + said.join(" > "));
}
function fill(target, round) {
    target.kind = "k";
    target.order = round;
    target[TAG] = round;
    return target;
}
const kinds = {
    "an arrow": () => () => 1,
    "a function": () => function () { return 1; },
    "a named function": () => function named() { return 1; },
    "a method": () => ({ method() { return 1; } }).method,
    "an async function": () => async function () {},
    "a generator": () => function* () {},
    "a class": () => class Made {},
    "a class with statics": () => class Made { static kind = "declared"; static order() {} },
    "a class below a class": () => class Made extends (class Base { static set order(value) { calls.push("static set " + value); } }) {},
    "a bound function": () => function () {}.bind(null),
    "a bound arrow": () => (() => 1).bind(null),
    "a function of the engine": () => Math.max.bind(Math),
};
for (const [name, make] of Object.entries(kinds))
    attempt(name, (round) => fill(make(), round));

// What is above the function.
const withSetter = Object.defineProperties(() => {}, { order: { set(value) { calls.push("set " + value); }, get() { return "got"; }, configurable: true } });
const withGetterOnly = Object.defineProperties(() => {}, { order: { get() { return "only got"; }, configurable: true } });
const withReadOnly = Object.defineProperties(function () {}, { kind: { value: "fixed", writable: false, configurable: true } });
const withData = Object.assign(() => {}, { kind: "above", order: -1 });
const literal = { kind: "literal above", set order(value) { calls.push("literal set " + value); } };
const proxy = new Proxy(() => {}, { set(target, key, value, receiver) { calls.push("trap " + String(key)); return Reflect.defineProperty(receiver, key, { value, writable: true, enumerable: true, configurable: true }); } });
const prototypes = { withSetter, withGetterOnly, withReadOnly, withData, literal, proxy, "null": null, "Object.prototype": Object.prototype };
for (const [name, prototype] of Object.entries(prototypes)) {
    attempt("an arrow below " + name, (round) => fill(Object.setPrototypeOf(() => 1, prototype), round));
    attempt("a function below " + name, (round) => fill(Object.setPrototypeOf(function () {}, prototype), round));
}

// What is above changes while the stores go on.
const changing = Object.assign(() => {}, { other: 1 });
attempt("below a function that changes", (round) => {
    if (round === 8)
        Object.defineProperty(changing, "order", { set(value) { calls.push("late set " + value); }, configurable: true });
    if (round === 14)
        delete changing.order;
    if (round === 18)
        Object.defineProperty(changing, "kind", { value: "late", writable: false, configurable: true });
    return fill(Object.setPrototypeOf(() => 1, changing), round);
});

// The names that a function answers for by itself.
function fillOwn(target, round) {
    const said = [];
    for (const store of [(t) => { t.name = "n" + round; }, (t) => { t.length = round; }, (t) => { t.prototype = { round }; }, (t) => { t.displayName = "d" + round; }, (t) => { t.caller = 1; }, (t) => { t.arguments = 1; }]) {
        try {
            store(target);
            said.push("done");
        } catch (error) {
            said.push(error.constructor.name);
        }
    }
    calls.push(said.join("/"), typeof target.prototype, target.name, target.length, String(target.displayName));
    return target;
}
for (const name of ["an arrow", "a function", "a class", "a bound function", "a method"])
    attempt("own names of " + name, (round) => fillOwn(kinds[name](), round), 6);

// Functions that take nothing more.
attempt("a frozen arrow", (round) => fill(Object.freeze(() => 1), round));
attempt("a sealed function", (round) => fill(Object.seal(function () {}), round));
attempt("an arrow that takes no more", (round) => fill(Object.preventExtensions(() => 1), round));
attempt("an arrow with the names, frozen later", (round) => fill(Object.freeze(fill(() => 1, -1)), round));

// Many names: the storage grows more than once, and what the function is stays.
attempt("thirty names", (round) => {
    const made = (a, b) => a + b;
    made.n0 = 0; made.n1 = 1; made.n2 = 2; made.n3 = 3; made.n4 = 4; made.n5 = 5; made.n6 = 6; made.n7 = 7; made.n8 = 8; made.n9 = 9;
    made.m0 = 0; made.m1 = 1; made.m2 = 2; made.m3 = 3; made.m4 = 4; made.m5 = 5; made.m6 = 6; made.m7 = 7; made.m8 = 8; made.m9 = 9;
    made.k0 = 0; made.k1 = 1; made.k2 = 2; made.k3 = 3; made.k4 = 4; made.k5 = 5; made.k6 = 6; made.k7 = 7; made.k8 = 8; made.k9 = 9;
    calls.push(made(round, 1), made.length, made.name, made.k9 + made.m5 + made.n1);
    return fill(made, round);
});
console.log(lines.join("\n"));
