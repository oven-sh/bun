// Reads, `in` and hasOwn, by name and by key, of objects of every kind, each asked often enough to pass from the first question to a filed answer, and again behind every change.
const lines = [];
function hide(value) {
    globalThis[process.argv.length > 99 ? process.argv[9] : "hidden"] = value;
    return globalThis.hidden;
}
function show(value) {
    if (typeof value === "function") return "function " + value.name;
    if (typeof value === "symbol") return value.toString();
    if (typeof value === "bigint") return value + "n";
    if (value === null || typeof value !== "object") return String(value);
    return Array.isArray(value) ? "[" + value.map(show).join() + "]" : "{" + Object.keys(value).join() + "}";
}
const keys = ["alpha", "beta", "gamma", "delta", "toString", "constructor", "__proto__", "length", "name", "0", "1", "10", "-1", "1e3", "hasOwnProperty", "then", "prototype", "valueOf"];
function byName(o) {
    return [o.alpha, o.beta, o.gamma, o.delta, o.toString, o.constructor, o.__proto__ === undefined ? "none" : o.__proto__ === null ? "null" : typeof o.__proto__, o.length, o.name, o["0"], o["1"], o["10"], o["-1"], o["1e3"], o.hasOwnProperty, o.then, o.prototype === undefined ? undefined : typeof o.prototype, o.valueOf].map(show).join(" ");
}
function byKey(o) {
    let text = "";
    for (const key of keys) {
        const value = o[key];
        text += (key === "__proto__" || key === "prototype" ? typeof value : show(value)) + " ";
    }
    return text;
}
function inByName(o) {
    return ["alpha" in o, "beta" in o, "gamma" in o, "delta" in o, "toString" in o, "constructor" in o, "__proto__" in o, "length" in o, "name" in o, "0" in o, "1" in o, "10" in o, "then" in o].map(Number).join("");
}
function ownByName(o) {
    return [Object.hasOwn(o, "alpha"), Object.hasOwn(o, "beta"), Object.hasOwn(o, "gamma"), Object.hasOwn(o, "delta"), Object.hasOwn(o, "toString"), Object.hasOwn(o, "constructor"), Object.hasOwn(o, "__proto__"), Object.hasOwn(o, "length"), Object.hasOwn(o, "name"), Object.hasOwn(o, "0"), Object.hasOwn(o, "10")].map(Number).join("");
}
function inByKey(o) {
    let text = "";
    for (const key of keys) text += Number(key in o);
    return text;
}
function ownByKey(o) {
    let text = "";
    for (const key of keys) text += Number(Object.hasOwn(o, key));
    return text;
}
function ask(title, value) {
    const o = hide(value);
    let answers;
    for (let round = 0; round < 7; round++) {
        let now;
        try {
            now = byName(o) + " | " + byKey(o);
            if (o !== null && (typeof o === "object" || typeof o === "function")) now += " | " + inByName(o) + " " + ownByName(o) + " " + inByKey(o) + " " + ownByKey(o);
        } catch (error) {
            now = "throws " + error.constructor.name;
        }
        if (answers === undefined) answers = now;
        else if (answers !== now) answers += "\n    ROUND " + round + " DIFFERS: " + now;
    }
    lines.push(title + ": " + answers);
}
function built(pairs) {
    const o = {};
    for (const [key, value] of pairs) o[key] = value;
    return o;
}

// Ordinary objects.
ask("built key by key", built([["alpha", 1], ["beta", "two"], ["gamma", 3.5]]));
ask("empty", built([]));
ask("undefined as a value", built([["alpha", undefined], ["beta", null]]));
ask("parsed", JSON.parse('{"alpha":1,"delta":{"x":1},"0":"zero","10":"ten"}'));
ask("names that spell indices", built([["0", "zero"], ["1", "one"], ["alpha", 1], ["1e3", "text"], ["-1", "minus"]]));
ask("no prototype", Object.assign(Object.create(null), { alpha: 1, toString: "mine" }));
ask("own __proto__", Object.defineProperty(built([["alpha", 1]]), "__proto__", { value: 5, enumerable: true, configurable: true, writable: true }));
{
    const many = {};
    for (let k = 0; k < 70; k++) many["p" + k] = k;
    many.alpha = "past the cell"; many.beta = 2;
    ask("storage out of line", many);
    for (let k = 70; k < 300; k++) many["p" + k] = k;
    many.gamma = "in a wide table";
    ask("three hundred properties", many);
    for (let k = 0; k < 300; k += 2) delete many["p" + k];
    delete many.beta;
    ask("a dictionary", many);
    many.beta = "again";
    ask("a dictionary that got a name back", many);
}
{
    const o = built([["alpha", 1], ["beta", 2], ["gamma", 3]]);
    ask("before a deletion", o);
    delete o.beta;
    ask("behind a deletion", o);
    o.beta = "back";
    ask("the name is back", o);
    Object.freeze(o);
    ask("frozen", o);
}

