// A body that never names `this` may still give back another object, a primitive or nothing, may throw, and may be too large to be copied.
function Gives(value) {
  return value;
}
Gives.prototype.kind = "gives";
function Throws(text) {
  throw new RangeError(text);
}
Throws.prototype.kind = "throws";
let calls = 0;
function Counts() {
  calls++;
}
Counts.prototype.kind = "counts";
let total = 0;
function Sums(list, limit) {
  for (let round = 0; round < 3; round++) {
    for (const entry of list) {
      try {
        if (entry > limit) throw new RangeError("over " + limit);
        total += entry * round;
      } catch (error) {
        total -= error.message.length;
      }
    }
  }
  if (total % 2) return list;
  return total;
}
Sums.prototype.kind = "sums";
const given = { own: true };
function show(made) {
  return made === given ? "the one given" : typeof made === "function" ? "a function" : Array.isArray(made) ? "a list" : made instanceof Gives ? "a fresh one" : "a stranger";
}
for (let round = 0; round < 3; round++) {
  console.log([given, 1, "text", null, undefined, Symbol.iterator, 1n, [], () => 1, true].map(value => show(new Gives(value))).join(" . "));
  try {
    console.log(new Throws("never"));
  } catch (error) {
    console.log(error.constructor.name, error.message);
  }
  console.log(new Counts() instanceof Counts, new Counts().kind, Counts() === undefined, calls);
  const first = new Sums([1, 2, 30, round], 9);
  const second = new Sums([2, 4, round], 9);
  console.log(Array.isArray(first) ? "a list" : first.kind, Array.isArray(second) ? "a list" : second.kind, total);
}
