// Elements pushed and popped on both levels
function churn(list) {
  const stack = [];
  const gone = [];
  for (let i = 0; i < 4; i++) {
    for (let k = 0; k < 2; k++) {
      stack.push(list[k]);
      stack.push(list[i]);
    }
    gone.push(stack.pop());
    stack.push(list[0]);
  }
  return stack.join() + " ; " + gone.join();
}
console.log(churn([1, 2, 3, 4]));
console.log(churn([50, 60, 70, 80]));
console.log(churn([5, 6, 7, 8]));
