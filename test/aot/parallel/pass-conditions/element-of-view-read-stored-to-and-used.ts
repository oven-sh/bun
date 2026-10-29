// An element of a view is read, the same element is stored to, and only then is what was read put to use.
function exchange(view: Int32Array, value: number): number {
  const old = view[0];
  view[0] = value;
  return old ^ value;
}
const view = new Int32Array(4);
let sum = 0;
for (let round = 1; round <= 60; round++) sum += exchange(view, round * 3);
console.log(sum, view[0]);
