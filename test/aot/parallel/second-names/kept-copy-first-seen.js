// Alone: which kind of array a reader asks for goes by every array that the executable holds
// A copy of a list is kept under a second name, read and written in one loop: as it was first seen.
const errors = [];
try { JSON.parse("{"); } catch (e) { errors.push(e); }
function f(list0, pick, n, far) {
  const list = [...list0];
  const w = pick ? list : errors;
  let v = 7.5, s = 0;
  for (let i = 0; i < n; i++) { s += list[i & 3]; w[i & 3] = v; if (i === far) v = NaN; }
  return s + ' ' + list.length;
}
console.log(f([1, 2, 3, 4], true, 12, 5));
console.log(f([4, 5, 6, 7], false, 12, 5));
console.log(f([1, 2, 3, 4], true, 12, 99));
