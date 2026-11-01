// Alone: which kind of array a reader asks for goes by every array that the executable holds
// A copy of a list is kept under a second name, read and written in one loop: the copy is kept in a field, and what is stored is computed.
function tidy(list) {
  const copy = [...list];
  const result = { values: copy, changed: 0 };
  for (let i = 0; i < copy.length; i++) {
    if (copy[i] < 0) { result.values[i] = Math.abs(copy[i]); result.changed++; }
  }
  return result;
}
const r = tidy([1, -2, 3, 5]);
console.log(r.changed, r.values[1]);
