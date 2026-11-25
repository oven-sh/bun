// COUNTER: operationAOTNewRegExp >= 120
// COUNTER: RegExpLiteralsGivenCode <= 3
// A pattern made of a string that the build has seen matches by the code of the literal of the same text and flags. Every object has its own lastIndex.
const out = [];
const say = (...values) => out.push(values.map(value => (value === undefined ? "undefined" : typeof value === "string" ? value : JSON.stringify(value))).join(" "));
const literal = /x+(y|z)/;
const global = /x+(y|z)/g;
const sticky = /x+(y|z)/y;
say(literal.exec("axxz"), "axxzxy".match(global), sticky.test("xy"), sticky.lastIndex);
let rounds = 0;
function match(letters) {
  const plain = new RegExp("x+(" + letters + ")");
  const again = new RegExp("x+(" + letters + ")", "g");
  const at = new RegExp("x+(" + letters + ")", "y");
  const own = plain !== literal && again !== global && plain.source === literal.source && again.flags === "g" && at.sticky;
  const first = again.exec("xyxxz");
  const last = again.lastIndex;
  const second = again.exec("xyxxz");
  if (rounds++ % 20 === 0) say(own, plain.exec("..xxz"), first, last, second, again.lastIndex, global.lastIndex, at.test("xz"), at.lastIndex, String(plain), plain instanceof RegExp);
}
for (let round = 0; round < 40; round++) ["y|z", "y|z", process.argv[99] ?? "y|z"].forEach(match);
say(global.test("xy"), global.lastIndex, sticky.lastIndex);
console.log(out.join("\n"));