// Accessors.
{
    let calls = 0;
    const o = built([["beta", 2]]);
    Object.defineProperty(o, "alpha", { get() { return "got " + ++calls + " " + (this === globalThis.hidden); }, configurable: true, enumerable: true });
    Object.defineProperty(o, "gamma", { set(value) { }, configurable: true });
    Object.defineProperty(o, "delta", { get: Math.random.bind(null).constructor.prototype.toString.bind(function named() { }), configurable: true });
    const first = hide(o);
    lines.push("getters: " + [first.alpha, first.alpha, first.alpha, first.alpha, first.alpha, first.alpha, first.gamma, first.gamma, first.gamma, first.gamma, first.gamma].join(", ") + " " + ("gamma" in first) + " " + typeof first.delta);
    const below = hide(Object.create(o));
    lines.push("getters above: " + [below.alpha, below.alpha, below.alpha, below.alpha, below.alpha, below["alpha"], below.gamma].join(", "));
    Object.defineProperty(o, "alpha", { get() { throw new RangeError("no alpha"); }, configurable: true });
    for (let round = 0; round < 6; round++) {
        try { below.alpha; lines.push("did not throw"); } catch (error) { if (!round) lines.push("a getter that throws: " + error.message); }
    }
    Object.defineProperty(o, "alpha", { value: "data now", configurable: true });
    lines.push("data in its place: " + [below.alpha, below.alpha, below.alpha, below.alpha, below.alpha].join());
}

// Chains.
{
    const top = built([["alpha", "top"], ["delta", "top"]]);
    const middle = Object.create(top); middle.beta = "middle";
    const bottom = Object.create(middle); bottom.gamma = "bottom";
    ask("three levels", bottom);
    middle.alpha = "middle now";
    ask("shadowed in the middle", bottom);
    delete middle.alpha;
    ask("the shadow is gone", bottom);
    Object.setPrototypeOf(middle, null);
    ask("the chain is cut", bottom);
    Object.setPrototypeOf(middle, new Proxy(top, { get(target, key, receiver) { return key === "delta" ? "trapped" : Reflect.get(target, key, receiver); }, has(target, key) { return key === "delta" || key in target; } }));
    ask("a proxy above", bottom);
    Object.setPrototypeOf(middle, [7, 8]);
    ask("an array above", bottom);
    Object.setPrototypeOf(middle, function above() { });
    ask("a function above", bottom);
    Object.setPrototypeOf(middle, new String("xy"));
    ask("a String object above", bottom);
    Object.setPrototypeOf(middle, top);
    ask("the chain is whole again", bottom);
}

// Compiled objects.
{
    const literal = () => ({ alpha: 1, beta: 2.5, gamma: "text", delta: true });
    ask("a literal", literal());
    const extra = literal(); extra.then = "extra"; extra["name"] = "named";
    ask("a literal with extra properties", extra);
    delete extra.then;
    ask("one extra property less", extra);
    const changed = literal(); changed.alpha = "a string now"; changed.beta = { x: 1 }; changed.delta = undefined;
    ask("values that do not fit", changed);
    const deleted = literal(); delete deleted.beta; delete deleted.gamma;
    ask("fields deleted", deleted);
    deleted.beta = "back";
    ask("a field is back", deleted);
    const indexed = literal(); indexed[0] = "zero"; indexed[10] = "ten";
    ask("a literal with elements", indexed);
    const defined = literal();
    Object.defineProperty(defined, "alpha", { get() { return "getter in place of a field"; }, configurable: true });
    Object.defineProperty(defined, "name", { get() { return "extra getter"; }, configurable: true });
    ask("accessors on a literal", defined);
    ask("created from a literal", Object.assign(Object.create(literal()), { then: 1 }));
    const other = literal(); Object.setPrototypeOf(other, { then: "inherited", get name() { return "inherited getter " + (this === globalThis.hidden); } });
    ask("a literal with another prototype", other);
    ask("a literal without a prototype", Object.setPrototypeOf(literal(), null));
    ask("a frozen literal", Object.freeze(literal()));
    ask("own accessors in a literal", { get alpha() { return "a"; }, set beta(value) { }, get gamma() { return this.delta; }, delta: 4 });
    ask("methods in a literal", { alpha() { }, beta: () => 1, gamma: function () { }, async delta() { } });
    ask("a spread", { ...literal(), then: 2, ...built([["name", "spread in"]]) });
}

// Classes.
{
    class Base { alpha = "base field"; beta() { return 1; } get gamma() { return "base getter " + this.alpha; } static delta = "static"; static then() { } }
    class Derived extends Base { delta = "derived field"; beta() { return 2; } get name() { return "derived getter"; } set name(value) { } }
    ask("an instance", new Base());
    ask("an instance of a derived class", new Derived());
    ask("a class", Base);
    ask("a derived class", Derived);
    ask("a prototype object", Derived.prototype);
    const instance = new Derived();
    instance.then = "extra";
    ask("an instance with an extra property", instance);
    Base.prototype.then = "added to the base";
    ask("the base got a member", new Derived());
    Derived.prototype.beta = "replaced";
    ask("a method is replaced", new Derived());
    delete Base.prototype.gamma;
    ask("a getter is deleted", new Derived());
    Object.setPrototypeOf(Derived.prototype, { alpha: "never seen", length: "new chain" });
    ask("another chain", new Derived());
    function Old() { this.alpha = 1; }
    Old.prototype.beta = function () { };
    Old.prototype.gamma = 3;
    ask("an instance of a constructor function", new Old());
    ask("a constructor function", Old);
}

