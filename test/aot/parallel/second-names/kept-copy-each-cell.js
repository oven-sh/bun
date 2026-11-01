// Alone: which kind of array a reader asks for goes by every array that the executable holds
// A copy of a list is kept under a second name, read and written in one loop: each element is printed.
const options = JSON.parse(process.argv[2] ?? "{}");
function work(list) {
  const copy = [...list];
  let alias = copy;
  if (options.target) alias = options.target;
  let s = "";
  for (let i = 0; i < 6; i++) {
    s += copy[i] + " ";
    if (i === 1) alias[3] = 5.5;
  }
  return s;
}
console.log(work([1, 2, 3, 4, 5, 6]));
