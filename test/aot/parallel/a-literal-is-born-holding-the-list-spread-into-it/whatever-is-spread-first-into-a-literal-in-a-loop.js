// In a loop `[...given]`, `[...given, a]`, `[...given, a, b, c]`, `[...given, 1]` and `[...given, ...given]` are made of everything that can be given: lists of every storage, with holes, shared, frozen, long, with names
// of their own, of a class below Array, with an iterator of their own; what is no list; what cannot be spread. Each answer is held against plain Bun's, and neither side sees what is later done to the other.
// STATISTIC: LiteralsBornHoldingTheListSpreadRightBehind >= 5
const turns = JSON.parse("3");
function alone(given) { let last; for (let i = 0; i < turns; i++) last = [...given]; return last; }
function andOne(given, a) { let last; for (let i = 0; i < turns; i++) last = [...given, a]; return last; }
function andThree(given, a, b, c) { let last; for (let i = 0; i < turns; i++) last = [...given, a, b, c]; return last; }
function andWhole(given) { let last; for (let i = 0; i < turns; i++) last = [...given, i]; return last; }
function twice(given) { let last; for (let i = 0; i < turns; i++) last = [...given, ...given]; return last; }
function late(given, make) { let last; for (let i = 0; i < turns; i++) last = [...given, make(given, i)]; return last; }
globalThis.kept = [alone, andOne, andThree, andWhole, twice, late];
const show = list => JSON.stringify(list, (key, value) => value === undefined ? "undefined" : typeof value === "bigint" ? value + "n" : typeof value === "symbol" ? String(value) : Object.is(value, -0) ? "-0" : value !== value ? "NaN" : value) + " " + list.length + " " + Object.keys(list).length + " " + Array.isArray(list) + " " + (Object.getPrototypeOf(list) === Array.prototype);
class Below extends Array {}
class Stepped extends Array { *[Symbol.iterator]() { yield "stepped"; yield this.length; } }
const withHoles = [1, , 3, , , 6], textsWithHoles = ["a", , "c"], fractionsWithHoles = [1.5, , 3.5];
const withName = Object.assign([1, 2, 3], { name: "own" });
const ownIterator = Object.assign([1, 2, 3], { *[Symbol.iterator]() { yield "own"; } });
const sparse = []; sparse[5000] = "far"; sparse.length = 5002;
const slow = [1, 2, 3]; Object.defineProperty(slow, 1, { get() { return "got"; }, enumerable: true, configurable: true });
const long = Array.from({ length: 126 }, (_, i) => i), longer = Array.from({ length: 127 }, (_, i) => "t" + i), longest = Array.from({ length: 400 }, (_, i) => i / 2);
const givens = [
  ["empty", () => []], ["empty by length", () => new Array(0)], ["holes alone", () => new Array(4)], ["whole numbers", () => [1, 2, 3]], ["one", () => [7]], ["fractions", () => [1.5, 2.5, -0, NaN]],
  ["texts", () => ["a", "b", "c", "d"]], ["mixed", () => [1, "two", null, undefined, { three: 3 }, [4], 5n, Symbol.for("six")]], ["whole numbers with holes", () => withHoles], ["texts with holes", () => textsWithHoles],
  ["fractions with holes", () => fractionsWithHoles], ["frozen", () => Object.freeze([1, 2, 3])], ["sealed", () => Object.seal(["a", "b"])], ["with a name", () => withName], ["its own iterator", () => ownIterator],
  ["below Array", () => Below.from([1, 2, 3])], ["stepped by its class", () => Stepped.from([1, 2, 3])], ["sparse", () => sparse], ["a getter at an index", () => slow], ["126", () => long], ["127", () => longer], ["400", () => longest],
  ["keys", () => Object.keys({ a: 1, b: 2, c: 3 })], ["a slice", () => [1, 2, 3, 4, 5].slice(1, 4)], ["out of JSON", () => JSON.parse('[1,"two",[3],{"four":4},null]')], ["a shortened list", () => { const l = [1, 2, 3, 4, 5]; l.length = 2; return l; }],
  ["a lengthened list", () => { const l = [1, 2]; l.length = 5; return l; }], ["shifted", () => { const l = [1, 2, 3, 4]; l.shift(); return l; }], ["a text", () => "héllo"], ["a set", () => new Set([1, "a", 1])],
  ["a map", () => new Map([[1, 2]])], ["bytes", () => new Uint8Array([1, 2, 3])], ["arguments", () => (function () { return arguments; })(1, 2, 3)], ["a generator", () => (function* () { yield 1; yield 2; })()],
  ["a proxy", () => new Proxy([1, 2, 3], {})], ["null", () => null], ["undefined", () => undefined], ["a number", () => 5], ["an object", () => ({ length: 2, 0: "a", 1: "b" })],
];
for (const [name, make] of givens) {
  for (const [label, go] of [["alone", g => alone(g)], ["one", g => andOne(g, "x")], ["three", g => andThree(g, 1, "y", null)], ["whole", g => andWhole(g)], ["twice", g => twice(g)], ["late", g => late(g, (l, i) => { if (Array.isArray(l) && !Object.isFrozen(l) && !Object.isSealed(l) && l.length < 100 && i === 2) l.push("pushed late"); return i; })]]) {
    let said;
    try {
      const given = make(), copy = go(given);
      said = show(copy);
      copy.push("more"); copy[0] = "changed"; copy.length = 1;
      if (Array.isArray(given) && given.length < 100) said += " | " + show(given);
    } catch (error) { said = error.constructor.name + ": " + error.message; }
    console.log(name, "|", label, "|", said.length > 400 ? said.slice(0, 200) + " .. " + said.slice(-120) : said);
  }
}
