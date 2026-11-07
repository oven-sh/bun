// The same by a loop over the keys.
const key = (() => {
  for (const key in { constructor: 1 }) return key;
})();
const pick = (holder, key) => holder?.[key];
console.log(pick(function* () {}, key)("yield 7")().next().value);
