function isEmpty(thing) { if (thing.length === 0) return 1; return 0; }
function isOne(thing) { if (thing.length === 1) return 1; return 0; }
function isTwo(thing) { if (2 === thing.length) return 1; return 0; }
function isSeven(thing) { if (thing.length === 7) return 1; return 0; }
function isEight(thing) { if (thing.length === 8) return 1; return 0; }
function isNotEmpty(thing) { if (thing.length !== 0) return 1; return 0; }
function isNotOne(thing) { return thing.length !== 1 ? "other" : "one"; }
function firstOrNothing(thing) { return thing.length === 0 ? undefined : thing[0]; }
const asks = [isEmpty, isOne, isTwo, isSeven, isEight, isNotEmpty, isNotOne, firstOrNothing];
let getterRan = 0;
const sparse = [1]; sparse[100000] = 2; sparse.length = 2;
const holey = [1, , 3]; holey.length = 1;
const grown = []; for (let index = 0; index < 7; index++) grown.push(index + 0.5);
const shrunk = [1, 2, 3, 4, 5, 6, 7, 8, 9]; shrunk.length = 8;
function rope(left, right) { return left + right; }
const tracking = new Uint8Array(new ArrayBuffer(2, { maxByteLength: 16 }));
const things = [
    [], [1], [1, 2], ["a"], [0.5], [0.5, 1.5], [{ }], [undefined, undefined], sparse, holey, grown, shrunk, Object.freeze([1]), new Array(7), new Array(0), Array.from({ length: 2 }),
    "", "a", "ab", rope("abc", "defg"), rope("", ""), rope("long enough to be a rope, ", "is it not"), new String("a"), new String(""),
    new Uint8Array(0), new Uint8Array(1), new Float64Array(2), new Int32Array(7), tracking, new DataView(new ArrayBuffer(1)),
    (function () { return arguments; })(), (function () { return arguments; })(1), (function () { "use strict"; return arguments; })(1, 2),
    function () { }, function (a) { }, (a, b) => a, class { constructor(a, b, c, d, e, f, g) { } },
    { length: 0 }, { length: 1 }, { length: 2 }, { length: -0 }, { length: 1.5 }, { length: NaN }, { length: "0" }, { length: "1" }, { length: 0n }, { length: 1n }, { length: null }, { length: undefined }, { length: true }, { length: [] }, { },
    { get length() { getterRan++; return getterRan % 3; } }, Object.create([1, 2]), Object.create({ length: 1 }), Object.create(null),
    new Proxy([1], { }), new Proxy({ }, { get(target, key) { return key === "length" ? 2 : undefined; } }),
    0, 1, 0.5, true, false, Symbol("made up"), 7n, new Map([[1, 1]]), new Set(), /x/, new Date(0),
];
function said(ask, thing) {
    let sum = "";
    for (let turn = 0; turn < 3; turn++) sum += String(ask(thing)) + ",";
    return sum;
}
for (let round = 0; round < 3; round++) {
    for (let index = 0; index < things.length; index++)
        console.log(round, index, asks.map(ask => said(ask, things[index])).join(" "));
}
console.log(getterRan);
for (const nothing of [null, undefined]) {
    for (const ask of asks) {
        let thrown = 0;
        for (let turn = 0; turn < 40; turn++) { try { ask(nothing); } catch (error) { if (error instanceof TypeError) thrown++; } }
        console.log(String(nothing), ask.name, thrown);
    }
}
tracking.buffer.resize(1);
console.log(asks.map(ask => said(ask, tracking)).join(" "));
tracking.buffer.resize(0);
console.log(asks.map(ask => said(ask, tracking)).join(" "));
const changing = [];
let seen = "";
for (let turn = 0; turn < 12; turn++) { seen += isEmpty(changing) + "" + isOne(changing) + isTwo(changing) + isSeven(changing) + " "; changing.push(turn); }
changing.length = 0;
console.log(seen, isEmpty(changing));
let mixed = 0;
for (let turn = 0; turn < 60000; turn++) { const thing = things[turn % things.length]; mixed += isEmpty(thing) + 2 * isOne(thing) + 4 * isTwo(thing) + 8 * isSeven(thing) + 16 * isNotEmpty(thing); }
console.log(mixed, getterRan);
