// A loop that reads a list by index has tested once, in front of the loop, that the list is as lists are made. A turn may end that: then what the list lacks at an index is looked for above it,
// a getter under an index runs, and storage of another kind is read like any other. Each list comes in every kind of storage, and each turn changes something that is still to come.
const say = value => console.log(String(value));
function tell(f) { try { say(f()); } catch (thrown) { say(thrown.name); } }
const show = v => (Object.is(v, -0) ? "-0" : typeof v === "string" ? "'" + v + "'" : String(v));
function each(x, turn) { let s = ""; let n = 0; for (const v of x) { s += show(v) + ","; turn(x, n++); } return s; }
function twice(x, turn) { let s = ""; for (let round = 0; round < 2; round++) { let n = 0; for (const v of x) { s += show(v) + ","; turn(x, n++, round); } s += "|"; } return s; }
function summed(x, turn) { let sum = 0; let n = 0; for (const v of x) { sum += v === undefined ? 100 : v; turn(x, n++); } return sum; }
const lists = () => [
    [1, 2, 3, 4], [1.5, 2.5, 3.5, 4.5], ["a", "b", "c", "d"], [1, , 3, ,], [1.5, , 3.5, ,], ["a", , "c", ,], [, , , ,], new Array(4), [0, -0, NaN, 2 ** 31], [{ toString() { return "o"; } }, null, undefined, true],
    (() => { const far = [1, 2, 3, 4]; far[70000] = 5; far.length = 4; return far; })(),
    (() => { const slow = [1, , 3, ,]; Object.defineProperty(slow, 0, { value: 1, writable: false, enumerable: true, configurable: true }); return slow; })(),
    Object.freeze([1, , 3, 4]), Object.seal(["a", "b", , "d"]),
];
const turns = [
    () => { },
    (x, n) => { if (!n) Object.setPrototypeOf(x, { 1: "above", __proto__: Array.prototype }); },
    (x, n) => { if (!n) Object.setPrototypeOf(x, { 3: "above", __proto__: Array.prototype }); },
    (x, n) => { if (!n) Object.setPrototypeOf(x, { __proto__: { 2: "far above", __proto__: Array.prototype } }); },
    (x, n) => { if (!n) delete x[1]; },
    (x, n) => { if (!n) { delete x[2]; Object.setPrototypeOf(x, { get 2() { return "got above"; }, __proto__: Array.prototype }); } },
    (x, n) => { if (n === 1) Object.setPrototypeOf(x, new Proxy(Array.prototype, { get: (t, k, r) => (k === "3" ? "trapped" : Reflect.get(t, k, r)) })); },
    (x, n) => { if (!n && Object.isExtensible(x)) Object.defineProperty(x, 2, { get() { return "got"; }, configurable: true }); },
    (x, n) => { if (!n) Object.setPrototypeOf(x, { 1: "other", 3: "other", __proto__: Array.prototype }); },
    (x, n) => { if (!n && !Object.isFrozen(x)) x[1] = 0.5; },
    (x, n) => { if (!n && !Object.isFrozen(x)) x[1] = "text"; },
    (x, n) => { if (!n && Object.isExtensible(x)) x[90000] = "far"; if (n === 1 && Object.isExtensible(x)) x.length = 4; },
    (x, n) => { if (!n && !Object.isFrozen(x) && !Object.isSealed(x)) x.length = 2; },
    (x, n) => { if (n < 2 && Object.isExtensible(x)) x.push(n); },
    (x, n) => { if (!n && Object.isExtensible(x)) x.name = "named"; },
    (x, n) => { if (!n && Object.isExtensible(x)) x[Symbol.iterator] = function* () { yield "late"; }; },
    (x, n) => { if (n === 1 && !Object.isFrozen(x) && !Object.isSealed(x)) x.shift(); },
    (x, n) => { if (n === 1 && !Object.isFrozen(x)) x.reverse(); },
    (x, n) => { if (!n) Object.freeze(x); },
];
turns.forEach(turn => lists().forEach(x => tell(() => each(x, turn))));
turns.forEach(turn => lists().forEach(x => tell(() => twice(x, turn))));
turns.slice(0, 7).forEach(turn => [[1, 2, 3, 4], [1.5, 2.5, 3.5, 4.5], [1, , 3, ,], [1.5, , 3.5, ,]].forEach(x => tell(() => summed(x, turn))));
const long = []; for (let i = 0; i < 3000; i++) long.push(i % 7 ? i : i + 0.5);
tell(() => summed(long, () => { }));
tell(() => summed(long, (x, n) => { if (n === 1500) delete x[2000]; }));
tell(() => summed(long, (x, n) => { if (n === 1500) { delete x[2001]; Object.setPrototypeOf(x, { 2001: 1e6, __proto__: Array.prototype }); } }));
say("end");
