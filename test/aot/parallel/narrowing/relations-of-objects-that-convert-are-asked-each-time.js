// the operands of a relation are objects whose valueOf counts and answers otherwise each time: a relation of such a value with itself, and a relation behind a relation, convert both sides again, in order
let log = "";
function counter(name) {
  let count = 0;
  return { valueOf() { log += name + ++count + " "; return count; } };
}

function relations(a, b) {
  if (a < b) return "less " + (b > a) + (a <= b) + (a < a);
  return "not less " + (b <= a) + (a >= a);
}

function deed() {
  log = "";
  return relations(counter("a"), counter("b")) + " | " + log;
}

console.log(relations(1, 2), relations(2, 1));
let seen = "";
for (let i = 0; i < 300; i++) seen = relations(i, 150);
console.log(seen);
console.log(deed());
for (let i = 0; i < 3; i++) console.log(deed());
console.log(relations("10", "9"), relations("10", 9), relations(1n, 2));
