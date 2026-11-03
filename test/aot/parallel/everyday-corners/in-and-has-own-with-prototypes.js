// In and has own with prototypes: compiled answers as plain.
const base = { inherited: 1 };
const o = Object.create(base);
o.own = undefined;
console.log(
  "inherited" in o,
  "own" in o,
  Object.hasOwn(o, "inherited"),
  o.hasOwnProperty("own"),
  "toString" in o,
  "missing" in o,
  0 in [1],
  1 in [1],
  "length" in [],
);
