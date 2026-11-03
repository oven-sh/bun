// Stores by key that meet a property the object itself has, in every state in which the store may not simply put the value there. What plain Bun prints.
"use strict";
const lines = [];
function show(label, o) { lines.push(label + ": " + JSON.stringify(Object.getOwnPropertyDescriptors(o))); }
function attempt(label, run) { try { run(); lines.push(label + ": done"); } catch (error) { lines.push(label + ": " + error.constructor.name); } }
const keys = ["alpha", "beta", "gamma", "0", "length", "__proto__", "constructor", ""].map(k => (k + process.argv.length).slice(0, k.length));
function storeAll(label, o, value) { for (const k of keys) attempt(label + " " + k, () => { o[k] = value; }); show(label, o); }
function make() { const o = {}; o[keys[0]] = 1; o[keys[1]] = 2; return o; }
for (let round = 0; round < 3; round++) {
    storeAll("plain", make(), round);
    storeAll("frozen", Object.freeze(make()), round);
    storeAll("sealed", Object.seal(make()), round);
    storeAll("not extensible", Object.preventExtensions(make()), round);
    storeAll("read-only", Object.defineProperty(make(), "alpha", { value: 5, writable: false, enumerable: true, configurable: true }), round);
    storeAll("hidden", Object.defineProperty(make(), "alpha", { value: 5, writable: true, enumerable: false, configurable: false }), round);
    let seen = [];
    storeAll("setter", Object.defineProperty(make(), "alpha", { get() { return seen.length; }, set(v) { seen.push(v); }, enumerable: true, configurable: true }), round);
    storeAll("getter alone", Object.defineProperty(make(), "beta", { get() { return 7; }, enumerable: true, configurable: true }), round);
    const dictionary = make(); for (let k = 0; k < 80; k++) dictionary["d" + k] = k; for (let k = 0; k < 78; k++) delete dictionary["d" + k];
    storeAll("dictionary", dictionary, round);
    const wide = make(); for (let k = 0; k < 12; k++) wide["w" + k] = k; wide.gamma = "out of line";
    storeAll("out of line", wide, round);
    const prototype = make(); const heir = Object.create(prototype);
    storeAll("prototype", prototype, round); storeAll("heir", heir, round); show("prototype behind the heir", prototype);
    const readOnlyAbove = Object.create(Object.freeze(make()));
    storeAll("below a frozen object", readOnlyAbove, round);
    storeAll("array", [1, 2, 3], round);
    storeAll("with elements", Object.assign(make(), { 0: "zero" }), round);
    storeAll("literal", { alpha: 1, beta: 2 }, round);
    storeAll("instance", new (class { alpha = 1; beta = 2; })(), round);
    const cells = make(); storeAll("cells", cells, { round }); storeAll("cells again", cells, [round]);
    // Compiled objects with extra properties.
    const extend = o => { o[keys[2]] = "extra"; return o; };
    storeAll("literal with an extra", extend({ alpha: 1, beta: 2 }), round);
    storeAll("frozen with an extra", Object.freeze(extend({ alpha: 1, beta: 2 })), round);
    storeAll("sealed with an extra", Object.seal(extend({ alpha: 1, beta: 2 })), round);
    storeAll("read-only extra", Object.defineProperty({ alpha: 1, beta: 2 }, "gamma", { value: 5, writable: false, enumerable: true, configurable: true }), round);
    storeAll("hidden extra", Object.defineProperty({ alpha: 1, beta: 2 }, "gamma", { value: 5, writable: true, enumerable: false, configurable: true }), round);
    const stored = [];
    storeAll("extra with a setter", Object.defineProperty({ alpha: 1, beta: 2 }, "gamma", { get() { return stored.length; }, set(v) { stored.push(v); }, enumerable: true, configurable: true }), round);
    storeAll("extra with a setter of the host", Object.defineProperty({ alpha: 1, beta: 2 }, "gamma", { set: Object.getOwnPropertyDescriptor(Object.prototype, "__proto__").set, enumerable: true, configurable: true }), round);
    storeAll("extra with a bound setter", Object.defineProperty({ alpha: 1, beta: 2 }, "gamma", { set: function (v) { this.push(v); }.bind(stored), enumerable: true, configurable: true }), round);
    storeAll("instance with an extra", extend(new (class { alpha = 1; beta = 2; })()), round);
    const many = extend({ alpha: 1 }); for (let k = 0; k < 80; k++) many["m" + k] = k; for (let k = 0; k < 78; k++) delete many["m" + k];
    storeAll("extras as a dictionary", many, round);
    storeAll("below a literal with an extra", Object.create(extend({ alpha: 1, beta: 2 })), round);
    storeAll("cells into an extra", extend({ alpha: 1 }), { round });
    storeAll("a field with the empty name", extend({ "": 1, alpha: 2 }), round);
    storeAll("an extra with the empty name", (o => { o[keys[7]] = "empty"; return o; })({ alpha: 2 }), round);
    // Definitions by key.
    const key = keys[0];
    show("defined over plain", { ...make(), [key]: round });
    const target = Object.defineProperty(make(), "alpha", { value: 5, writable: false, enumerable: false, configurable: true });
    show("spread over hidden", Object.assign(Object.create(null), target, { [key]: round }));
}
console.log(lines.join("\n"));
