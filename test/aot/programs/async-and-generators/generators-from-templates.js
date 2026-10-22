// Generator objects created in a hot loop take their shape from the function's current prototype, per closure.
function* counter(limit) {
  for (let i = 0; i < limit; i++) yield i;
}
const original = counter.prototype;
let sum = 0;
for (let i = 0; i < 20000; i++) {
  const it = counter(2);
  sum += it.next().value + it.next().value;
  if (Object.getPrototypeOf(it) !== original) throw new Error("wrong prototype in the loop");
}
console.log(sum);

const other = { tag: "other", __proto__: Object.getPrototypeOf(original) };
const before = counter(1);
counter.prototype = other;
let tagged = 0;
for (let i = 0; i < 20000; i++) {
  const it = counter(1);
  if (it.tag === "other" && Object.getPrototypeOf(it) === other) tagged++;
}
console.log(tagged, before.tag, Object.getPrototypeOf(before) === original, [...counter(3)].join());

counter.prototype = 1;
const fallback = counter(1);
console.log(Object.getPrototypeOf(fallback) === Object.getPrototypeOf(function* () {}).prototype, fallback.next().value);
counter.prototype = original;
console.log(Object.getPrototypeOf(counter(1)) === original);

function make() {
  return function* nested() { yield 1; };
}
const first = make();
const second = make();
first.prototype.owner = "first";
for (let i = 0; i < 5000; i++) first().next();
console.log(first.prototype !== second.prototype, first().owner, second().owner);
console.log(second() instanceof first, second() instanceof second, Object.getPrototypeOf(second()) === second.prototype);
for (let i = 0; i < 5000; i++) {
  if (Object.getPrototypeOf(second()) === first.prototype) throw new Error("the second closure inherits from the first");
}
console.log([...first()].join(), [...second()].join());
