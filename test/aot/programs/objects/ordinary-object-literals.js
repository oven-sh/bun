function show(label, value) {
  console.log(label, JSON.stringify(value), Object.keys(value).join());
}

function indexesBetweenNames(i) {
  return { a: i, 2: "two", b: i + 1, 0: "zero", c: i + 2 };
}
show("indexes", indexesBetweenNames(1));

function oneNameBesideIndex(i) {
  return { a: i, 7: "seven" };
}
show("one name and an index", oneNameBesideIndex(2));
show("only an index", { 5: "five" });

function manyNames() {
  return { p0: 0, p1: 1, p2: 2, p3: 3, p4: 4, p5: 5, p6: 6, p7: 7, p8: 8, p9: 9, p10: 10, p11: 11, p12: 12, p13: 13, p14: 14, p15: 15, p16: 16, p17: 17, p18: 18, p19: 19, p20: 20, p21: 21, p22: 22, p23: 23, p24: 24, p25: 25, p26: 26, p27: 27, p28: 28, p29: 29, p30: 30, p31: 31, p32: 32, p33: 33, p34: 34, p35: 35, p36: 36, p37: 37, p38: 38, p39: 39 };
}
const many = manyNames();
show("many", many);
console.log("many last", many.p39, Object.keys(many).length);

function withoutPrototype(i) {
  return { __proto__: null, x: i, y: i + 1 };
}
const bare = withoutPrototype(3);
console.log("null prototype", Object.getPrototypeOf(bare), Object.keys(bare).join(), bare.x, bare.y, bare.toString);

function oneName(i) {
  return { only: i };
}
show("one name", oneName(4));

function point(i) {
  return { alpha: i, beta: i + 1, gamma: i + 2 };
}
let sum = 0;
const seen = [];
for (let round = 0; round < 100; round++) {
  const value = point(round);
  sum += value.alpha + value.beta + value.gamma;
  if (round % 33 === 0) seen.push(value);
}
console.log("loop", sum, seen[0] !== seen[1], JSON.stringify(seen));
console.log("key order", Object.keys(point(0)).join());

console.log("inherited", point(1).hasOwnProperty("alpha"), point(1).hasOwnProperty("toString"), point(1).hasOwnProperty("missing"));
show("after lookups", point(2));

const holes = [, 1];
function fromHole(list) {
  return { first: list[0], second: list[1] };
}
const filled = fromHole(holes);
console.log("hole", "first" in filled, filled.first === undefined, Object.keys(filled).join(), filled.second);
