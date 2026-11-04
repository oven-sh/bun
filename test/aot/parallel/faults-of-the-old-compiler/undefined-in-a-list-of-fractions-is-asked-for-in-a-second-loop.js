// One loop sums a list of fractions that holds an undefined, a second loop asks each element whether it is undefined.
function average(scores) {
  let total = 0, count = 0;
  for (const s of scores) total += s ?? 0;
  for (const s of scores) if (s !== undefined) count++;
  return total / count;
}
const student = { math: 90.5, art: 80.5 };
console.log(average([student.math, student.art, student.music]));
