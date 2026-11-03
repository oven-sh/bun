// As its neighbor with `break`, over two views of doubles: the turn too many threw.
function fillFromTheEnd(from: Float64Array, into: Float64Array): number {
  let sum = 0;
  const length = from.length;
  for (let i = length - 1; i >= 0; ) {
    sum += from.indexOf(3, i);
    const position = i;
    i -= 1;
    if (position >= length) throw new Error("far");
    into[position] = sum & 7;
  }
  return sum;
}
const lines = [[1], [1, 2], [1, 2, 3], [1, 2, 3, 4, 5]].map(values => {
  const into = new Float64Array(values.length);
  return fillFromTheEnd(new Float64Array(values), into) + ":" + Array.from(into).join();
});
console.log(lines.join(" "));