// Objects whose prototype lies in a slot of their own: what text that is evaluated at run time constructs, once its function has been made more than once.
{
    const makeConstructor = new Function("return function Made() { this.alpha = 1; this.gamma = 3; }");
    for (let k = 0; k < 4; k++) {
        const Made = makeConstructor();
        Made.prototype.beta = "beta " + k;
        new Made();
        ask("constructed by evaluated text " + k, new Made());
        ask("created from it " + k, Object.create(new Made()));
    }
}

// A getter in a field of an object that is the prototype of others.
{
    const holder = { get alpha() { return "getter of the holder, this is the heir: " + (this === globalThis.hidden); }, beta: 2, get gamma() { return this.delta; } };
    const heir = Object.create(holder); heir.delta = "of the heir";
    ask("the heir of an object with own accessors", heir);
    const literalHeir = Object.setPrototypeOf({ delta: "of the literal" }, holder);
    ask("a literal as its heir", literalHeir);
    delete holder.alpha;
    ask("the getter is deleted", heir);
    Object.defineProperty(holder, "alpha", { value: "data", configurable: true });
    ask("data in its place", literalHeir);
}

// A getter among the extra properties that no stub can call itself: a function of the host, a bound function, a proxy.
{
    const getters = [Object.getOwnPropertyDescriptor(Map.prototype, "size").get, function () { return "bound: " + this.tag; }.bind({ tag: "kept" }), new Proxy(function () { return "through a proxy"; }, {})];
    for (const getter of getters) {
        const extended = { beta: 2 };
        Object.defineProperty(extended, "alpha", { get: getter, enumerable: true, configurable: true });
        extended.gamma = 3;
        ask("a getter that is not compiled, among extra properties", extended);
        ask("below it", Object.create(extended));
        const ordinary = Object.defineProperty(Object.fromEntries([["beta", 2]]), "alpha", { get: getter, enumerable: true, configurable: true });
        ask("the same in an ordinary object", ordinary);
        ask("below that", Object.create(ordinary));
    }
}

// Everything else.
ask("an array", [5, 6]);
ask("an array with properties", Object.assign([5], { alpha: 1, name: "array" }));
ask("a function", function named(a, b) { });
ask("an arrow function", (a) => a);
ask("a function with properties", Object.assign(function withProperties() { }, { alpha: 1, then: 2 }));
ask("a bound function", function bound(a, b, c) { }.bind(null, 1));
ask("a native function", Math.max);
ask("a string", "text");
ask("a String object", Object.assign(new String("ab"), { alpha: 1 }));
ask("a number", 5);
ask("a boolean", true);
ask("a symbol", Symbol("s"));
ask("a bigint", 5n);
ask("null", null);
ask("undefined", undefined);
ask("a map", Object.assign(new Map(), { alpha: 1 }));
ask("a set", new Set([1]));
ask("a date", Object.assign(new Date(0), { beta: 2 }));
ask("a regular expression", /x/g);
ask("an error", Object.assign(new TypeError("message"), { alpha: 1 }));
ask("a promise", Promise.resolve(1));
ask("a typed array", Object.assign(new Uint8Array([1, 2]), { alpha: 1 }));
ask("a buffer", new ArrayBuffer(8));
ask("arguments", (function () { return arguments; })(1, 2));
ask("a proxy", new Proxy({ alpha: 1 }, {}));
ask("a proxy with traps", new Proxy({}, { get: (target, key) => typeof key === "string" ? "got " + key : undefined, has: () => true, getOwnPropertyDescriptor: () => undefined }));
ask("a generator", (function* () { })());
ask("Math", Math);
ask("JSON", JSON);
ask("globalThis has no such names", { alpha: globalThis.alpha, beta: "beta" in globalThis });
ask("a weak map", new WeakMap());
ask("an iterator", [1][Symbol.iterator]());
ask("a URL", new URL("http://localhost/a?b=1"));
ask("process.versions", { alpha: typeof process.versions.bun, beta: "bun" in process.versions, gamma: process.versions.alpha });

// The collector drops the tables of Structures. What they listed is still there.
{
    const kept = [];
    for (let k = 0; k < 40; k++) kept.push(built([["own" + k, k], ["alpha", k], ["beta", -k]]));
    let sum = 0;
    for (let round = 0; round < 6; round++) {
        if (typeof Bun !== "undefined") Bun.gc(true);
        for (const o of hide(kept)) sum += o.alpha + o.beta + (o.gamma === undefined ? 1 : 0) + ("alpha" in o ? 1 : 0) + (o["own3"] === undefined ? 0 : 1);
    }
    lines.push("behind full collections: " + sum);
}
console.log(lines.join("\n"));
