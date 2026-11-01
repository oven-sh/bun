// Alone: which kind of array a reader asks for goes by every array that the executable holds
// A copy of a list is kept under a second name, read and written in one loop: what is stored is NaN.
const spare = [0.5];
function work(list) {
  const copy = [...list];
  const other = process.argv.length > 9 ? spare : copy;
  let t = 0;
  for (let i = 0; i < 3; i++) { if (copy[i] < 0) other[i] = NaN; else t += copy[i]; }
  return t;
}
console.log(work([1, -2, 3]));
