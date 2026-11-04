// `const [a, b] = x` in a loop: the code of the one operation reads a list as lists are made in line where it holds boxed values and as many as are taken. Whatever else comes goes to the stub or the run time:
// a shorter list, a hole, storage of doubles or without a form, a list that is no longer as made, what is no list, what cannot be iterated.
const say = value => console.log(String(value));
const show = v => (Object.is(v, -0) ? "-0" : typeof v === "string" ? "'" + v + "'" : String(v));
function tell(f) { try { say(f()); } catch (thrown) { say(thrown.name); } }
function two(all) { let s = ""; for (let i = 0; i < all.length; i++) { const [a, b] = all[i]; s += show(a) + "," + show(b) + ";"; } return s; }
function three(all) { let s = ""; for (const x of all) { const [a, , c] = x; s += show(a) + "," + show(c) + ";"; } return s; }
function defaults(all) { let s = ""; for (const x of all) { const [a = "A", b = "B"] = x; s += show(a) + "," + show(b) + ";"; } return s; }
function one(all) { let s = ""; for (const [a] of all) s += show(a) + ";"; return s; }
function assigned(all) { let a, b, s = ""; for (const x of all) { [a, b] = x; s += show(a) + "," + show(b) + ";"; [a, b] = [b, a]; s += show(a) + ";"; } return s; }
function nested(all) { let s = ""; for (const [[a, b], c] of all) s += show(a) + show(b) + show(c) + ";"; return s; }
function summed(all) { let sum = 0; for (let i = 0; i < all.length; i++) { const [a, b] = all[i]; sum += a + b; } return sum; }
let closed = 0;
const own = n => ({ [Symbol.iterator]() { let i = 0; return { next: () => ({ done: i >= n, value: i++ }), return() { closed++; return {}; } }; } });
function* made(n) { try { for (let i = 0; i < n; i++) yield i * i; } finally { closed += 10; } }
class Reversed extends Array { *[Symbol.iterator]() { for (let i = this.length; i--;) yield this[i]; } }
const ownWay = [1, 2, 3]; ownWay[Symbol.iterator] = function* () { yield "own"; };
const below = [7, 8]; Object.setPrototypeOf(below, { 1: "never seen", [Symbol.iterator]: function* () { yield "below"; } });
const holesAbove = [1, , 3]; Object.setPrototypeOf(holesAbove, { 1: "above", __proto__: Array.prototype });
const getter = [1, 2, 3]; Object.defineProperty(getter, 1, { get() { return "got"; } });
const far = [1, 2, 3]; far[70000] = 4;
const named = [1, 2]; named.extra = "no element";
const kinds = () => [[1, 2], [1, 2, 3], [1], [], [1.5, 2.5], [1.5], ["a", "b", "c"], [, 2], [1, , 3], [, , ,], new Array(3), [undefined, null], [0, -0], [{ toString() { return "o"; } }, []], Object.freeze([4, 5]),
    far, named, getter, holesAbove, ownWay, below, Reversed.from([1, 2, 3]), new Set([1, 2, 2, 3]), new Map([["k", "v"], ["l", "w"]]), "text", "\u{1F600}x", new Uint8Array([9, 8, 7]), own(1), own(5), made(1), made(5),
    (function () { return arguments; })(1, 2, 3)];
[two, three, defaults, one, assigned].forEach(f => { tell(() => f(kinds())); kinds().forEach(x => tell(() => f([x, [1, 2], x]))); });
say(closed);
[5, null, undefined, {}, true, Symbol.iterator, () => 1].forEach(x => [two, three, defaults, one, assigned].forEach(f => tell(() => f([[1, 2], x]))));
tell(() => nested([[[1, 2], 3], [["a"], "b"], ["xy", "z"], [new Set([1]), 2]]));
tell(() => nested([[[1, 2], 3], [5, 6]]));
const many = []; for (let i = 0; i < 5000; i++) many.push(i % 11 ? [i, i + 1] : i % 2 ? [i + 0.5, 1] : [i]);
tell(() => summed(many));
say("end");
