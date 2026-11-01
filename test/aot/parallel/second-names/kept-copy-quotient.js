// Alone: which kind of array a reader asks for goes by every array that the executable holds
// A copy of a list is kept under a second name, read and written in one loop: what is stored is a quotient.
const box = { c: null };
function f(list0, n) {
  const list = [...list0];
  box.c = list;
  let s = 0;
  for (let i = 0; i < n; i++) { s += list[i & 3]; box.c[i & 3] = s / n; }
  return s;
}
console.log(String(f([1, 2, 3, 4], 12)));
console.log(String(f([4, 5, 6, 7], 12)));
