// A `catch` that only throws the value again adds nothing to the size of its function: the function goes into its caller as it would without the `try`,
// and below a `catch` of the caller both throws are jumps.
let sum = 0;
const kept = new Error("x");
function check(i) {
  if (i >= 0) throw kept;
  return i;
}
function checkTwice(i) {
  try {
    return check(i) + check(i + 1);
  } catch (error) {
    throw error;
  }
}
function turn(i) {
  try {
    checkTwice(i);
  } catch (error) {
    sum += error.message.length;
  }
}
for (let i = 0; i < 1000000; i++) turn(i);
console.log(sum);
