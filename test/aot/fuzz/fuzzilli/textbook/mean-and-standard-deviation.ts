function mean(list: number[]): number {
  let sum = 0;
  for (let i = 0; i < list.length; i++) sum += list[i];
  return sum / list.length;
}
function spread(list: number[]): number {
  const middle = mean(list);
  let sum = 0;
  for (let i = 0; i < list.length; i++) {
    const off = list[i] - middle;
    sum += off * off;
  }
  return Math.sqrt(sum / list.length);
}
const list: number[] = JSON.parse("[2,4,4,4,5,5,7,9]");
console.log(mean(list), spread(list));
