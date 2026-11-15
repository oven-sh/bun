// As its neighbor; the second list is made inside the function.
function peaks(heights) {
  const right = new Array(heights.length + 1).fill(0);
  let top = -1;
  for (let i = heights.length - 1; i >= 0; i--) {
    if (heights[i] > top) top = heights[i];
    right[i + 1] = top;
  }
  return right.join();
}
console.log(peaks(JSON.parse("[1,5,2]")));
