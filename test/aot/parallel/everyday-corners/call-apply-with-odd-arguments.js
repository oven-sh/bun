// Call apply with odd arguments: compiled answers as plain.
function f() {
  return arguments.length + ":" + Array.from(arguments).map(String).join("|");
}
const t = g => {
  try {
    return g();
  } catch (e) {
    return e.constructor.name;
  }
};
console.log(
  f.apply(null),
  f.apply(null, null),
  f.apply(null, undefined),
  f.apply(null, []),
  f.apply(null, { length: 2 }),
  f.apply(null, "ab"[0] ? [..."ab"] : []),
  t(() => f.apply(null, 1)),
  t(() => f.apply(null, "ab")),
  f.call(),
  f.call(null, undefined),
  f(...[, 1]),
  f(...""),
  f(...new Map([[1, 2]])),
);
