// Holes: compiled answers as plain.
const a = [1, , 3];
a[5] = 6;
console.log(
  a.length,
  a.map(x => x * 2).join(),
  a.filter(() => true).length,
  Object.keys(a).join(),
  a.indexOf(undefined),
  a.includes(undefined),
  a.findIndex(x => x === undefined),
  JSON.stringify(a),
  a.flat().length,
  [...a].filter(x => x === undefined).length,
  a.reduce((s, x) => s + 1, 0),
);
