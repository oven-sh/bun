// `key in object` under keys that are new strings each time and spell names the program also writes. The first test under a key makes its text a name. The tests after it are answered by what is known for the structure and the name, and every change that a test by name sees is seen here. The last line counts the visits to the run time.
// Env: JSC_aotCountsPath=/dev/null
const count = typeof aotOperationCount === "function" ? aotOperationCount : () => 0;
const visits = () => count("operationAOTInByValGeneric") + count("operationAOTInByValAndCache");

const anew = names => names.map(name => name.slice(0, 1) + name.slice(1));
const keysAnew = () => anew(["alpha", "beta", "gamma", "missing", "inherited", "computed"]);
const has = (object, key) => key in object;
const letter = answer => answer ? "y" : "n";
const thrice = (object, key) => letter(has(object, key)) + letter(has(object, key)) + letter(has(object, key));
const testAll = object => keysAnew().map(key => thrice(object, key)).join(" ");

const grandparent = {};
const parent = Object.setPrototypeOf({ inherited: "from the parent", get computed() { return "computed for " + this.alpha; } }, grandparent);
const make = n => { const made = Object.create(parent); made.alpha = n; made.beta = n + 1; made.gamma = n + 2; return made; };

for (let i = 0; i < 40; i++) testAll(make(i));
console.log("own, absent, inherited, computed:", testAll(make(100)));

const shadowing = make(1);
shadowing.inherited = "its own";
shadowing.missing = undefined;
console.log("its own in front of the parent's, and undefined as a value:", testAll(shadowing));
console.log("another object is not touched by it:", testAll(make(2)));

parent.missing = "no longer missing";
console.log("the parent gains a name:", testAll(make(3)));
delete parent.missing;
console.log("and loses it again:", testAll(make(4)));
grandparent.missing = "in the grandparent";
console.log("the grandparent gains it:", testAll(make(5)));
delete grandparent.missing;
console.log("and loses it:", testAll(make(6)));
delete parent.inherited;
console.log("the parent loses a name:", testAll(make(7)));
parent.inherited = "back";
console.log("and has it back:", testAll(make(8)));
delete parent.computed;
console.log("the getter is gone:", testAll(make(9)));
Object.defineProperty(parent, "computed", { value: "a value now", configurable: true, writable: true });
console.log("a value in its place:", testAll(make(10)));
Object.defineProperty(parent, "computed", { get() { return "computed for " + this.alpha; }, configurable: true });

const moved = make(11);
for (let i = 0; i < 40; i++) testAll(moved);
Object.setPrototypeOf(moved, { missing: "in a new parent" });
console.log("an object given a new parent:", testAll(moved));
Object.setPrototypeOf(moved, null);
console.log("and none:", testAll(moved));

const shrinking = make(12);
for (let i = 0; i < 40; i++) testAll(shrinking);
delete shrinking.beta;
console.log("an own name deleted:", testAll(shrinking));
shrinking.beta = "again";
console.log("and set again:", testAll(shrinking));

const large = {};
for (let i = 0; i < 200; i++) large["name" + i] = i;
for (let i = 0; i < 150; i++) delete large["name" + i];
large.alpha = "in a large object";
for (let i = 0; i < 40; i++) testAll(large);
console.log("an object with many names come and gone:", testAll(large));
large.beta = "added";
delete large.alpha;
console.log("after one more of each:", testAll(large));

const otherKeys = () => anew(["length", "name", "constructor", "__proto__", "10", "-1", "1.5", "prototype", "byteLength", "size"]);
const testOthers = object => otherKeys().map(key => key + "=" + thrice(object, key)).join(" ");
function named(a, b) { return a + b; }
class Point { constructor(x) { this.alpha = x; this.beta = -x; } get gamma() { return this.alpha * 2; } }
class Sparse { alpha; beta = 1; }
const bases = {
    array: () => [7, 8, 9], subclassOfArray: () => new (class extends Array {})(3), function: () => named, bound: () => named.bind(null), wrapper: () => new String("text"),
    typed: () => new Uint8Array(14), map: () => new Map(), arguments: () => (function () { return arguments; })(5, 6), instance: () => new Point(4), sparse: () => new Sparse(),
    withoutParent: () => Object.create(null), frozen: () => Object.freeze({ 10: "ten", length: "frozen" }),
    proxy: () => new Proxy({}, { has(target, key) { return String(key).length > 5; } }),
    underProxy: () => Object.create(new Proxy({}, { has(target, key) { return String(key).length < 6; } })),
};
for (const [label, base] of Object.entries(bases)) {
    for (let i = 0; i < 12; i++) { testOthers(base()); testAll(base()); }
    console.log(label + ":", testOthers(base()), "|", testAll(base()));
}
for (const notAnObject of [null, undefined, 5, "text", Symbol.iterator, true]) {
    for (const key of anew(["length", "alpha"])) {
        for (let i = 0; i < 3; i++) {
            try { has(notAnObject, key); console.log("no error"); } catch (error) { console.log(error instanceof TypeError); }
        }
    }
}
console.log("a string is read by the names it is not tested for:", anew(["length"]).map(key => "text"[key] + "text"[key]).join());

const tested = [make(1), { alpha: 1, beta: 2, gamma: 3, inherited: 4 }, { gamma: 1, alpha: 2 }, Object.assign(Object.create(null), { missing: 1 })];
let total = 0;
const round = () => {
    for (const key of keysAnew()) {
        for (const object of tested) {
            if (has(object, key)) total++;
        }
    }
};
for (let i = 0; i < 300; i++) round();
const before = visits();
for (let i = 0; i < 1000; i++) round();
const asked = visits() - before;
console.log("the sum:", total);
console.log("the run time is asked at most 8400 times for 24000 tests under 6000 keys made anew:", typeof aotOperationCount !== "function" || asked <= 8400);
