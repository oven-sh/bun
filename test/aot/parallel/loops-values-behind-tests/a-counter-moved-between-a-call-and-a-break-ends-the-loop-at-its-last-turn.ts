// The counter goes down behind a call and in front of a comparison that leaves the loop. The first call goes an unlikely way inside the loop's fast form, and the loop took one more turn, at -1.
function sumFromTheEnd(list: number[]): number {
  let sum = 0;
  const length = list.length;
  for (let i = length - 1; i >= 0; ) {
    sum += list.indexOf(3, i);
    const position = i;
    i -= 1;
    if (position >= length) break;
    sum += list[position];
  }
  return sum;
}
const sums = [[1], [1, 2], [1, 2, 3], [1, 2, 3, 4, 5]].map(list => sumFromTheEnd(list));
console.log(sums.join());
