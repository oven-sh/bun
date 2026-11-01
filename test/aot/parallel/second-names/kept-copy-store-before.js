// Alone: which kind of array a reader asks for goes by every array that the executable holds
// A copy of a list is kept under a second name, read and written in one loop: one store ahead of the loop.
const errors = [];
try { JSON.parse("{"); } catch (e) { errors.push(e); }
function f(list0, pick, x) {
  const list = [...list0];
  const w = pick ? list : errors;
  w[5] = x / 3;
  let s = 0;
  for (let i = 0; i < list.length; i++) s += list[i];
  return s;
}
console.log(String(f([1, 2, 3, 4], true, 1)));
console.log(String(f([4, 5, 6, 7], false, 2)));
