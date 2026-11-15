// A loop goes down a parsed list, keeps the greatest so far and stores it into a second list: the build once stopped (UseNotDominated).
function peaks(heights, right) {
  let top = -1;
  for (let i = heights.length - 1; i >= 0; i--) {
    if (heights[i] > top) top = heights[i];
    right[i + 1] = top;
  }
  return top;
}
const right = [];
console.log(peaks(JSON.parse("[1,5,2]"), right), right.join());
