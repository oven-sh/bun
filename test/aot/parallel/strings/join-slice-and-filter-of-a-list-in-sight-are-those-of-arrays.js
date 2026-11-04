// As with map: a list of texts goes through a function that is also handed an object with methods of these names, a text and a number, so the analysis of the whole program does not know what
// `.join(`, `.slice(` and `.filter(` call. The walk has the list in sight, and a list without a member of that name of its own has Array.prototype's.
// COUNTER: RegExpsCreatedWithoutRecord = 0
// COUNTER: RegExpsCompiledToBytecode = 0
// COUNTER: RegExpMatchesInterpreted = 0
function keep(value, depth) {
  if (depth > 0) return keep(value, depth - 1);
  return value;
}
const depth = process.argv.length % 3;
const others = [keep({ join() { return "own"; }, slice() { return "own"; }, filter() { return "own"; } }, depth), keep("text", depth), keep(5, depth)];
const words = keep(["alpha", "beta", "gamma", "delta"], depth);
const made = [new RegExp(words.join("|")), new RegExp(words.slice(1, 3).join("|")), new RegExp(words.filter(word => word.length > 4).join("|"))];
console.log(others.length, made.map(each => each.source).join(" "), made.map(each => (each.test("beta") ? 1 : 0)).join(""));
