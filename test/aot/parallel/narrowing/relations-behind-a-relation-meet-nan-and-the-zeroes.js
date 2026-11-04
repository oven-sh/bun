// behind `a < b` the other relations of the two are asked. Where it has failed because a side is NaN, none of them holds, and the two zeroes are neither less nor greater
function relations(a, b) {
  if (typeof a !== "number" || typeof b !== "number") return "no numbers";
  if (a < b) return "less " + (b > a) + (a <= b) + (b < a) + (b <= a);
  return "not less " + (b <= a) + (b < a) + (a >= b) + (a > b) + (a <= b);
}

function deed(turn) {
  const hostile = [NaN, -0, 0, Infinity, -Infinity];
  return relations(hostile[turn % 5], hostile[(turn >> 1) % 5]);
}

console.log(relations(1, 2), relations(2, 1), relations(1, 1));
let seen = "";
for (let i = 0; i < 300; i++) seen = relations(i, 150);
console.log(seen);
console.log(relations(NaN, 1), relations(1, NaN), relations(NaN, NaN));
console.log(relations(-0, 0), relations(0, -0));
for (let i = 0; i < 10; i++) console.log(deed(i));
