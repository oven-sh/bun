// A function of the host or of the engine, called with more arguments than the convention has registers for, or with as many as a list holds: the call has its count in a register and some arguments on the stack.
// EVERY ARGUMENT ARRIVES, IN ITS PLACE, WITH `this`; what the function throws goes up through the call; what it calls back runs and may throw; a collection in the middle of it finds the arguments; a list that is too long is refused as plain Bun refuses it.
// The callees come out of a table that text which the build has not seen has shuffled, so no call knows its callee.
const table = new Function("return [Math.max, Math.min, Math.hypot, String.fromCharCode, Array.of, Array.prototype.concat, Array.prototype.push, Array.prototype.unshift, Array.prototype.splice, String.prototype.concat, Object.assign, Reflect.apply, Array.prototype.includes, Math.imul]")();
const [max, min, hypot, fromCharCode, of, concat, push, unshift, splice, concatText, assign, apply, includes, imul] = table;
const lines = [];
const say = (name, value) => lines.push(name + ": " + (Array.isArray(value) ? "[" + value.join(",") + "]" : typeof value === "object" && value ? JSON.stringify(value) : String(value)));

// By count, from none to twelve: the same callee at calls of every width.
say("of 0", of());
say("of 1", of(1));
say("of 2", of(1, 2));
say("of 3", of(1, 2, 3));
say("of 4", of(1, 2, 3, 4));
say("of 5", of(1, 2, 3, 4, 5));
say("of 6", of(1, 2, 3, 4, 5, 6));
say("of 7", of(1, 2, 3, 4, 5, 6, 7));
say("of 8", of(1, 2, 3, 4, 5, 6, 7, 8));
say("of 9", of(1, 2, 3, 4, 5, 6, 7, 8, 9));
say("of 10", of(1, 2, 3, 4, 5, 6, 7, 8, 9, 10));
say("of 11", of(1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11));
say("of 12", of("a", 2.5, null, undefined, true, { n: 1 }.n, [7], -0, 1n, Symbol.iterator.description, "k", 12));
say("max 9", max(3, 1, 4, 1, 5, 9, 2, 6, 5));
say("min 9", min(3, 1, 4, 1, 5, 9, 2, 6, -5));
say("hypot 5", hypot(1, 2, 2, 4, 10));
say("fromCharCode 7", fromCharCode(99, 111, 109, 112, 105, 108, 101));
say("imul of too many", imul(3, 5, 7, 9, 11, 13));

// With a `this`.
const list = [0];
say("push 6", push.call(list, 1, 2, 3, 4, 5, 6));
say("unshift 5", unshift.call(list, "a", "b", "c", "d", "e"));
say("the list", list);
say("splice 7", splice.call(list, 1, 2, "v", "w", "x", "y", "z"));
say("the list", list);
say("concat 6", concat.call([0], 1, [2, 3], 4, [5], 6, [[7]]));
say("concat of texts 8", concatText.call("t", 1, "u", null, undefined, true, 2.5, "v", -0));
say("assign 6", assign({ a: 0 }, { a: 1 }, { b: 2 }, null, { c: 3 }, undefined, { a: 4, d: 5 }));
say("includes of too many", includes.call([1, 2, 3], 3, 0, "x", "y", "z", "w"));

// As many as a list holds.
for (const length of [0, 1, 3, 4, 5, 6, 7, 8, 9, 16, 17, 100, 1000, 20000]) {
    const numbers = Array.from({ length }, (_, i) => (i * 7919) % 1009);
    say("max of a list of " + length, max(...numbers));
    say("max behind two of a list of " + length, max(-1, 2000 - length, ...numbers));
    say("the last of a list of " + length, of(...numbers).at(-1));
    say("apply of a list of " + length, apply(min, null, numbers));
}

// What it throws goes up, from an argument in a register and from one on the stack, and the arguments in front have been asked in their order.
for (const place of [0, 3, 4, 5, 8]) {
    const asked = [];
    const numbers = Array.from({ length: 9 }, (_, i) => ({ valueOf() { asked.push(i); if (i === place) throw new RangeError("the argument at " + i); return i; } }));
    try {
        say("max that throws", max(numbers[0], numbers[1], numbers[2], numbers[3], numbers[4], numbers[5], numbers[6], numbers[7], numbers[8]));
    } catch (error) {
        say("thrown", error.constructor.name + " " + error.message + " behind " + asked.join(""));
    }
}

// What it calls back calls such a function itself, eight deep.
function deep(n) { return { valueOf() { return n ? max(0, 1, 2, 3, 4, deep(n - 1), n) : 40; } }; }
say("eight deep", max(1, 2, 3, 4, 5, 6, deep(8)));

// A collection in the middle finds the arguments that lie on the stack alone.
const fresh = n => ({ valueOf() { for (let i = 0; i < 20000; i++) ({ i, n, text: "t" + i }); if (typeof Bun !== "undefined") Bun.gc(true); return n; } });
say("behind collections", of(fresh(1), fresh(2), fresh(3), fresh(4), fresh(5), fresh(6), fresh(7)).map(Number));
say("max behind collections", max(fresh(1), fresh(2), fresh(3), fresh(4), { valueOf: () => 50 }, fresh(6), { valueOf: () => 7 }));

// In tail position, and as a method of an object that is only known when the program runs.
function inTailPosition(a, b, c, d, e, f) { return max(a, b, c, d, e, f, 0); }
say("in tail position", inTailPosition(1, 2, 3, 9, 5, 6));
const holder = new Function("of", "return { of, name: 'holder' }")(function (...all) { return this.name + all.length; });
holder.native = of;
say("as a method", holder.native(1, 2, 3, 4, 5, 6, 7));
say("a function of the program beside it", holder.of(1, 2, 3, 4, 5, 6, 7));

// A list that is too long.
try {
    say("a list of three million", max(...new Array(3000000).fill(1)));
} catch (error) {
    say("a list of three million", error.constructor.name);
}
console.log(lines.join("\n"));
