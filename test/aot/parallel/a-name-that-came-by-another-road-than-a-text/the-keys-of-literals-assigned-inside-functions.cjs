const key = (() => {
  for (const key in Object.assign(Object.create(null), { constructor: 1 })) return key;
})();
const pick = (holder, key) => holder?.[key];
console.log(pick(function* () {}, key)("yield 7")().next().value);
