// A frozen list of pairs of numbers comes through a function that is also handed a value nobody knows, so the analysis of the whole program knows nothing of the list, of what `.map(` calls, of
// what the arrow is handed, or of `low` and `high`: `low.toString(16)` is a call of something unknown and `high > low` a comparison of any two values. The walk that works a pattern's text out
// has the numbers in sight: the built-in objects are read-only in a compiled program, so a number's toString is Number.prototype's. And what it has worked out for `low.toString(16)` it remembers
// while that pair is the one being mapped, so that the comparison, which may follow few values, finds both numbers. In a large program one pattern made so was nine tenths of all that was
// interpreted. (The calls are still warned of: an arm for a receiver that is no number stays unknown.)
// COUNTER: RegExpsCreatedWithoutRecord = 0
// COUNTER: RegExpsCompiledToBytecode = 0
// COUNTER: RegExpMatchesInterpreted = 0
// COUNTER: RegExpPredictedTextsGivenCode = 2
function keep(value, depth) {
  if (depth > 0) return keep(value, depth - 1);
  return value;
}
const depth = process.argv.length % 3;
const others = [keep(JSON.parse(process.argv[9] ?? "null"), depth)];
const A = 0x41, B = 0x5a, C = 0x5f, D = 0x5f, E = 0x100, F = 0x17f;
const RADIX = 16;
const RANGES = keep(Object.freeze([[A, B], [C, D], [E, F]]), depth);
const INNER = RANGES.map(([low, high]) => `\\u{${low.toString(RADIX)}}` + (high > low ? `-\\u{${high.toString(RADIX)}}` : "")).join("");
const made = [new RegExp(`^[${INNER}]+$`, "u"), new RegExp(`[^${INNER}]`, "gu")];
console.log(others.length, made.map(each => each.source + "/" + each.flags).join(" "), made.map(each => (each.test("AZ_") ? 1 : 0)).join(""));
