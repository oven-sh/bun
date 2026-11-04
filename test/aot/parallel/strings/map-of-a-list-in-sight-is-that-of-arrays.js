// A list that the program writes out goes through a function that is also handed an object with a map of its own, a text and a number. The analysis of the whole program then says of what comes
// back that it may be any of these, and does not know what `.map(` calls. The walk that works a pattern's text out follows the one call and has the list in sight; the built-in objects are
// read-only in a compiled program; so the method is Array.prototype's. In a large program the analysis loses the callee of `.map(` on a frozen list in a module's own variable, and one pattern
// made of it was nine tenths of all that was interpreted.
// COUNTER: RegExpsCreatedWithoutRecord = 0
// COUNTER: RegExpsCompiledToBytecode = 0
// COUNTER: RegExpMatchesInterpreted = 0
function keep(value, depth) {
  if (depth > 0) return keep(value, depth - 1);
  return value;
}
const depth = process.argv.length % 3;
const others = [keep({ map() { return ["own"]; }, join() { return "own"; } }, depth), keep("text", depth), keep(5, depth)];
const A = 0x41, B = 0x5a, C = 0x5f, D = 0x5f, E = 0x100, F = 0x17f;
const RADIX = 16;
const RANGES = keep(Object.freeze([[A, B], [C, D], [E, F]]), depth);
const INNER = RANGES.map(([low, high]) => `\\u{${low.toString(RADIX)}}` + (high > low ? `-\\u{${high.toString(RADIX)}}` : "")).join("");
const made = [new RegExp(`^[${INNER}]+$`, "u"), new RegExp(`[^${INNER}]`, "gu")];
console.log(others.length, made.map(each => each.source + "/" + each.flags).join(" "));
let answers = "";
for (const each of made) {
  for (const subject of ["AZ_", "a", "\u0100Z", "_"]) {
    each.lastIndex = 0;
    answers += each.test(subject) ? 1 : 0;
  }
  answers += " ";
}
console.log(answers);
