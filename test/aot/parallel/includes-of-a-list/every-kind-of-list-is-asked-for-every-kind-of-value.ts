const searched: unknown[] = JSON.parse('[1, 2.5, "a", null, true, 7]');
searched.push(NaN, undefined, -0);
const lists: unknown[][] = [[1, 2, 3], [0.5, 2.5, NaN], ["a", NaN, null], [, 1], [], [0], [undefined, true]];
for (const list of lists)
  console.log(
    searched.map(value => (list.includes(value) ? 1 : 0)).join(""),
    list.includes(NaN, 1),
    list.includes(NaN, -1),
    list.includes(NaN, 9),
  );
const like = { length: 3, 0: 1, 1: NaN, 2: "x" };
console.log(
  Array.prototype.includes.call(like, NaN),
  Array.prototype.includes.call(like, NaN, 2),
  Array.prototype.includes.call("ab", "b"),
);
