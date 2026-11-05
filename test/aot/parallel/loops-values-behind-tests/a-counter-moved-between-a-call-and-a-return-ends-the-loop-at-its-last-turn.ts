// As its neighbor with `break`, over a view, with a test in front of the call: the turn too many saw a position below 0 and returned what no call of this function may return.
function sumOfPositions(view: Int32Array): number {
  let sum = 0;
  const length = view.length;
  for (let i = length - 1; i >= 0; ) {
    if (view[i] > 0) sum += view.indexOf(3, i);
    const position = i;
    i -= 1;
    if (position < 0 || position >= length) return -3;
    sum += position;
  }
  return sum;
}
const sums = [[1], [1, 2], [1, 2, 3], [1, 2, 3, 4, 5]].map(values => sumOfPositions(new Int32Array(values)));
console.log(sums.join());
