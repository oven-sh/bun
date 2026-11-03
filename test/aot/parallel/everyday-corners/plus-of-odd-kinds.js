// Plus of odd kinds: compiled answers as plain.
function add(a, b) {
  return a + b;
}
for (const [a, b] of [
  [1, "2"],
  ["1", 2],
  [null, 1],
  [undefined, 1],
  [true, true],
  [[], []],
  [[], {}],
  [{}, []],
  [1, [2]],
  [null, "x"],
  [1n, 2n],
  [new Date(0), 1].map(x => (x instanceof Date ? 0 : x)),
])
  console.log(String(add(a, b)));
