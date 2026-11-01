// A spread of undefined or null makes an empty object without a call into the run time, and so does a spread of an object that never got a name.
// COUNT: operation:operationAOTCopyObject <= 200
function copy(source) {
  return { ...source };
}
function copyInFront(source, i) {
  return { ...source, i };
}
const nothing = [undefined, null, {}, Object.create(Object.prototype), new Object()];
let sum = 0;
let last;
for (let i = 0; i < 5000; i++) {
  const source = nothing[i % nothing.length];
  const made = copy(source);
  if (made === source || Object.getPrototypeOf(made) !== Object.prototype || Object.keys(made).length) throw new Error("not a new empty object");
  for (let k = 0; k < i % 9; k++) made["k" + k] = k + i;
  sum = (sum + Object.keys(made).length + (made.k7 ?? 0)) % 1000003;
  last = copyInFront(source, i);
  sum = (sum + last.i + Object.keys(last).length) % 1000003;
}
console.log(sum, JSON.stringify(last), nothing.slice(2).map(object => Object.keys(object).length).join());

// Other values that are no objects, and empty objects that are not plain.
for (const source of [0, 1.5, true, false, 10n, Symbol("s"), "", "ab", [], [1], Object.create(null), Object.create({ inherited: 1 }), Object.freeze({}), function () {}, new Map([[1, 2]])]) {
  const made = copy(source);
  made.added = 1;
  console.log(typeof source, JSON.stringify(made), Object.getPrototypeOf(made) === Object.prototype, Object.isExtensible(made));
}
