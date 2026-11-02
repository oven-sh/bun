// `object[key] = value` under keys that are new strings each time and spell names the program also writes. The first store under a key makes its text a name. The stores after it go the way of a store by name: they replace, add, call setters, fail on what is read-only, and see every change above the object. The last line counts the visits to the run time.
// Env: JSC_aotCountsPath=/dev/null
const count = typeof aotOperationCount === "function" ? aotOperationCount : () => 0;
const visits = () => count("operationAOTPutByValGeneric") + count("operationAOTPutByValAndCache") + count("operationAOTPutByValAndCacheSloppy") + count("operationAOTPutByVal");

const anew = names => names.map(name => name.slice(0, 1) + name.slice(1));
const keysAnew = () => anew(["alpha", "beta", "gamma", "added", "inherited", "computed"]);
const store = (object, key, value) => { object[key] = value; };
const attempt = (object, key, value) => { try { store(object, key, value); return "stored"; } catch (error) { return error.constructor.name; } };
const show = object => Reflect.ownKeys(object).map(key => { const d = Object.getOwnPropertyDescriptor(object, key); return String(key) + ":" + ("value" in d ? String(d.value) : "accessor") + (d.writable ? "w" : "") + (d.enumerable ? "e" : "") + (d.configurable ? "c" : ""); }).join(",");
const warm = { alpha: 0 };
const calls = [];
// The store to `warm` is the first under each key, so the two to the object find a key whose text is a name.
const storeAll = (object, value) => keysAnew().map(key => { store(warm, key, 0); return attempt(object, key, value) + "," + attempt(object, key, value + 1); }).join(" ") + " | " + show(object) + " | " + calls.splice(0).join(";");

const grandparent = {};
const parent = Object.setPrototypeOf({ inherited: "from the parent", get computed() { return "computed"; }, set computed(value) { calls.push("setter " + value + " for " + this.alpha); } }, grandparent);
const make = n => { const made = Object.create(parent); made.alpha = n; made.beta = n + 1; made.gamma = n + 2; return made; };

for (let i = 0; i < 40; i++) storeAll(make(i), i);
console.log("replaced, added, in front of the parent's, through the setter:", storeAll(make(100), 1));
console.log("the parent keeps its value:", parent.inherited, Object.keys(parent).join());

Object.defineProperty(parent, "added", { set(value) { calls.push("a setter above " + value); }, configurable: true });
console.log("the parent gains a setter:", storeAll(make(1), 2));
Object.defineProperty(parent, "added", { value: "fixed above", writable: false, configurable: true });
console.log("read-only above:", storeAll(make(2), 3));
delete parent.added;
console.log("nothing above again:", storeAll(make(3), 4));
Object.defineProperty(grandparent, "added", { set(value) { calls.push("a setter far above " + value); }, configurable: true });
console.log("the grandparent gains a setter:", storeAll(make(4), 5));
delete grandparent.added;
console.log("and loses it:", storeAll(make(5), 6));
Object.defineProperty(parent, "computed", { get() { return "no setter"; }, configurable: true });
console.log("a getter alone:", storeAll(make(6), 7));
Object.defineProperty(parent, "computed", { get() { return "computed"; }, set(value) { calls.push("setter " + value + " for " + this.alpha); }, configurable: true });

const fixed = () => Object.defineProperty(make(7), "beta", { value: "fixed", writable: false, enumerable: true, configurable: true });
for (let i = 0; i < 12; i++) storeAll(fixed(), i);
console.log("its own, read-only:", storeAll(fixed(), 8));
const withSetter = () => Object.defineProperty(make(8), "gamma", { get() { return 0; }, set(value) { calls.push("own setter " + value); }, enumerable: true, configurable: true });
for (let i = 0; i < 12; i++) storeAll(withSetter(), i);
console.log("its own setter:", storeAll(withSetter(), 9));
for (const close of [Object.preventExtensions, Object.seal, Object.freeze]) {
    for (let i = 0; i < 12; i++) storeAll(close(make(9)), i);
    console.log(close.name + ":", storeAll(close(make(9)), 10));
}

const moved = make(10);
Object.setPrototypeOf(moved, { set added(value) { calls.push("the setter of a new parent " + value); } });
console.log("an object given a new parent:", storeAll(moved, 11));
Object.setPrototypeOf(moved, null);
console.log("and none:", storeAll(moved, 12));

const large = {};
for (let i = 0; i < 200; i++) large["name" + i] = i;
for (let i = 0; i < 199; i++) delete large["name" + i];
for (let i = 0; i < 12; i++) storeAll(large, i);
console.log("an object with many names come and gone:", storeAll(large, 13));

const otherKeys = () => anew(["length", "name", "prototype", "__proto__", "10", "-1", "1.5", "byteLength"]);
const storeOthers = (object, value) => otherKeys().map(key => { store(warm, key, 0); return key + "=" + attempt(object, key, value) + "," + attempt(object, key, value); }).join(" ");
const describe = object => { try { return show(object); } catch (error) { return error.constructor.name; } };
function named(a, b) { return a + b; }
class Point { constructor(x) { this.alpha = x; this.beta = -x; } set gamma(value) { calls.push("the setter of the class " + value); } }
const bases = {
    array: () => [7, 8, 9], function: () => function () {}, wrapper: () => new String("text"), typed: () => new Uint8Array(12), map: () => new Map(),
    arguments: () => (function () { return arguments; })(5, 6), instance: () => new Point(4), withoutParent: () => Object.create(null),
    proxy: () => new Proxy({}, { set(target, key, value) { calls.push("trapped " + String(key)); return String(key).length > 4; } }),
    underProxy: () => Object.create(new Proxy({}, { set(target, key, value, receiver) { calls.push("trapped above " + String(key)); return Reflect.defineProperty(receiver, key, { value, writable: true, enumerable: true, configurable: true }); } })),
};
for (const [label, base] of Object.entries(bases)) {
    for (let i = 0; i < 12; i++) { storeOthers(base(), 2); storeAll(base(), i); }
    const forOthers = base();
    console.log(label + ":", storeOthers(forOthers, 2), "|", describe(forOthers), "|", calls.splice(0).join(";"), "|", storeAll(base(), 14));
}
for (const primitive of [null, undefined, 5, "text", true]) {
    for (const key of anew(["length", "alpha"])) {
        store(warm, key, 0);
        console.log(String(primitive), key, attempt(primitive, key, 1), attempt(primitive, key, 2));
    }
}
console.log(named.name, named.length, Object.getPrototypeOf(warm) === Object.prototype, show(warm));

let total = 0;
const round = turn => {
    const targets = [Object.create(null), make(1), { alpha: 1, beta: 2, gamma: 3, inherited: 4 }, { gamma: 1, alpha: 2 }];
    for (const key of keysAnew()) {
        for (const target of targets) store(target, key, turn);
    }
    for (const target of targets) total += target.alpha + target.added + Object.keys(target).length;
};
for (let i = 0; i < 300; i++) round(i);
calls.length = 0;
const before = visits();
for (let i = 0; i < 1000; i++) round(i);
const asked = visits() - before;
console.log("the sum:", total, calls.length);
console.log("the run time is asked at most 8400 times for 24000 stores under 6000 keys made anew:", typeof aotOperationCount !== "function" || asked <= 8400);
