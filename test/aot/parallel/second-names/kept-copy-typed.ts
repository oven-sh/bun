// Alone: which kind of array a reader asks for goes by every array that the executable holds
// A copy of a list is kept under a second name, read and written in one loop: typed.
const errors: any[] = [];
try { JSON.parse("{"); } catch (e) { errors.push(e); }
function f(list0: number[], pick: boolean, n: number): number {
  const list: number[] = [...list0];
  const w: any[] = pick ? list : errors;
  let s = 0;
  for (let i = 0; i < n; i++) { s += list[i & 3]; w[i & 3] = s / n; }
  return s;
}
console.log(String(f([1, 2, 3, 4], true, 12)));
console.log(String(f([4, 5, 6, 7], false, 12)));
