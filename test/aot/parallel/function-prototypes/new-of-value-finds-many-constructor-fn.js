// `new` of a value that no call site can tell apart: more constructor functions than a site tests for. Each is entered as its own new.target, under another new.target, by a call,
// through Reflect.construct, below a class, bound, with too few and too many arguments, and after its prototype property was exchanged.
"use strict";
const lines = [];
const say = (...parts) => lines.push(parts.join(" "));
const hide = (0, eval)("(value) => value");

function A(x, y) { this.x = x; this.y = y; }
function B(x, y) { this.y = y; this.x = x; this.b = "b"; }
function C(x) { this.x = x; if (x > 2) this.late = x; }
function D(x, y, z) { this.sum = x + y + z; }
function E() { this.count = arguments.length; this.first = arguments[0]; }
function F(...rest) { this.rest = rest.join("|"); }
function G(x) { this.x = x; return { other: x }; }
function H(x) { this.x = x; return x; }
function I(x) { this.x = x; if (x === 3) throw new RangeError("three"); }
function J(x) { this.target = new.target === J ? "own" : typeof new.target; this.x = x; }
function K(x) { if (!(this instanceof K)) return new K(x); this.x = x; }
function L(x) { this.self = this; this.x = x; }
function M(x = 7, y = x + 1) { this.x = x; this.y = y; }
function N(x) { this.inner = new A(x, x + 1); this.x = x; }
A.prototype.name = function () { return "A"; };
B.prototype.name = function () { return "B"; };
C.prototype = { name() { return "C, exchanged at the start"; } };

const table = hide([A, B, C, D, E, F, G, H, I, J, K, L, M, N]);
function describe(object) {
    if (object === null || typeof object !== "object")
        return String(object);
    const parts = [];
    for (const key of Object.keys(object)) {
        const value = object[key];
        parts.push(key + ":" + (value === object ? "itself" : value !== null && typeof value === "object" ? "{" + describe(value) + "}" : String(value)));
    }
    const prototype = Object.getPrototypeOf(object);
    const owner = table.find((candidate) => candidate.prototype === prototype);
    return parts.join() + " <" + (owner ? owner.name : prototype === Object.prototype ? "Object" : "other") + ">";
}
function attempt(title, action) {
    try {
        say(title, describe(action()));
    } catch (error) {
        say(title, "throws", error.constructor.name);
    }
}

for (let round = 0; round < 3; round++) {
    for (const constructor of table) {
        attempt("new " + constructor.name, () => new constructor(round + 1, 2, 3));
        attempt("new without arguments " + constructor.name, () => new constructor());
        attempt("new with many " + constructor.name, () => new constructor(1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12));
    }
}
for (const constructor of table) {
    for (const target of [A, J, class Other {}, function () {}.bind(null), Object, Array]) {
        attempt("construct " + constructor.name + " for " + (target.name || "nameless"), () => {
            const made = Reflect.construct(constructor, [1, 2, 3], hide(target));
            return describe(made) + " " + (Object.getPrototypeOf(made) === target.prototype) + " " + Array.isArray(made);
        });
    }
    attempt("call " + constructor.name, () => {
        const receiver = { was: "here" };
        const answer = constructor.call(receiver, 1, 2, 3);
        return describe(receiver) + " -> " + describe(answer);
    });
    attempt("call without this " + constructor.name, () => constructor(1, 2, 3));
    attempt("bound " + constructor.name, () => new (hide(constructor.bind({ ignored: true }, 5)))(6, 7));
    attempt("below a class " + constructor.name, () => {
        const Below = hide(class Below extends constructor {
            constructor(x) {
                super(x, 2, 3);
                this.below = true;
            }
        });
        const made = new Below(1);
        return describe(made) + " " + (made instanceof constructor) + " " + (made instanceof Below);
    });
    attempt("text " + constructor.name, () => hide((0, eval)("(constructor) => new constructor(1, 2, 3)"))(constructor));
}

// The prototype property is read at each construction.
const first = new table[0](1, 2);
const exchanged = { name() { return "A, exchanged"; } };
table[0].prototype = exchanged;
const second = new table[0](3, 4);
say(first.name(), second.name(), Object.getPrototypeOf(second) === exchanged, first instanceof A, second instanceof A);
table[0].prototype = 5;
say(Object.getPrototypeOf(new table[0](5, 6)) === Object.prototype);
table[0].prototype = null;
say(Object.getPrototypeOf(new table[0](5, 6)) === Object.prototype);
Object.defineProperty(table[1], "prototype", { value: exchanged, writable: false });
say(new table[1](1, 2).name());

// A function that is made many times: each closure has a prototype object of its own.
function make(tag) {
    function Made(x) { this.x = x; this.tag = tag; }
    Made.prototype.tagOfPrototype = tag;
    return Made;
}
const made = hide([make("p"), make("q"), make("r")]);
for (let index = 0; index < 9; index++) {
    const object = new made[index % 3](index);
    say(object.x, object.tag, object.tagOfPrototype, object instanceof made[index % 3], object instanceof made[(index + 1) % 3]);
}

// A setter above the object sees the store of the constructor.
Object.defineProperty(D.prototype, "sum", { set(value) { say("set", value); }, get() { return "got"; }, configurable: true });
attempt("a setter above", () => new table[3](1, 2, 3));
delete D.prototype.sum;
attempt("and gone", () => new table[3](1, 2, 3));
Object.freeze(L.prototype);
attempt("a frozen prototype object", () => new table[11](1));

// Deep recursion through `new` ends with a RangeError and nothing else.
function Deep(depth) { this.depth = depth; this.next = new deep[0](depth + 1); }
const deep = hide([Deep]);
try {
    new deep[0](0);
} catch (error) {
    say("deep", error instanceof RangeError);
}

let sum = 0;
for (let index = 0; index < 200000; index++) {
    const constructor = table[index % 4];
    const object = new constructor(index & 7, 1, 2);
    sum += (object.x | 0) + (object.sum | 0);
}
say("sum", sum);
console.log(lines.join("\n"));
