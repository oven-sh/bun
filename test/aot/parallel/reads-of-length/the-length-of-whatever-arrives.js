const report = (value) => console.log(String(value));
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
        new Uint8Array(4), new Float64Array(2), new Uint8Array(8).subarray(3), new Bytes(7), tracking, resized, detached, withOwnLength, withName, new DataView(new ArrayBuffer(4)), Buffer.from("abc"), Buffer.alloc(5), Buffer.from("abcdef").subarray(2), Buffer.concat([Buffer.from("ab"), Buffer.from("c")]), new TextEncoder().encode("four"),
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
