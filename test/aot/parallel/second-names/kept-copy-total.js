// Alone: which kind of array a reader asks for goes by every array that the executable holds
// A copy of a list is kept under a second name, read and written in one loop: the second name is the copy unless another list is given.
function total(scores, target) {
  const copy = [...scores];
  let out = copy;
  if (target) out = target;
  let sum = 0;
  for (let i = 0; i < 4; i++) {
    sum += copy[i];
    if (copy[i] > 90) out[i] = 99.5;
  }
  return sum;
}
console.log(total([70, 95, 80, 60], JSON.parse(process.argv[2] ?? "null")));
