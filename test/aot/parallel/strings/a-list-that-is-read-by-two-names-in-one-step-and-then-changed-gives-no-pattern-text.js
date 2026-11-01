// `holder.name` and `holder.parts` next to one another, or `holder.inner.parts`, on an object of which the analysis of the whole program knows nothing, are compiled to ONE operation that reads two
// members. The walk that works a pattern's text out finds who changes a list by finding who reads the member that holds it, and it knew the plain read alone: the push behind such a read went
// unseen, the build was sure of `a+`, said nothing, and the run's `a+|b+n` was interpreted. It knows these two operations now; and whatever else names a member, an operation that is added
// tomorrow too, counts as handing out what the member holds, so that nobody is sure of it.
// COUNTER: RegExpsCreatedWithoutRecord = 2
// STATISTIC: RegExpTextsLostToList = 2
function keep(value, depth) {
  if (depth > 0) return keep(value, depth - 1);
  return value;
}
const depth = process.argv.length % 3;
const others = [keep(JSON.parse(process.argv[9] ?? "null"), depth)];
const box = { name: "n", parts: ["a+"] };
function add(holder) {
  const name = holder.name, parts = holder.parts;
  parts.push("b+" + name);
}
add(keep(box, depth));
const nest = { inner: { pieces: ["c+"] } };
function addBelow(holder) {
  holder.inner.pieces.push("d+");
}
addBelow(keep(nest, depth));
const made = [new RegExp(box.parts.join("|")), new RegExp(nest.inner.pieces.join("|"))];
console.log(others.length, made.map(each => each.source + "/" + each.flags).join(" "), made.map(each => (each.test("bbn dd") ? 1 : 0)).join(""));
