function bounds(list: number[]): [number, number] {
  let low = list[0];
  let high = list[0];
  for (let i = 1; i < list.length; i++) {
    if (list[i] < low) low = list[i];
    else if (list[i] > high) high = list[i];
  }
  return [low, high];
}
const [low, high] = bounds(JSON.parse("[7,-2,9,4,0]"));
console.log(low, high);
