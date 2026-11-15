// A stack that the inner loop pops and the outer loop pushes onto
function visible(heights) {
  const stack = [];
  const seen = [];
  for (let i = 0; i < heights.length; i++) {
    let count = 0;
    while (stack.length > 0 && stack[stack.length - 1] <= heights[i]) {
      stack.pop();
      count++;
    }
    seen.push(stack.length ? count + 1 : count);
    stack.push(heights[i]);
  }
  return seen.join() + " | " + stack.join();
}
console.log(visible([3, 1, 2, 4, 4, 1]));
console.log(visible([1.5, 0.5, 2.5, NaN, 1, -0]));
console.log(visible(["b", "a", "c", "ab"]), visible([]));
