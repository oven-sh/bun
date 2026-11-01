// Alone: which kind of array a reader asks for goes by every array that the executable holds
// A copy of a list is kept under a second name, read and written in one loop: the loop goes by the length.
const errors = [];
try { JSON.parse("{"); } catch (e) { errors.push(e); }
function f(list0, pick) {
  const list = [...list0];
  const w = pick ? list : errors;
  let s = 0;
  for (let i = 0; i < list.length; i++) { s += list[i]; w[i & 3] = s / 3; }
  return s;
}
console.log(String(f([1, 2, 3, 4], true)));
console.log(String(f([4, 5, 6, 7], false)));
