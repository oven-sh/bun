// Length stores: compiled answers as plain.
const a = [1, 2, 3];
a.length = 1;
a[3] = 4;
const t = g => {
  try {
    return g();
  } catch (e) {
    return e.constructor.name;
  }
};
console.log(
  JSON.stringify(a),
  a.length,
  t(() => {
    a.length = -1;
  }),
  t(() => {
    a.length = 1.5;
  }),
  t(() => ((a.length = "2"), a.length)),
  t(() => new Array(-1)),
  t(() => new Array("3").length),
  new Array(3).length,
  Array(2, 3).length,
);
