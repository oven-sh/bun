// `name in object` and hasOwn on ordinary objects that are built key by key, asked for many names, and changed in every way that changes the answer.
const names = ["alpha", "beta", "gamma", "delta", "epsilon", "zeta", "eta", "theta", "iota", "kappa", "lambda", "mu"];
function build(mask) {
    const object = {};
    for (let i = 0; i < names.length; i++) if (mask & (1 << i)) object[names[i]] = i;
    return object;
}
function ask(object) {
    let answer = 0;
    if ("alpha" in object) answer |= 1;
    if ("beta" in object) answer |= 2;
    if ("gamma" in object) answer |= 4;
    if ("delta" in object) answer |= 8;
    if ("epsilon" in object) answer |= 16;
    if ("zeta" in object) answer |= 32;
    if ("eta" in object) answer |= 64;
    if ("theta" in object) answer |= 128;
    if ("iota" in object) answer |= 256;
    if ("kappa" in object) answer |= 512;
    if ("lambda" in object) answer |= 1024;
    if ("mu" in object) answer |= 2048;
    return answer;
}
function askOwn(object) {
    let answer = 0;
    if (Object.hasOwn(object, "alpha")) answer |= 1;
    if (Object.hasOwn(object, "beta")) answer |= 2;
    if (object.hasOwnProperty("gamma")) answer |= 4;
    if (Object.hasOwn(object, "toString")) answer |= 8;
    return answer;
}
function askInherited(object) {
    let answer = 0;
    if ("toString" in object) answer |= 1;
    if ("hasOwnProperty" in object) answer |= 2;
    if ("constructor" in object) answer |= 4;
    if ("__proto__" in object) answer |= 8;
    if ("0" in object) answer |= 32;
    if ("1" in object) answer |= 64;
    if (Symbol.iterator in object) answer |= 128;
    if (Symbol.toStringTag in object) answer |= 256;
    return answer;
}
const lines = [];
function say(what, value) { lines.push(what + " " + value); }

let sum = 0;
for (let round = 0; round < 3; round++) for (let mask = 0; mask < 4096; mask += 37) { const got = ask(build(mask)); if (got !== mask) say("WRONG", mask + " " + got); sum += got; }
say("masks", sum);

const subject = build(5);
say("as built", ask(subject) + " " + askOwn(subject) + " " + askInherited(subject));
subject.beta = 1;
say("a name added", ask(subject) + " " + askOwn(subject));
delete subject.alpha;
say("a name deleted", ask(subject) + " " + askOwn(subject));
subject[0] = "zero";
say("an index added", askInherited(subject));
subject[Symbol.iterator] = 1;
say("a symbol added", askInherited(subject));

const child = build(1);
say("before another prototype", ask(child));
Object.setPrototypeOf(child, { mu: 1, get lambda() { return 1; } });
say("another prototype", ask(child) + " " + askOwn(child));
Object.setPrototypeOf(child, null);
say("no prototype", ask(child) + " " + askInherited(child));
Object.setPrototypeOf(child, new Proxy({}, { has(target, key) { return key === "theta"; } }));
say("a proxy above", ask(child));

const frozen = Object.freeze(build(6));
say("frozen", ask(frozen) + " " + askOwn(frozen));
const many = {};
for (let i = 0; i < 200; i++) many["k" + i] = i;
many.gamma = 1;
say("many names", ask(many));
for (let i = 0; i < 150; i++) delete many["k" + i];
many.delta = 1;
say("a dictionary", ask(many));
delete many.gamma;
say("a dictionary less one", ask(many));
const accessor = Object.defineProperty(build(0), "eta", { get() { return 1; }, enumerable: false });
say("an accessor", ask(accessor));
say("an array, a function, a class", ask([]) + " " + ask(function alpha() {}) + " " + ask(class { static beta = 1; }) + " " + askInherited([1]));
say("made by Object.create", ask(Object.create({ iota: 1 })) + " " + ask(Object.create(null)) + " " + ask(Object.create(Object.prototype, { zeta: { value: 1 } })));
say("parsed", ask(JSON.parse('{"alpha":1,"mu":2}')) + " " + ask(JSON.parse("{}")));
if (typeof Bun !== "undefined") {
    for (let round = 0; round < 4; round++) { Bun.gc(true); let total = 0; for (let mask = 1; mask < 4096; mask += 101) total += ask(build(mask)) === mask ? 1 : 1000000; say("behind a collection", total); }
}
try { "alpha" in 5; } catch (error) { say("a number", error.constructor.name); }
try { ask(undefined); } catch (error) { say("undefined", error.constructor.name); }
console.log(lines.join("\n"));
