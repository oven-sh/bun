// answers: with-library
// # `value.length` off a value of which nothing is known is one call of five bytes: the thunk brings the receiver and the name. No place of answers is kept for it: what a list, a text or a view as its class
// # made it answers needs none. A list whose storage is contiguous is answered in front of the thunk's moves; the stub tells the four plain storages by one test, and their lengths fit 31 bits, so no sign is asked.
// # Sparse storage (lengths up to 4294967295), views that are not as made, resized or detached, an own `length`, getters, proxies, what inherits from a list, primitives: the ways onward.
// # f1 = lengthOf, f2 = ofThree
// # RUN(ONE): bytes f1:Body mechanisms=all-Inlining
// # ONE: relocation {{*}} Call ArgumentThunk 0
// # ONE-NOT: Call Stub Read
// # ONE: argument thunk 0 GetLengthAtSite immediate mention
// # RUN(THREE): bytes f2:Body mechanisms=all-Inlining
// # THREE-NOT: Call Stub Read
// # THREE: argument thunk {{*}} GetLengthAtSite
// # THREE: argument thunk {{*}} GetLengthAtSite
// # THREE: argument thunk {{*}} GetLengthAtSite
// # At the end the shell runs the same text itself: every answer is the same.
// # RUN: run-in-shell $SHELL
// # CHECK: 82 of 82 of 82
// # CHECK-NEXT: exited with 0
function lengthOf(value) { return value.length; }
function ofThree(first, second, third) { return first.length + ":" + second.length + ":" + third.length; }
function show(value) {
    try {
        const length = lengthOf(value);
        return typeof length + " " + String(length);
    } catch (error) {
        return error.constructor.name;
    }
}

class Row extends Array { }
class Bytes extends Uint8Array { }
class Odd extends Array { }
Object.defineProperty(Odd.prototype, "50", { get() { return "above"; }, configurable: true });

function make() {
    const grown = []; for (let i = 0; i < 5; i++) grown.push({ i });
    const numbers = []; for (let i = 0; i < 4; i++) numbers.push(i);
    const fractions = []; for (let i = 0; i < 3; i++) fractions.push(i + 0.5);
    const sparse = []; sparse[200000] = 1;
    const widest = []; widest.length = 4294967295;
    const half = []; half.length = 2147483648;
    const belowHalf = []; belowHalf.length = 2147483647;
    const shrunk = [{}, {}, {}]; shrunk.length = 1;
    const emptied = [{}, {}]; emptied.length = 0;
    const named = [{}, {}]; named.extra = 1;
    const rope = "ab" + String(grown.length) + "cdefghijklmnopqrstuvwxyz" + String(numbers.length);
    const tracking = new Uint8Array(new ArrayBuffer(8, { maxByteLength: 16 }));
    const resized = new Uint8Array(new ArrayBuffer(8, { maxByteLength: 16 })); resized.buffer.resize(12);
    const detached = new Uint8Array(6); detached.buffer.transfer();
    const withOwnLength = new Uint8Array(2); Object.defineProperty(withOwnLength, "length", { value: "own" });
    const withName = new Uint8Array(3); withName.extra = 1;
    return [
        [], [1, 2, 3], [1.5, 2.5], ["a", {}], [, , 1], grown, numbers, fractions, new Array(5), new Array(70000), sparse, widest, half, belowHalf, shrunk, emptied, named,
        Object.freeze([{}, {}]), Object.seal([1]), Object.preventExtensions([1.5]), new Row(3), Row.from([1, 2]), new Odd(2), Odd.from([{}, {}, {}]), Object.create([1, 2, 3]), Object.create({ length: 9 }),
        "", "text", rope, new String("boxed"),
        new Uint8Array(4), new Float64Array(2), new Uint8Array(8).subarray(3), new Bytes(7), tracking, resized, detached, withOwnLength, withName, new DataView(new ArrayBuffer(4)),
        (function () { return arguments; })(1, 2), function (a, b) { }, (a) => a, { length: "field" }, { get length() { return "getter"; } }, { },
        new Proxy([1, 2], { }), new Proxy({ }, { get: () => "trap" }), new Map([[1, 2]]), new Set([1]),
        5, 0.5, true, Symbol("s"), 10n, null, undefined,
    ];
}

for (let round = 0; round < 3; round++) {
    const things = make();
    report(things.map(show).join(" | "));
    const lists = things.filter(Array.isArray);
    for (let i = 0; i + 2 < lists.length; i++)
        report(ofThree(lists[i], lists[i + 1], lists[i + 2]));
    report(ofThree("ab", things[5], new Uint8Array(1)) + " " + ofThree(things[5], { length: 1.5 }, things[3]));
}

const list = [{}, {}];
report(lengthOf(list)); list.push({}); report(lengthOf(list)); list.pop(); list.pop(); report(lengthOf(list)); list.length = 70; report(lengthOf(list)); list[100000] = 1; report(lengthOf(list)); list.length = 0; report(lengthOf(list));

report("end");
