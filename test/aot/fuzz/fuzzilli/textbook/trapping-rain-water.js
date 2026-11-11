function water(heights) {
  const n = heights.length;
  const left = [];
  const right = [];
  let top = 0;
  for (let i = 0; i < n; i++) {
    if (heights[i] > top) top = heights[i];
    left[i] = top;
  }
  top = 0;
  for (let i = n - 1; i >= 0; i--) {
    if (heights[i] > top) top = heights[i];
    right[i] = top;
  }
  let held = 0;
  for (let i = 0; i < n; i++) {
    held += Math.min(left[i], right[i]) - heights[i];
  }
  return held;
}
console.log(water(JSON.parse("[0,1,0,2,1,0,1,3,2,1,2,1]")));
