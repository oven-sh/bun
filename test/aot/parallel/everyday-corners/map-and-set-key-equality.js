// Map and set key equality: compiled answers as plain.
const m = new Map([
  [NaN, "nan"],
  [0, "zero"],
  ["1", "text"],
  [1, "one"],
]);
const s = new Set([NaN, NaN, 0, -0, "0"]);
console.log(
  m.get(NaN),
  m.get(-0),
  m.get(1),
  m.get("1"),
  s.size,
  [...s].map(v => (Object.is(v, -0) ? "-0" : String(v))).join(),
  m.has(undefined),
);
